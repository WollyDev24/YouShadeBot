import { PermissionsBitField } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

export const DEFAULT_MODEL = "gemini-3.6-flash";

/* Per-server rate limits. 0 means unlimited for the quota settings. */
export const DEFAULT_LIMITS = {
  daily: 5,
  boost: 15,
  cooldownSeconds: 4
};

export const LIMIT_BOUNDS = {
  daily: { min: 0, max: 500 },
  boost: { min: 0, max: 500 },
  cooldownSeconds: { min: 0, max: 60 }
};

/* `gemini-flash-latest` is a moving alias: it always resolves to whichever
 * stable Flash model is newest, so the bot picks up upgrades without a
 * deploy. Pin one of the explicit IDs below if you need repeatable output. */
export const AVAILABLE_MODELS = [
  { id: "gemini-flash-latest", name: "Gemini Flash Latest (always newest)" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash (agentic workhorse)" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (low cost, high volume)" }
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
  "MEMORY SYSTEM: You have a persistent memory system. You can create, update, and recall memories on your own. " +
  "Memories are key-value pairs stored per server. When users mention or reply to you, relevant memories are provided in context. " +
  "You decide when to create or update memories based on conversation importance. " +
  "You should create memories for: user preferences, important facts shared, recurring topics, server-specific info, and notable events. " +
  "Only the bot owner can directly add/modify/delete memories via commands. Other users can only influence memories through conversation with you, and you decide what's worth remembering." +
  "\n\n" +
  "When responding, relevant memories will be prepended to your context. Use them naturally in conversation.";

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
    data.aichat[guildId] = { enabled: false, channels: [], model: DEFAULT_MODEL, usage: {}, limits: {} };
  }
  const c = data.aichat[guildId];
  c.limits = normalizeLimits(c.limits);
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

export { isOwner, canModifyMemory, canReceiveExternalMemory, getOwnerId, getFallbackModels };

function stripMentions(content) {
  return String(content ?? "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/<@&\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function askGemini(model, prompt, apiKey) {
  const models = getFallbackModels(model);
  let lastError = null;

  for (const m of models) {
    const url = `${BASE_URL}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.8 }
        })
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastError = new Error(`Gemini API ${res.status}: ${body.slice(0, 200)}`);
        if (res.status === 429 || res.status >= 500) {
          console.warn(`[aichat] Model ${m} failed (${res.status}), trying fallback...`);
          continue;
        }
        throw lastError;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

      if (m !== model) {
        console.log(`[aichat] Used fallback model: ${m} (primary: ${model})`);
      }
      return text;
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

export async function handleAiMessage(client, message) {
  const apiKey = process.env.GEMINI_API_KEY;
  const guild = message.guild;
  if (!guild || !apiKey) return;

  const c = cfg(guild.id);
  if (!c.enabled || !c.channels.length) return;
  if (!c.channels.includes(message.channel.id)) return;

  const isMention = message.mentions.has(client.user.id);
  let isReplyToBot = false;
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    isReplyToBot = Boolean(ref && ref.author.id === client.user.id);
  }
  if (!isMention && !isReplyToBot) return;

  const prompt = stripMentions(message.content);
  if (!prompt) return;

  const member = message.member;
  const limits = c.limits;
  const quota = requestQuota(member, limits);
  const isBooster = Boolean(member?.premiumSince) &&
    !member?.permissions?.has(PermissionsBitField.Flags.Administrator);

  if (Number.isFinite(quota) && getUsage(guild.id, message.author.id) >= quota) {
    const dayKey = `${guild.id}:${message.author.id}:${today()}`;
    if (!notifiedToday.has(dayKey)) {
      notifiedToday.set(dayKey, true);
      message
        .reply(
          isBooster
            ? `**Monolith AI limit reached.** You have used your **${quota}** booster requests for today.`
            : `**Monolith AI limit reached.** You have used your **${quota}** requests for today.` +
              (quotaFrom(limits.boost) > quota
                ? ` Boost the server for **${limits.boost}**/day — server admins get unlimited.`
                : "")
        )
        .catch(() => {});
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
    const memoryContext = formatMemoriesForContext(guild.id);
    const fullPrompt = memoryContext ? `${memoryContext}\n\n${name}: ${prompt}` : `${name}: ${prompt}`;
    const text = await askGemini(c.model, fullPrompt, apiKey);
    consumeUsage(guild.id, message.author.id);

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
