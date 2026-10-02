import { PermissionsBitField } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

export const DEFAULT_MODEL = "gemini-3.6-flash";

/* Per-server rate limits. 0 means unlimited for the quota settings. */
export const DEFAULT_LIMITS = {
  daily: 5,
  boost: 15,
  cooldownSeconds: 4,
  /* Image messages are billed as full multimodal requests, so they get their
   * own allowance instead of competing with plain text. Boosters and admins
   * are exempt, so this one number is the only knob here. */
  imageDaily: 10
};

export const LIMIT_BOUNDS = {
  daily: { min: 0, max: 500 },
  boost: { min: 0, max: 500 },
  cooldownSeconds: { min: 0, max: 60 },
  imageDaily: { min: 0, max: 500 }
};

/* Guards for the vision path. Gemini inlines the raw bytes in the JSON body,
 * so both the count and the per-file size have to be capped. */
export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/* Conversation context. Every message we send carries the surrounding chat, so
 * these are kept modest: a 1M token window is not the constraint, latency and
 * cost per message are. */
export const CONV_HISTORY_MESSAGES = 15;
export const CONV_HISTORY_CHARS = 3000;
export const CONV_SUMMARY_CHARS = 1200;
export const CONV_SUMMARY_MAX_ENTRIES = 8;
export const CONV_TTL_DAYS = 7;

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif"
]);

/* `gemini-flash-latest` is a moving alias: it always resolves to whichever
 * stable Flash model is newest, so the bot picks up upgrades without a
 * deploy. Pin one of the explicit IDs below if you need repeatable output. */
export const AVAILABLE_MODELS = [
  { id: "gemini-flash-latest", name: "Gemini Flash Latest (always newest)" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash (agentic workhorse)" },
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (low cost, high volume)" }
];

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const cooldowns = new Map();
const notifiedToday = new Map();

const OWNER_ID = process.env.OWNER_ID?.trim() || null;

function getFallbackModels(model) {
  const primary = AVAILABLE_MODELS.find((m) => m.id === model)?.id ?? DEFAULT_MODEL;
  const others = AVAILABLE_MODELS.filter((m) => m.id !== primary).map((m) => m.id);
  return [primary, ...others];
}

function getOwnerId() {
  return OWNER_ID;
}

function isOwner(userId) {
  return OWNER_ID && userId === OWNER_ID;
}

function canModifyMemory(message) {
  return isOwner(message.author.id);
}

/* The bot may only write its own memory on the owner's say-so. Anyone else
 * can still be discussed in conversation, but their words never become a
 * stored memory on their own. */
function canReceiveExternalMemory(message) {
  return isOwner(message.author.id);
}

const SYSTEM_PROMPT =
  "You are Monolith, an AI assistant living inside a Discord server. " +
  "Keep answers friendly, concise and Discord-appropriate. Use discord markdown capabilities when needed. " +
  "Never exceed about 1800 characters. If something is unclear, ask a short clarifying question." +
  "ONLY answer in english, NEVER any other language, even when asked to" +
  "Do not use Emojis" +
  "\n\n" +
  "CONVERSATION CONTEXT: You will often be given the recent messages from this " +
  "channel before the current one, each prefixed with the speaker's name. Treat " +
  "that as the conversation so far, so you can refer back to what was said, " +
  "including things said before you joined in. Lines beginning \"You said " +
  "earlier:\" are your own previous replies. When someone replies to a message, " +
  "the parent message is quoted to you explicitly, so answer the reply rather " +
  "than the raw text in isolation. Do not claim you did not see something that " +
  "is present in that context, and do not invent details that are not in it." +
  "\n\n" +
  "MEMORY SYSTEM: You have tools that actually write to a persistent, per-server key-value memory store. " +
  "Available memories are listed in your context under RELEVANT MEMORIES; use them naturally in conversation. " +
  "\n" +
  "RULES FOR THE MEMORY TOOLS:\n" +
  "1. To remember something, CALL save_memory. To change an existing one, CALL update_memory. " +
  "To remove one, CALL delete_memory. Never claim you remembered, noted, or will remember something unless " +
  "you actually make the tool call in that same turn. Saying \"noted\" in plain text stores nothing.\n" +
  "2. Worth saving: durable user preferences, standing facts about people, server-specific info, and recurring " +
  "topics. Not worth saving: one-off chatter, anything already in memory, or transient state.\n" +
  "3. Keep keys short, lowercase and hyphenated, e.g. \"marcus-timezone\". Reuse the existing key when updating " +
  "rather than inventing a near-duplicate.\n" +
  "4. Save at most two or three memories per conversation, and only when genuinely useful. Err on the side of " +
  "saving less. Do not save secrets, passwords, API keys or tokens.\n" +
  "5. Memory writes are only permitted while talking to the server owner. If you are asked to remember something " +
  "by anyone else, do not call the tools; you may acknowledge the request in conversation, but be honest that " +
  "only the owner can store it.\n" +
  "6. After a tool call is handled, reply normally to the user in plain text. Do not narrate the storage details." +
  "\n\n" +
  "IMAGES: Messages may include images. Read them before answering, and refer to what you actually see " +
  "rather than guessing from the caption. If an image is unclear, low quality, or you cannot make out " +
  "the details, say so plainly instead of inventing them. Do not claim to have seen an image that was " +
  "not attached. Text-only messages and image messages use separate daily allowances, so keep image " +
  "answers just as concise as text ones.";

function clampInt(value, key) {
  const { min, max } = LIMIT_BOUNDS[key];
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/* Fill in any missing limit and coerce out-of-range values, so a config
 * written by an older version (or hand-edited) can never crash the bot. */
export function normalizeLimits(raw) {
  const src = raw ?? {};
  const out = {};
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const n = clampInt(src[key] ?? DEFAULT_LIMITS[key], key);
    out[key] = n ?? DEFAULT_LIMITS[key];
  }
  return out;
}

function cfg(guildId) {
  const data = getData();
  if (!data.aichat[guildId]) {
    data.aichat[guildId] = { enabled: false, channels: [], model: DEFAULT_MODEL, usage: {}, imageUsage: {}, limits: {} };
  }
  const c = data.aichat[guildId];
  c.limits = normalizeLimits(c.limits);
  c.imageUsage ??= {};
  /* A model removed from AVAILABLE_MODELS (or one Google has since retired)
   * would silently fall back on every call, so heal the stored value once. */
  if (!AVAILABLE_MODELS.some((m) => m.id === c.model)) c.model = DEFAULT_MODEL;
  return c;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function getAiConfig(guildId) {
  return cfg(guildId);
}

export function setAiEnabled(guildId, enabled) {
  const c = cfg(guildId);
  c.enabled = Boolean(enabled);
  saveKey("aichat");
  return c;
}

export function setAiChannel(guildId, channelId) {
  const c = cfg(guildId);
  c.channels = [String(channelId)];
  saveKey("aichat");
  return c;
}

export function addAiChannel(guildId, channelId) {
  const c = cfg(guildId);
  if (!c.channels.includes(String(channelId))) c.channels.push(String(channelId));
  saveKey("aichat");
  return c;
}

export function removeAiChannel(guildId, channelId) {
  const c = cfg(guildId);
  c.channels = c.channels.filter((id) => id !== String(channelId));
  saveKey("aichat");
  return c;
}

export function setAiModel(guildId, model) {
  const c = cfg(guildId);
  const validModel = AVAILABLE_MODELS.find((m) => m.id === model)?.id ?? DEFAULT_MODEL;
  c.model = validModel;
  saveKey("aichat");
  return c;
}

export function getAiLimits(guildId) {
  return { ...cfg(guildId).limits };
}

export function setAiLimits(guildId, patch) {
  const c = cfg(guildId);
  c.limits = normalizeLimits({ ...c.limits, ...(patch ?? {}) });
  saveKey("aichat");
  return { ...c.limits };
}

/* 0 means "no cap", which reads as unlimited everywhere it is displayed. */
function quotaFrom(value) {
  const n = Number(value);
  return !Number.isFinite(n) || n <= 0 ? Infinity : n;
}

export function requestQuota(member, limits) {
  const l = limits ?? DEFAULT_LIMITS;
  if (!member) return quotaFrom(l.daily);
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return Infinity;
  if (member.premiumSince) return quotaFrom(l.boost);
  return quotaFrom(l.daily);
}

/* One knob, so boosters and admins are both unlimited rather than getting a
 * second configurable tier they would outgrow anyway. */
export function requestImageQuota(member, limits) {
  const l = limits ?? DEFAULT_LIMITS;
  if (!member) return quotaFrom(l.imageDaily);
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return Infinity;
  if (member.premiumSince) return Infinity;
  return quotaFrom(l.imageDaily);
}

export function getUsage(guildId, userId) {
  const c = cfg(guildId);
  return c.usage?.[today()]?.[userId] ?? 0;
}

export function consumeUsage(guildId, userId) {
  const c = cfg(guildId);
  c.usage ??= {};
  c.usage[today()] ??= {};
  c.usage[today()][userId] = (c.usage[today()][userId] ?? 0) + 1;
  saveKey("aichat");
  return c.usage[today()][userId];
}

export function getImageUsage(guildId, userId) {
  const c = cfg(guildId);
  return c.imageUsage?.[today()]?.[userId] ?? 0;
}

export function consumeImageUsage(guildId, userId) {
  const c = cfg(guildId);
  c.imageUsage ??= {};
  c.imageUsage[today()] ??= {};
  c.imageUsage[today()][userId] = (c.imageUsage[today()][userId] ?? 0) + 1;
  saveKey("aichat");
  return c.imageUsage[today()][userId];
}

function getMemoryStore(guildId) {
  const data = getData();
  if (!data.aimemory[guildId]) {
    data.aimemory[guildId] = {};
  }
  return data.aimemory[guildId];
}

export function getMemories(guildId) {
  return getMemoryStore(guildId);
}

export function getMemory(guildId, key) {
  const store = getMemoryStore(guildId);
  return store[key] ?? null;
}

export function setMemory(guildId, key, value, authorId = null) {
  const store = getMemoryStore(guildId);
  store[key] = {
    value: String(value).slice(0, 2000),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: authorId,
    updatedBy: authorId
  };
  saveKey("aimemory");
  return store[key];
}

export function updateMemory(guildId, key, value, authorId = null) {
  const store = getMemoryStore(guildId);
  if (!store[key]) return null;
  store[key].value = String(value).slice(0, 2000);
  store[key].updatedAt = new Date().toISOString();
  store[key].updatedBy = authorId;
  saveKey("aimemory");
  return store[key];
}

export function deleteMemory(guildId, key) {
  const store = getMemoryStore(guildId);
  const existed = key in store;
  if (existed) {
    delete store[key];
    saveKey("aimemory");
  }
  return existed;
}

export function searchMemories(guildId, query, limit = 10) {
  const store = getMemoryStore(guildId);
  const lowerQuery = query.toLowerCase();
  const results = [];
  for (const [key, mem] of Object.entries(store)) {
    const value = typeof mem === "object" ? mem.value : String(mem);
    if (key.toLowerCase().includes(lowerQuery) || value.toLowerCase().includes(lowerQuery)) {
      results.push({ key, value, ...mem });
      if (results.length >= limit) break;
    }
  }
  return results;
}

/* --- conversation memory ---
 *
 * Two independent things, both per channel:
 *
 * 1. Recent channel messages, pulled live at request time. This is what lets
 *    the bot answer "what did I just ask?" about a message it never saw,
 *    and gives it the surrounding conversation instead of one bare turn.
 *
 * 2. A rolling summary of the bot's own recent activity in the channel,
 *    persisted so it survives a restart. The live history above is only as
 *    old as the last few minutes; this is the part that remembers.
 */

function getConversationStore(guildId) {
  const data = getData();
  data.aiconv ??= {};
  data.aiconv[guildId] ??= {};
  return data.aiconv[guildId];
}

/* Keyed by channel so two channels in one guild do not bleed together. */
function convKey(channelId) {
  return channelId ?? "unknown";
}

export function getConversationSummary(guildId, channelId) {
  const entry = getConversationStore(guildId)[convKey(channelId)];
  if (!entry) return null;
  const stamp = Date.parse(entry.updatedAt ?? "");
  if (Number.isFinite(stamp) && Date.now() - stamp > CONV_TTL_DAYS * 86_400_000) {
    return null;
  }
  return entry.summary ?? null;
}

/* Bounded FIFO: drop the oldest entry once the cap is reached, so a busy
 * channel cannot grow the store without limit. */
export function addConversationSummary(guildId, channelId, line) {
  const store = getConversationStore(guildId);
  const key = convKey(channelId);
  const entry = store[key] ?? { summary: [] };
  entry.summary = Array.isArray(entry.summary) ? entry.summary : [];
  entry.summary.push(String(line).slice(0, 300));
  while (entry.summary.length > CONV_SUMMARY_MAX_ENTRIES) entry.summary.shift();
  entry.updatedAt = new Date().toISOString();
  store[key] = entry;
  saveKey("aiconv");
  return entry;
}

export function clearConversation(guildId, channelId) {
  const store = getConversationStore(guildId);
  const key = convKey(channelId);
  const existed = key in store;
  if (existed) {
    delete store[key];
    saveKey("aiconv");
  }
  return existed;
}

export function formatConversationForContext(guildId, channelId, maxChars = CONV_SUMMARY_CHARS) {
  const summary = getConversationSummary(guildId, channelId);
  if (!summary?.length) return "";
  let out = "WHAT YOU RECENTLY SAID IN THIS CHANNEL:\n";
  let total = 0;
  for (const line of summary) {
    if (total + line.length > maxChars) break;
    out += `- ${line}\n`;
    total += line.length;
  }
  return out;
}

/* Turn one line of recent channel traffic into a `role` the API accepts.
 * Discord has no "model" role, so the bot's own messages are sent as user
 * turns with a clear prefix instead. */
function toContentPart(msg, botId) {
  const who = msg.author?.bot ? `${msg.author.username} (a bot)` : msg.author?.username ?? "someone";
  const text = String(msg.content ?? "").trim();
  if (!text) return null;
  return {
    role: "user",
    parts: [{ text: msg.author?.id === botId ? `You said earlier: ${text}` : `${who}: ${text}` }]
  };
}

/* Pull the messages around this one and shape them into API contents.
 * Excludes the triggering message, which the caller supplies separately. */
export async function buildHistoryContents(message, botId, { limit = CONV_HISTORY_MESSAGES, maxChars = CONV_HISTORY_CHARS } = {}) {
  const fetch = message.channel?.messages?.fetch;
  if (typeof fetch !== "function") return [];

  const collected = await fetch.call(message.channel, { limit: limit + 1 }).catch(() => null);
  if (!collected) return [];

  const list = [...collected.values()]
    .filter((m) => m.id !== message.id)
    .sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0))
    .slice(-limit);

  const contents = [];
  let total = 0;
  for (const m of list) {
    const part = toContentPart(m, botId);
    if (!part) continue;
    const size = part.parts[0].text.length;
    /* Stop once the budget is spent, so a wall of text cannot balloon the
     * request. Oldest messages go first because the recent ones matter more. */
    if (total + size > maxChars) break;
    total += size;
    contents.push(part);
  }
  return contents;
}

/* Summarise a single exchange into one short line for the rolling summary. */
export function summariseExchange(authorName, text) {
  const clean = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${authorName}: ${clean}`;
}

export function formatMemoriesForContext(guildId, maxChars = 1500) {
  const store = getMemoryStore(guildId);
  const entries = Object.entries(store);
  if (!entries.length) return "";
  let context = "RELEVANT MEMORIES:\n";
  let total = 0;
  for (const [key, mem] of entries) {
    const value = typeof mem === "object" ? mem.value : String(mem);
    const line = `- ${key}: ${value}\n`;
    if (total + line.length > maxChars) break;
    context += line;
    total += line.length;
  }
  return context;
}

/* Things that should never be written to a store that gets read back into
 * every future prompt. Deliberately narrow: a false positive here silently
 * drops a legitimate memory, so this targets high-confidence credential shapes
 * rather than anything vaguely sensitive-looking. */
const SECRET_PATTERNS = [
  /\b(?:discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{60,})/i,
  /\bMTk[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bAIza[A-Za-z0-9_-]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:password|passwd|secret|api[_\- ]?key|access[_\- ]?token|private[_\- ]?key)\b\s*[:=]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b[A-Za-z0-9+/]{60,}={0,2}\b/
];

export function looksLikeSecret(text) {
  const s = String(text ?? "");
  return SECRET_PATTERNS.some((re) => re.test(s));
}

export { isOwner, canModifyMemory, canReceiveExternalMemory, getOwnerId, getFallbackModels };

/* The three things the model is allowed to do to its own memory. Declared for
 * Gemini's function calling API, which is what gives the model an actual
 * channel to write with; before this it could only mention memory in prose. */
const MEMORY_TOOLS = [
  {
    name: "save_memory",
    description:
      "Store a new memory for this server. Use short, stable, lowercase-hyphenated keys. " +
      "Only call this when the conversation contains something durably useful, and never for secrets.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Short stable identifier, e.g. marcus-timezone" },
        value: { type: "string", description: "The fact to remember, in one or two sentences" }
      },
      required: ["key", "value"]
    }
  },
  {
    name: "update_memory",
    description: "Change the value of an existing memory. Fails if the key does not already exist.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The existing key to overwrite" },
        value: { type: "string", description: "The new value" }
      },
      required: ["key", "value"]
    }
  },
  {
    name: "delete_memory",
    description: "Remove a memory entirely. Use when the owner asks you to forget something.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "The key to delete" } },
      required: ["key"]
    }
  }
];

/* Bound the tool loop so a model that keeps calling cannot spin forever. */
const MAX_TOOL_ROUNDS = 3;

/* Executes one requested memory mutation. Returns a short string for the model
 * to read back, and reports whether anything was actually written. */
function runMemoryTool(name, args, { guildId, authorId }) {
  const key = typeof args?.key === "string" ? args.key.trim().slice(0, 64) : "";
  const value = typeof args?.value === "string" ? args.value.trim() : "";

  if (!key || !/^[a-z0-9][a-z0-9._-]*$/i.test(key)) {
    return { result: "Rejected: key must be 1-64 characters of letters, digits, dot, dash or underscore.", saved: false };
  }

  if (!canReceiveExternalMemory({ author: { id: authorId } })) {
    return {
      result: "Rejected: only the server owner can have memories written. Tell the user this plainly.",
      saved: false
    };
  }

  if (name === "delete_memory") {
    const ok = deleteMemory(guildId, key);
    return {
      result: ok ? `Deleted "${key}".` : `No memory named "${key}" exists.`,
      saved: false
    };
  }

  if (!value) {
    return { result: `Rejected: "${key}" needs a value.`, saved: false };
  }
  if (looksLikeSecret(key) || looksLikeSecret(value)) {
    console.warn(`[aichat] Blocked a memory write to "${key}" that looked like a credential`);
    return {
      result: `Rejected: "${key}" looks like it contains a secret, so it was not stored.`,
      saved: false
    };
  }

  if (name === "save_memory") {
    if (getMemory(guildId, key)) {
      /* Re-saving an existing key would clobber it and lose the original
       * createdAt, so steer the model to update_memory instead. */
      return { result: `"${key}" already exists. Use update_memory to change it.`, saved: false };
    }
    setMemory(guildId, key, value.slice(0, 2000), authorId);
    return { result: `Saved "${key}".`, saved: true };
  }

  const updated = updateMemory(guildId, key, value.slice(0, 2000), authorId);
  if (!updated) {
    return { result: `No memory named "${key}" exists. Use save_memory to create it.`, saved: false };
  }
  return { result: `Updated "${key}".`, saved: true };
}

function stripMentions(content) {
  return String(content ?? "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/<@&\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Pull any image attachments off the message and turn them into Gemini
 * inlineData parts. Returns the parts plus a count of what we had to drop,
 * so the caller can tell the user instead of silently ignoring their image. */
export async function collectImageParts(message) {
  const parts = [];
  let skipped = 0;
  let seen = 0;

  for (const att of message.attachments?.values?.() ?? []) {
    const mime = String(att.contentType ?? "").toLowerCase();
    if (!mime.startsWith("image/")) continue;
    seen++;
    if (parts.length >= MAX_IMAGES_PER_MESSAGE) {
      skipped++;
      continue;
    }
    if (!IMAGE_MIME_TYPES.has(mime)) {
      skipped++;
      continue;
    }
    if (Number(att.size ?? 0) > MAX_IMAGE_BYTES) {
      skipped++;
      continue;
    }

    const res = await fetch(att.url).catch(() => null);
    if (!res?.ok) {
      skipped++;
      continue;
    }
    let bytes;
    try {
      bytes = Buffer.from(await res.arrayBuffer());
    } catch {
      skipped++;
      continue;
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      skipped++;
      continue;
    }
    parts.push({ inlineData: { mimeType: mime, data: bytes.toString("base64") } });
  }

  return { parts, skipped, seen };
}

/* One HTTP round trip to the model. Returns the raw parts so the caller can
 * distinguish prose from tool calls, which a flattened text join would lose. */
async function generateOnce(model, systemInstruction, contents, apiKey, tools) {
  const models = getFallbackModels(model);
  let lastError = null;

  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.8 }
  };
  if (tools) {
    payload.tools = [{ functionDeclarations: tools }];
    payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  for (const m of models) {
    const url = `${BASE_URL}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastError = new Error(`Gemini API ${res.status}: ${body.slice(0, 200)}`);
        /* 400 here usually means this model rejected the tool schema. Retry
         * without tools so the conversation still works on a fallback. */
        if (res.status === 400 && tools) {
          console.warn(`[aichat] Model ${m} rejected the memory tools, continuing without them`);
          return { parts: [], text: "", toolCalls: [], toolUnsupported: true };
        }
        if (res.status === 429 || res.status >= 500) {
          console.warn(`[aichat] Model ${m} failed (${res.status}), trying fallback...`);
          continue;
        }
        throw lastError;
      }

      const data = await res.json();
      const rawParts = data?.candidates?.[0]?.content?.parts ?? [];
      if (m !== model) {
        console.log(`[aichat] Used fallback model: ${m} (primary: ${model})`);
      }
      return { parts: rawParts, toolUnsupported: false };
    } catch (err) {
      lastError = err;
      if (err.message.includes("429") || err.message.includes("500") || err.message.includes("503") || err.message.includes("504")) {
        console.warn(`[aichat] Model ${m} failed, trying fallback...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("All models failed");
}

/* Ask the model, run whatever memory tools it asks for, and ask again so it
 * can reply in plain text with the results in hand. Returns the final text
 * plus how many memories actually changed. */
async function askGeminiWithTools(model, prompt, apiKey, imageParts, toolCtx, history = []) {
  const parts = imageParts.length ? [{ text: prompt }, ...imageParts] : [{ text: prompt }];
  /* History first, then the live turn. The API requires alternating-ish
   * roles and rejects a leading model turn, so a stray model message from
   * history is folded into a user turn by toContentPart. */
  let contents = [...history, { role: "user", parts }];
  let tools = MEMORY_TOOLS;
  let saved = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await generateOnce(model, SYSTEM_PROMPT, contents, apiKey, tools);
    if (res.toolUnsupported) {
      tools = null;
      continue;
    }

    const toolCalls = res.parts.filter((p) => p.functionCall?.name);
    const text = res.parts
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!toolCalls.length || !tools) {
      return { text, saved };
    }
    if (round === MAX_TOOL_ROUNDS) {
      console.warn(`[aichat] hit the tool call ceiling, replying without more memory writes`);
      return { text, saved };
    }

    const functionResponses = [];
    for (const call of toolCalls) {
      const known = MEMORY_TOOLS.some((t) => t.name === call.functionCall.name);
      const out = known
        ? runMemoryTool(call.functionCall.name, call.functionCall.args ?? {}, toolCtx)
        : { result: `Unknown tool "${call.functionCall.name}".`, saved: false };
      if (out.saved) saved++;
      console.log(`[aichat] memory tool ${call.functionCall.name}(${JSON.stringify(call.functionCall.args ?? {})}) -> ${out.result}`);
      functionResponses.push({
        functionResponse: { name: call.functionCall.name, response: { result: out.result } }
      });
    }

    /* Replay the turn as: model asked -> we answered -> model replies. */
    contents = [
      ...contents,
      { role: "model", parts: res.parts },
      { role: "user", parts: functionResponses }
    ];
  }

  return { text: "", saved };
}

export async function handleAiMessage(client, message) {
  const apiKey = process.env.GEMINI_API_KEY;
  const guild = message.guild;
  if (!guild || !apiKey) return;

  const c = cfg(guild.id);
  if (!c.enabled || !c.channels.length) return;
  if (!c.channels.includes(message.channel.id)) return;

  const isMention = message.mentions.has(client.user.id);
  let isReplyToBot = false;
  let parentLine = "";
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    if (ref) {
      isReplyToBot = ref.author?.id === client.user.id;
      /* Quote the parent into the prompt. The fetched history usually covers
       * it, but not always: the parent can be older than the window, or
       * filtered out of it. Without this the model sees a bare "what about
       * this?" with nothing to attach it to. */
      const parentText = String(ref.content ?? "").trim();
      if (parentText) {
        const who = ref.author?.bot ? `${ref.author.username} (a bot)` : ref.author?.username ?? "someone";
        parentLine = `[Replying to ${who}: "${parentText.slice(0, 500)}"]`;
      }
    }
  }
  if (!isMention && !isReplyToBot) return;

  let prompt = stripMentions(message.content);

  /* Gather images before deciding which allowance to charge, so a picture
   * message draws on the image quota even when the text quota is spent. */
  const images = await collectImageParts(message);
  const isImageRequest = images.parts.length > 0;

  if (!prompt) {
    if (!isImageRequest) return;
    prompt = "Describe this image.";
  } else if (images.skipped > 0) {
    prompt += ` (I could not read ${images.skipped} of the attached image(s): too large or an unsupported format.)`;
  }

  const member = message.member;
  const limits = c.limits;
  const quota = isImageRequest ? requestImageQuota(member, limits) : requestQuota(member, limits);
  const isBooster = Boolean(member?.premiumSince) &&
    !member?.permissions?.has(PermissionsBitField.Flags.Administrator);
  const used = isImageRequest ? getImageUsage(guild.id, message.author.id) : getUsage(guild.id, message.author.id);
  const kind = isImageRequest ? "image" : "text";

  if (Number.isFinite(quota) && used >= quota) {
    const dayKey = `${guild.id}:${message.author.id}:${kind}:${today()}`;
    if (!notifiedToday.has(dayKey)) {
      notifiedToday.set(dayKey, true);
      let notice;
      if (isImageRequest) {
        notice = `**Monolith AI image limit reached.** You have used your **${quota}** image request(s) today.`;
      } else if (isBooster) {
        notice = `**Monolith AI limit reached.** You have used your **${quota}** booster requests for today.`;
      } else {
        notice =
          `**Monolith AI limit reached.** You have used your **${quota}** requests for today.` +
          (quotaFrom(limits.boost) > quota
            ? ` Boost the server for **${limits.boost}**/day — server admins get unlimited.`
            : "");
      }
      message.reply(notice).catch(() => {});
    }
    return;
  }

  const cdKey = `${message.author.id}:${message.channel.id}`;
  const last = cooldowns.get(cdKey) ?? 0;
  const cooldownMs = Math.max(0, Number(limits.cooldownSeconds) || 0) * 1000;
  if (cooldownMs > 0 && Date.now() - last < cooldownMs) return;
  cooldowns.set(cdKey, Date.now());

  try {
    if (typeof message.channel.sendTyping === "function") message.channel.sendTyping().catch(() => {});
    const name = member?.displayName ?? message.author.username;
    /* Long-lived memories, then what we know of this channel's recent past,
     * then the live surrounding messages. Each is optional. */
    const memoryContext = formatMemoriesForContext(guild.id);
    const convContext = formatConversationForContext(guild.id, message.channel.id);
    const history = await buildHistoryContents(message, client.user.id);
    const preamble = [memoryContext, convContext].filter(Boolean).join("\n\n");

    const current = [parentLine, `${name}: ${prompt}`].filter(Boolean).join("\n");
    const finalPrompt = preamble ? `${preamble}\n\n${current}` : current;

    const { text, saved } = await askGeminiWithTools(
      c.model,
      finalPrompt,
      apiKey,
      images.parts,
      { guildId: guild.id, authorId: message.author.id },
      history
    );
    if (saved > 0) console.log(`[aichat] stored ${saved} memory/memories for guild ${guild.id}`);
    if (text) {
      addConversationSummary(guild.id, message.channel.id, summariseExchange(name, prompt));
    }
    if (isImageRequest) consumeImageUsage(guild.id, message.author.id);
    else consumeUsage(guild.id, message.author.id);

    if (!text) {
      return message.reply("Gemini returned an empty response — try rewording your message.").catch(() => {});
    }
    const clipped = text.length > 2000 ? text.slice(0, 1997) + "..." : text;
    await message.reply(clipped).catch(() => {});
  } catch (err) {
    console.error("[aichat]", err.message);
    message.reply(`Sorry, the AI replied with an error: ${err.message.slice(0, 200)}`).catch(() => {});
  }
}
