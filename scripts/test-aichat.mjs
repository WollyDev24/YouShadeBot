/* Tests the configurable AI rate limits, the vision path and the memory tools.
 *
 * OWNER_ID comes from the environment because aichat.js reads it once at
 * import time, and static ES imports are hoisted above any assignment here.
 * scripts/test-aichat.sh sets it before running this file. Tests that need
 * owner rights send messages authored as OWNER.
 *
 * This imports the real src/utils/aichat.js, which opens the live SQLite
 * store, so ALWAYS run it through scripts/test-aichat.sh, which snapshots
 * src/data first and restores it afterwards.
 */
import assert from "node:assert/strict";

const OWNER = process.env.OWNER_ID;
if (!OWNER) {
  console.error("OWNER_ID must be set; run this via scripts/test-aichat.sh");
  process.exit(1);
}

/* Memory tests need a guild of their own. They share GUILD_ID with the quota
 * tests, which leave imageDaily at 0 (unlimited) or spend the owner's text
 * allowance, so reusing it would make these depend on the order they run in. */
const MEM = "test-aichat-memory-guild";

import {
  DEFAULT_LIMITS,
  LIMIT_BOUNDS,
  normalizeLimits,
  requestQuota,
  getAiLimits,
  setAiLimits,
  getAiConfig,
  setAiModel,
  setAiEnabled,
  setAiChannel,
  requestImageQuota,
  collectImageParts,
  getImageUsage,
  consumeImageUsage,
  getMemories,
  looksLikeSecret,
  buildHistoryContents,
  formatConversationForContext,
  getConversationSummary,
  addConversationSummary,
  clearConversation,
  summariseExchange,
  CONV_HISTORY_MESSAGES,
  CONV_HISTORY_CHARS,
  CONV_SUMMARY_MAX_ENTRIES,
  getMemory,
  setMemory,
  deleteMemory,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  getUsage,
  consumeUsage
} from "../src/utils/aichat.js";
import { reportAiConfig } from "../src/events/clientReady.js";
import { PermissionsBitField } from "../src/lib/discord.js";

const ADMIN = PermissionsBitField.Flags.Administrator;

const member = { premiumSince: null, permissions: { has: (f) => f === ADMIN } };
const booster = { premiumSince: new Date(), permissions: { has: () => false } };
const plain = { premiumSince: null, permissions: { has: () => false } };
const ADMIN_MEMBER = { premiumSince: null, permissions: { has: () => true } };

/* Register, then run sequentially at the end. Awaiting each one matters:
 * several tests drive handleAiMessage against shared config, so letting them
 * interleave would have them clobbering each other's limits. It also means an
 * assertion that throws after an `await` is actually reported as a failure. */
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const GUILD = "test-aichat-limits-guild";

test("defaults match the values that used to be hardcoded", () => {
  assert.equal(DEFAULT_LIMITS.daily, 5);
  assert.equal(DEFAULT_LIMITS.boost, 15);
  assert.equal(DEFAULT_LIMITS.cooldownSeconds, 4);
  assert.equal(DEFAULT_LIMITS.imageDaily, 10);
});

/* Assert invariants rather than a fixed list, so editing the lineup in
 * AVAILABLE_MODELS does not require editing a test to match. */
test("the model list is internally consistent", () => {
  assert.ok(AVAILABLE_MODELS.length > 0, "there must be at least one model");
  assert.ok(
    AVAILABLE_MODELS.some((m) => m.id === DEFAULT_MODEL),
    `DEFAULT_MODEL ${DEFAULT_MODEL} is not in the selectable list`
  );
  const ids = AVAILABLE_MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate model ids in AVAILABLE_MODELS");
  for (const m of AVAILABLE_MODELS) {
    assert.match(m.id, /^gemini-[a-z0-9]+(\.[a-z0-9]+)?(-[a-z0-9]+(\.[a-z0-9]+)?)?$/, `bad model id: ${m.id}`);
    assert.ok(m.name?.trim(), `model ${m.id} has no display name`);
    /* Discord rejects a slash command outright if any choice name is over 100
     * characters, so catch an over-long label here instead of at deploy. */
    assert.ok(m.name.length <= 100, `display name for ${m.id} exceeds Discord's 100 char limit`);
  }
});

test("a config still pointing at a retired model heals on read", () => {
  const g = `${GUILD}-models`;
  getAiConfig(g).model = "gemini-1.5-pro";
  assert.equal(getAiConfig(g).model, DEFAULT_MODEL, "gemini-1.5-pro was retired by Google");
  setAiModel(g, "gemini-3.6-flash");
  assert.equal(getAiConfig(g).model, "gemini-3.6-flash", "a supported id must survive untouched");
  setAiModel(g, "gemini-4.0-ultra");
  assert.equal(getAiConfig(g).model, DEFAULT_MODEL, "an unknown id must not be stored");
});

test("a brand new guild gets the defaults", () => {
  assert.deepEqual(getAiLimits(GUILD), DEFAULT_LIMITS);
});

test("normalizeLimits backfills only the missing keys", () => {
  assert.deepEqual(normalizeLimits({ daily: 3 }), { daily: 3, boost: 15, cooldownSeconds: 4, imageDaily: DEFAULT_LIMITS.imageDaily });
  assert.deepEqual(normalizeLimits({}), DEFAULT_LIMITS);
  assert.deepEqual(normalizeLimits(undefined), DEFAULT_LIMITS);
  assert.deepEqual(normalizeLimits(null), DEFAULT_LIMITS);
});

test("normalizeLimits clamps to the documented bounds", () => {
  assert.equal(normalizeLimits({ daily: 99999 }).daily, LIMIT_BOUNDS.daily.max);
  assert.equal(normalizeLimits({ daily: -5 }).daily, LIMIT_BOUNDS.daily.min);
  assert.equal(normalizeLimits({ cooldownSeconds: 900 }).cooldownSeconds, LIMIT_BOUNDS.cooldownSeconds.max);
});

test("normalizeLimits survives junk from a hand-edited store", () => {
  assert.deepEqual(normalizeLimits({ daily: "abc", boost: null, cooldownSeconds: {} }), DEFAULT_LIMITS);
  assert.equal(normalizeLimits({ daily: "12" }).daily, 12, "numeric strings are accepted");
  assert.equal(normalizeLimits({ daily: 7.6 }).daily, 8, "values are rounded");
});

test("a legacy guild config with no limits field is upgraded in place", () => {
  const c = getAiConfig(GUILD);
  delete c.limits;
  assert.deepEqual(getAiLimits(GUILD), DEFAULT_LIMITS, "missing limits must be backfilled");
  assert.deepEqual(c.limits, DEFAULT_LIMITS);
});

test("requestQuota uses the configured numbers, not constants", () => {
  const limits = { daily: 2, boost: 9, cooldownSeconds: 1 };
  assert.equal(requestQuota(plain, limits), 2);
  assert.equal(requestQuota(booster, limits), 9);
  assert.equal(requestQuota(member, limits), Infinity, "admins stay unlimited");
});

test("a quota of 0 means unlimited", () => {
  const limits = { daily: 0, boost: 0, cooldownSeconds: 0 };
  assert.equal(requestQuota(plain, limits), Infinity);
  assert.equal(requestQuota(booster, limits), Infinity);
  assert.equal(requestQuota(member, limits), Infinity);
});

test("requestQuota still works with no limits argument", () => {
  assert.equal(requestQuota(plain), DEFAULT_LIMITS.daily);
  assert.equal(requestQuota(booster), DEFAULT_LIMITS.boost);
  assert.equal(requestQuota(member), Infinity);
  assert.equal(requestQuota(null), DEFAULT_LIMITS.daily);
});

test("setAiLimits patches only the keys it is given", () => {
  setAiLimits(GUILD, { daily: 7 });
  assert.deepEqual(getAiLimits(GUILD), { daily: 7, boost: 15, cooldownSeconds: 4, imageDaily: DEFAULT_LIMITS.imageDaily });
  setAiLimits(GUILD, { cooldownSeconds: 0 });
  assert.deepEqual(getAiLimits(GUILD), { daily: 7, boost: 15, cooldownSeconds: 0, imageDaily: DEFAULT_LIMITS.imageDaily });
  setAiLimits(GUILD, { boost: 1, daily: 3, cooldownSeconds: 2 });
  assert.deepEqual(getAiLimits(GUILD), { daily: 3, boost: 1, cooldownSeconds: 2, imageDaily: DEFAULT_LIMITS.imageDaily });
  setAiLimits(GUILD, { imageDaily: 4 });
  assert.deepEqual(getAiLimits(GUILD), { daily: 3, boost: 1, cooldownSeconds: 2, imageDaily: 4 });
});

test("setAiLimits clamps instead of persisting nonsense", () => {
  setAiLimits(GUILD, { imageDaily: DEFAULT_LIMITS.imageDaily, daily: 10_000, boost: -4 });
  assert.deepEqual(getAiLimits(GUILD), {
    daily: LIMIT_BOUNDS.daily.max,
    boost: 0,
    cooldownSeconds: 2,
    imageDaily: DEFAULT_LIMITS.imageDaily
  });
  setAiLimits(GUILD, { imageDaily: 9999 });
  assert.equal(getAiLimits(GUILD).imageDaily, LIMIT_BOUNDS.imageDaily.max);
});

test("getAiLimits hands back a copy, not the live config", () => {
  const first = getAiLimits(GUILD);
  first.daily = 999;
  assert.notEqual(getAiLimits(GUILD).daily, 999);
});

test("usage counting is unaffected by the limit changes", () => {
  const user = "u1";
  const before = getUsage(GUILD, user);
  consumeUsage(GUILD, user);
  assert.equal(getUsage(GUILD, user), before + 1);
});

test("the raised quota actually lets more requests through", () => {
  const user = "u2";
  setAiLimits(GUILD, { daily: 1 });
  consumeUsage(GUILD, user);
  const quota = requestQuota(plain, getAiLimits(GUILD));
  assert.equal(quota, 1);
  assert.ok(getUsage(GUILD, user) >= quota, "user is now over quota");

  setAiLimits(GUILD, { daily: 0 });
  const uncapped = requestQuota(plain, getAiLimits(GUILD));
  assert.equal(uncapped, Infinity, "0 lifts the cap entirely");
});

test("boosters above the base quota get the booster allowance", () => {
  setAiLimits(GUILD, { daily: 1, boost: 20 });
  const limits = getAiLimits(GUILD);
  assert.equal(requestQuota(plain, limits), 1);
  assert.equal(requestQuota(booster, limits), 20);
  assert.ok(requestQuota(booster, limits) > requestQuota(plain, limits));
});

/* --- the /ai command surface --- */

const GUILD_ID = "test-aichat-limits-guild";

function mockInteraction(sub, opts = {}) {
  const given = new Map(Object.entries(opts));
  return {
    guildId: GUILD_ID,
    guild: { id: GUILD_ID },
    user: { id: "test-user" },
    member: plain,
    options: {
      getSubcommand: () => sub,
      getString: (k) => (given.get(k) ?? null),
      getInteger: (k) => (given.has(k) ? given.get(k) : null),
      getChannel: (k) => given.get(k) ?? null
    },
    replied: null,
    async reply(payload) {
      this.replied = payload;
      return payload;
    }
  };
}

const ai = (await import("../src/commands/ai.js")).default;

test("/ai limits with no options just reports the current limits", async () => {
  setAiLimits(GUILD, { daily: 6, boost: 12, cooldownSeconds: 3 });
  const it = mockInteraction("limits");
  await ai.execute({}, it);
  assert.ok(it.replied, "the command should reply");
  assert.match(it.replied.content, /\*\*6\*\*\/day per user/);
  assert.match(it.replied.content, /\*\*12\*\*\/day for boosters/);
  assert.match(it.replied.content, /\*\*3s\*\* cooldown/);
});

test("/ai limits sets only the options that were passed", async () => {
  setAiLimits(GUILD, { daily: 5, boost: 15, cooldownSeconds: 4, imageDaily: DEFAULT_LIMITS.imageDaily });
  const it = mockInteraction("limits", { daily: 30 });
  await ai.execute({}, it);
  assert.deepEqual(getAiLimits(GUILD), { daily: 30, boost: 15, cooldownSeconds: 4, imageDaily: DEFAULT_LIMITS.imageDaily });
  assert.match(it.replied.content, /updated/);
  assert.match(it.replied.content, /\*\*30\*\*\/day per user/);
});

test("/ai limits maps the cooldown option onto cooldownSeconds", async () => {
  const it = mockInteraction("limits", { cooldown: 12 });
  await ai.execute({}, it);
  assert.equal(getAiLimits(GUILD).cooldownSeconds, 12);
  assert.match(it.replied.content, /\*\*12s\*\* cooldown/);
});

test("/ai limits shows 0 as unlimited", async () => {
  setAiLimits(GUILD, { daily: 0, boost: 0, cooldownSeconds: 0 });
  const it = mockInteraction("limits");
  await ai.execute({}, it);
  assert.match(it.replied.content, /\*\*∞\*\*\/day per user/);
  assert.match(it.replied.content, /\*\*∞\*\*\/day for boosters/);
});

test("/ai status reports the live limits, not the old constants", async () => {
  setAiLimits(GUILD, { daily: 11, boost: 22, cooldownSeconds: 5 });
  const it = mockInteraction("status");
  await ai.execute({}, it);
  /* EmbedBuilder keeps its data private; fields only exist after toJSON(). */
  const field = it.replied.embeds[0].toJSON().fields.find((f) => f.name === "Request limits");
  assert.ok(field, "status should still have a Request limits field");
  assert.match(field.value, /\*\*11\*\*\/day per user/);
  assert.match(field.value, /\*\*22\*\*\/day for boosters/);
  assert.match(field.value, /unlimited\*\* for admins/);
});

test("/ai usage reports the configured quota", async () => {
  setAiLimits(GUILD, { daily: 4, boost: 40, cooldownSeconds: 4 });
  const it = mockInteraction("usage");
  await ai.execute({}, it);
  assert.match(it.replied.content, /quota: \*\*4\*\*/);
});

test("a booster sees the booster quota in /ai usage", async () => {
  setAiLimits(GUILD, { daily: 4, boost: 40, cooldownSeconds: 4 });
  const it = mockInteraction("usage");
  it.member = booster;
  await ai.execute({}, it);
  assert.match(it.replied.content, /quota: \*\*40\*\*/);
});

test("every /ai subcommand is still a flat name", () => {
  const subs = ai.data.toJSON().options.map((o) => o.name);
  assert.ok(!subs.includes("memory"), "Discord does not support nested subcommands");
  for (const n of ["memory-add", "memory-get", "memory-update", "memory-delete", "memory-list", "memory-search"]) {
    assert.ok(subs.includes(n), `missing ${n}`);
  }
});

/* --- the real enforcement path in handleAiMessage --- */

const { handleAiMessage } = await import("../src/utils/aichat.js");

const realFetch = globalThis.fetch;
const realKey = process.env.GEMINI_API_KEY;
let geminiCalls = 0;

process.env.GEMINI_API_KEY = "test-key";
/* Captures the request body so tests can assert on the inlineData parts the
 * vision path is supposed to be sending, and queues model responses so the
 * function-calling round trip can be driven deterministically. */
let lastGeminiBody = null;
let geminiQueue = [];

const textResponse = (text) => ({
  candidates: [{ content: { parts: [{ text }] } }]
});

/* A turn where the model asks for a tool, before answering in plain text. */
const toolResponse = (name, args) => ({
  candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }]
});

const toolReply = (text) => ({
  candidates: [{ content: { parts: [{ text }] } }]
});

/* Queue one reply per HTTP call, cycling on the last one. */
function queueGemini(...responses) {
  geminiQueue = responses.length ? [...responses] : [textResponse("hi")];
  let i = 0;
  return () => geminiQueue[Math.min(i++, geminiQueue.length - 1)];
}

let nextGeminiResponse = queueGemini();

globalThis.fetch = async (url, opts) => {
  if (String(url).includes("generativelanguage")) {
    geminiCalls++;
    lastGeminiBody = opts?.body ? JSON.parse(opts.body) : null;
    return { ok: true, status: 200, json: async () => nextGeminiResponse() };
  }
  /* Attachment CDN fetch. A 1x1 PNG so the decoded bytes are real. */
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
  };
};

function fakeMessage(
  authorId,
  { premiumSince = null, isAdmin = false, content = "hello", attachments = {}, history = null, replyTo = null, channelId = "chan-1" } = {}
) {
  const replies = [];
  return {
    guild: { id: GUILD_ID },
    author: { id: authorId, username: `u${authorId}` },
    member: {
      displayName: `u${authorId}`,
      premiumSince,
      permissions: { has: () => isAdmin }
    },
    channel: {
      id: channelId,
      sendTyping: async () => {},
      /* Discord's real channel exposes messages.fetch; returning null mimics a
       * channel where history is unavailable, which must not break the reply. */
      messages: { fetch: history === null ? undefined : async () => history }
    },
    id: `msg-${authorId}-${Math.random().toString(36).slice(2, 8)}`,
    createdTimestamp: Date.now(),
    reference: replyTo ? { messageId: "parent" } : undefined,
    fetchReference: replyTo ? async () => replyTo : async () => {
      throw new Error("no reference");
    },
    mentions: { has: () => true },
    content,
    /* discord.js exposes attachments as a Collection; collectImageParts only
     * relies on .values(), so a Map stands in faithfully. */
    attachments: new Map(
      Object.entries(attachments).map(([key, a]) => [
        key,
        { url: a.url ?? `https://cdn.test/${key}.png`, contentType: a.contentType ?? "image/png", size: a.size ?? 12, name: a.name ?? `${key}.png` }
      ])
    ),
    replies,
    reply: async (text) => {
      replies.push(text);
      return text;
    }
  };
}

const client = { user: { id: "bot" } };

test("a user under quota gets an answer and is charged one request", async () => {
  setAiLimits(GUILD_ID, { daily: 2, boost: 4, cooldownSeconds: 0 });
  setAiEnabled(GUILD_ID, true);
  setAiChannel(GUILD_ID, "chan-1");
  const msg = fakeMessage("cool-1");
  geminiCalls = 0;
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "the model should have been called");
  assert.equal(msg.replies.length, 1);
  assert.equal(getUsage(GUILD_ID, "cool-1"), 1);
});

test("the raised daily quota is what actually gates the user", async () => {
  setAiLimits(GUILD_ID, { daily: 3, boost: 4, cooldownSeconds: 0 });
  const msg = fakeMessage("cool-2");
  geminiCalls = 0;
  for (let i = 0; i < 5; i++) await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 3, "exactly the configured quota should get through");
  assert.equal(getUsage(GUILD_ID, "cool-2"), 3);
  assert.match(msg.replies.at(-1), /limit reached/i);
});

test("lowering the quota locks a user out immediately", async () => {
  setAiLimits(GUILD_ID, { daily: 50, boost: 4, cooldownSeconds: 0 });
  const msg = fakeMessage("cool-3");
  geminiCalls = 0;
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1);
  setAiLimits(GUILD_ID, { daily: 1 });
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "no second call once the quota is 1 and one is used");
});

test("a quota of 0 lets a user past the old cap", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 0 });
  const msg = fakeMessage("cool-4");
  geminiCalls = 0;
  for (let i = 0; i < 8; i++) await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 8, "unlimited means no gating at all");
  assert.ok(!/limit reached/i.test(msg.replies.join(" ")), "the user should never be told they hit a limit");
});

test("admins bypass a zero quota", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 0 });
  const msg = fakeMessage("cool-5");
  msg.member.permissions.has = () => true;
  geminiCalls = 0;
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1);
});

test("a booster uses the booster quota, not the base one", async () => {
  setAiLimits(GUILD_ID, { daily: 1, boost: 3, cooldownSeconds: 0 });
  const msg = fakeMessage("cool-6", { premiumSince: new Date() });
  geminiCalls = 0;
  for (let i = 0; i < 5; i++) await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 3, "the booster allowance should be 3");
  assert.match(msg.replies.at(-1), /booster requests/i);
});

test("the cooldown blocks a rapid second message when set above zero", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 60 });
  const msg = fakeMessage("cool-7");
  geminiCalls = 0;
  await handleAiMessage(client, msg);
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "the second message should be swallowed by the cooldown");
});

test("a cooldown of 0 turns the cooldown off", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 0 });
  const msg = fakeMessage("cool-8");
  geminiCalls = 0;
  for (let i = 0; i < 4; i++) await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 4, "every message should get through immediately");
});

test("the cooldown is per user and per channel", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 60 });
  const other = fakeMessage("cool-9");
  geminiCalls = 0;
  await handleAiMessage(client, fakeMessage("cool-10"));
  await handleAiMessage(client, other);
  assert.equal(geminiCalls, 2, "a different user is not blocked by someone else's cooldown");
  await handleAiMessage(client, other);
  assert.equal(geminiCalls, 2, "but the same user in the same channel is");
});

/* --- vision: images attached to an AI message --- */

const IMG = { a: {} };

test("requestImageQuota exempts boosters and admins", () => {
  const limits = { ...DEFAULT_LIMITS, imageDaily: 3 };
  assert.equal(requestImageQuota(plain, limits), 3);
  assert.equal(requestImageQuota(booster, limits), Infinity);
  assert.equal(requestImageQuota(ADMIN_MEMBER, limits), Infinity);
  assert.equal(requestImageQuota(plain, { ...limits, imageDaily: 0 }), Infinity, "0 means unlimited");
});

test("an attached image is sent as inlineData", async () => {
  setAiLimits(GUILD_ID, { daily: 5, boost: 5, cooldownSeconds: 0, imageDaily: 5 });
  const msg = fakeMessage("img-1", { content: "what is this", attachments: IMG });
  geminiCalls = 0;
  lastGeminiBody = null;
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "the model should have been called");
  const parts = lastGeminiBody?.contents?.[0]?.parts ?? [];
  const inline = parts.find((p) => p.inlineData);
  assert.ok(inline, "the image must be sent as inlineData, not dropped");
  assert.equal(inline.inlineData.mimeType, "image/png");
  assert.ok(inline.inlineData.data.length > 0, "inlineData needs base64 bytes");
  assert.ok(
    parts[0].text.includes("what is this"),
    "the caption must still be sent as text"
  );
});

test("an image message is charged to the image quota, not the text one", async () => {
  setAiLimits(GUILD_ID, { daily: 5, boost: 5, cooldownSeconds: 0, imageDaily: 5 });
  const msg = fakeMessage("img-2", { attachments: IMG });
  geminiCalls = 0;
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1);
  assert.equal(getImageUsage(GUILD_ID, "img-2"), 1, "image usage should be 1");
  assert.equal(getUsage(GUILD_ID, "img-2"), 0, "text usage must stay untouched");
});

test("an image with no caption still gets answered", async () => {
  setAiLimits(GUILD_ID, { daily: 5, boost: 5, cooldownSeconds: 0, imageDaily: 5 });
  const msg = fakeMessage("img-3", { content: "", attachments: IMG });
  geminiCalls = 0;
  lastGeminiBody = null;
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "a captionless image should still be handled");
  assert.ok(
    /describe this image/i.test(lastGeminiBody?.contents?.[0]?.parts?.[0]?.text ?? ""),
    "a captionless image should fall back to a generic prompt"
  );
});

test("the image quota really gates a plain member", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 0, imageDaily: 2 });
  geminiCalls = 0;
  /* Same user each time, so the count really is this user's cumulative usage. */
  const msg = fakeMessage("img-cap", { attachments: IMG });
  for (let i = 0; i < 4; i++) {
    await handleAiMessage(client, msg);
  }
  assert.equal(geminiCalls, 2, "only the configured image quota should get through");
  assert.equal(getImageUsage(GUILD_ID, "img-cap"), 2, "blocked requests must not be charged");
});

test("boosters and admins are not gated by the image quota", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 0, imageDaily: 1 });
  geminiCalls = 0;
  for (let i = 0; i < 3; i++) {
    await handleAiMessage(client, fakeMessage(`img-boost-${i}`, { premiumSince: new Date(), attachments: IMG }));
    await handleAiMessage(client, fakeMessage(`img-adm-${i}`, { isAdmin: true, attachments: IMG }));
  }
  assert.equal(geminiCalls, 6, "boosters and admins should be unlimited");
});

test("an image quota of 0 means unlimited", async () => {
  setAiLimits(GUILD_ID, { daily: 0, boost: 0, cooldownSeconds: 0, imageDaily: 0 });
  geminiCalls = 0;
  for (let i = 0; i < 6; i++) {
    await handleAiMessage(client, fakeMessage(`img-free-${i}`, { attachments: IMG }));
  }
  assert.equal(geminiCalls, 6, "no gating at all");
});

test("text and image quotas are counted independently", async () => {
  setAiLimits(GUILD_ID, { daily: 1, boost: 1, cooldownSeconds: 0, imageDaily: 1 });
  const msg = fakeMessage("img-mix", { attachments: IMG });
  geminiCalls = 0;
  await handleAiMessage(client, msg);
  assert.equal(getImageUsage(GUILD_ID, "img-mix"), 1);
  assert.equal(getUsage(GUILD_ID, "img-mix"), 0);
  const text = fakeMessage("img-mix");
  await handleAiMessage(client, text);
  assert.equal(getUsage(GUILD_ID, "img-mix"), 1, "text should still be allowed after an image");
  assert.equal(getImageUsage(GUILD_ID, "img-mix"), 1, "the image count should not move");
});

test("an oversized image is skipped and never inlined", async () => {
  setAiLimits(GUILD_ID, { daily: 5, boost: 5, cooldownSeconds: 0, imageDaily: 5 });
  const tooBig = { big: { size: MAX_IMAGE_BYTES + 1 } };
  const msg = fakeMessage("img-big", { attachments: tooBig });
  geminiCalls = 0;
  lastGeminiBody = null;
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "the text still deserves an answer");
  const parts = lastGeminiBody?.contents?.[0]?.parts ?? [];
  assert.ok(!parts.some((p) => p.inlineData), "a too-large image must not be inlined");
  assert.match(parts[0].text, /could not read 1/, "and the user should be told why");
  assert.equal(getImageUsage(GUILD_ID, "img-big"), 0, "no image quota was consumed");
  assert.equal(getUsage(GUILD_ID, "img-big"), 1, "it counted as a plain text request");
});

test("an oversized image alone does not trigger the bot", async () => {
  setAiLimits(GUILD_ID, { daily: 5, boost: 5, cooldownSeconds: 0, imageDaily: 5 });
  const tooBig = { big: { size: MAX_IMAGE_BYTES + 1 } };
  geminiCalls = 0;
  await handleAiMessage(client, fakeMessage("img-big2", { content: "", attachments: tooBig }));
  assert.equal(geminiCalls, 0, "no caption and no usable image means nothing to answer");
});

test("at most MAX_IMAGES_PER_MESSAGE images are inlined", async () => {
  const many = {};
  for (let i = 0; i < MAX_IMAGES_PER_MESSAGE + 3; i++) many[`i${i}`] = {};
  const res = await collectImageParts(fakeMessage("img-many", { attachments: many }));
  assert.equal(res.parts.length, MAX_IMAGES_PER_MESSAGE, "the extra images should be dropped");
  assert.equal(res.skipped, 3, "and reported as skipped");
});

test("non-image attachments are ignored entirely", async () => {
  const doc = { doc: { contentType: "application/pdf" } };
  const res = await collectImageParts(fakeMessage("img-doc", { attachments: doc }));
  assert.equal(res.parts.length, 0);
  assert.equal(res.seen, 0, "a pdf is not an image to be counted or skipped");
});

test("an unsupported image format is skipped and reported", async () => {
  const svg = { s: { contentType: "image/svg+xml" } };
  const res = await collectImageParts(fakeMessage("img-svg", { attachments: svg }));
  assert.equal(res.parts.length, 0);
  assert.equal(res.skipped, 1);
});

test("/ai usage reports the image allowance too", async () => {
  setAiLimits(GUILD, { daily: 4, boost: 40, cooldownSeconds: 4, imageDaily: 7 });
  const it = mockInteraction("usage");
  await ai.execute({}, it);
  assert.match(it.replied.content, /quota: \*\*4\*\*/, "text quota");
  assert.match(it.replied.content, /AI images[\s\S]*quota: \*\*7\*\*/, "image quota");
});

test("/ai limits sets the image allowance", async () => {
  setAiLimits(GUILD, { daily: 5, boost: 15, cooldownSeconds: 4, imageDaily: DEFAULT_LIMITS.imageDaily });
  const it = mockInteraction("limits", { images: 12 });
  await ai.execute({}, it);
  assert.equal(getAiLimits(GUILD).imageDaily, 12);
  assert.match(it.replied.content, /\*\*12\*\* images\/day/);
});

test("a booster sees unlimited images in the limits readout", async () => {
  setAiLimits(GUILD, { daily: 5, boost: 15, cooldownSeconds: 4, imageDaily: 6 });
  const it = mockInteraction("limits");
  await ai.execute({}, it);
  assert.match(it.replied.content, /boosters \+ admins unlimited/);
});

test("the /ai limits subcommand still fits Discord's payload limit", () => {
  const json = JSON.stringify(ai.data.toJSON());
  assert.ok(json.length <= 4000, `slash command JSON is ${json.length} bytes, Discord caps at 4000`);
  const limitOpt = ai.data.toJSON().options.find((o) => o.name === "limits");
  assert.ok(
    limitOpt.options.some((o) => o.name === "images"),
    "/ai limits should expose an images option"
  );
});

/* Messages aimed at the memory guild, so quota state from the other tests
 * cannot bleed in. */
function MEMMessage(authorId, opts = {}) {
  const m = fakeMessage(authorId, opts);
  m.guild = { id: MEM };
  return m;
}

/* --- automatic memory, via function calling --- */

/* Start from a known-empty memory store so a leftover entry cannot make an
 * assert pass for the wrong reason. */
test("the memory guild starts empty", () => {
  for (const k of Object.keys(getMemories(MEM))) deleteMemory(MEM, k);
  assert.deepEqual(getMemories(MEM), {});
});

test("the model is actually offered memory tools", async () => {
  setAiLimits(MEM, { daily: 0, boost: 0, cooldownSeconds: 0, imageDaily: 0 });
  setAiEnabled(MEM, true);
  setAiChannel(MEM, "chan-1");
  nextGeminiResponse = queueGemini(textResponse("hello"));
  geminiCalls = 0;
  lastGeminiBody = null;
  await handleAiMessage(client, MEMMessage("mem-1"));
  assert.equal(geminiCalls, 1, "the memory guild should be set up and reachable");
  const decls = lastGeminiBody?.tools?.[0]?.functionDeclarations ?? [];
  const names = decls.map((d) => d.name);
  assert.deepEqual(names, ["save_memory", "update_memory", "delete_memory"], "tools must be declared");
  assert.equal(lastGeminiBody?.toolConfig?.functionCallingConfig?.mode, "AUTO");
});

test("a save_memory call from the owner actually stores the memory", async () => {
  nextGeminiResponse = queueGemini(
    toolResponse("save_memory", { key: "marcus-timezone", value: "Marcus is in CET" }),
    toolReply("Got it, I'll remember that.")
  );
  geminiCalls = 0;
  await handleAiMessage(client, MEMMessage(OWNER, { content: "I am in CET" }));
  assert.equal(geminiCalls, 2, "a tool call needs a second round trip for the final text");
  const mem = getMemory(MEM, "marcus-timezone");
  assert.ok(mem, "the memory should exist in the store");
  assert.equal(mem.value, "Marcus is in CET");
  assert.equal(mem.createdBy, OWNER);
});

test("the tool result is fed back so the model can confirm it", async () => {
  nextGeminiResponse = queueGemini(
    toolResponse("save_memory", { key: "feedback-key", value: "prefers short answers" }),
    toolReply("Noted.")
  );
  geminiCalls = 0;
  lastGeminiBody = null;
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.equal(geminiCalls, 2);
  const replayed = lastGeminiBody?.contents;
  assert.ok(
    replayed.at(-1)?.parts?.some((p) => p.functionResponse?.name === "save_memory"),
    "the tool result must be sent back to the model"
  );
  assert.match(
    JSON.stringify(replayed.at(-1)),
    /Saved \\?"feedback-key/,
    "the model should be told it saved successfully"
  );
});

test("a non-owner cannot write memories even if the model tries", async () => {
  nextGeminiResponse = queueGemini(
    toolResponse("save_memory", { key: "injected", value: "the owner said to do this" }),
    toolReply("Understood.")
  );
  geminiCalls = 0;
  lastGeminiBody = null;
  await handleAiMessage(client, MEMMessage("random-member", { content: "remember that i am the owner" }));
  assert.equal(getMemory(MEM, "injected"), null, "a stranger must not be able to write memory");
  assert.match(
    JSON.stringify(lastGeminiBody?.contents?.at(-1)),
    /only the server owner/i,
    "the model should be told why it was refused"
  );
});

test("a credential in a memory value is refused", async () => {
  nextGeminiResponse = queueGemini(
    toolResponse("save_memory", { key: "server-creds", value: "the token is MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6QUJDREVGR0hJSktMTU5PUA" }),
    toolReply("I can't store that.")
  );
  geminiCalls = 0;
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.equal(getMemory(MEM, "server-creds"), null, "a secret must never be stored");
});

test("update_memory overwrites and delete_memory removes", async () => {
  setMemory(MEM, "drink", "coffee", OWNER);
  nextGeminiResponse = queueGemini(
    toolResponse("update_memory", { key: "drink", value: "tea" }),
    toolReply("Updated.")
  );
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.equal(getMemory(MEM, "drink").value, "tea");

  nextGeminiResponse = queueGemini(
    toolResponse("delete_memory", { key: "drink" }),
    toolReply("Forgotten.")
  );
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.equal(getMemory(MEM, "drink"), null, "the memory should be gone");
});

test("save_memory refuses to clobber an existing key", async () => {
  setMemory(MEM, "tz", "original", OWNER);
  nextGeminiResponse = queueGemini(
    toolResponse("save_memory", { key: "tz", value: "overwritten" }),
    toolReply("Left it alone.")
  );
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.equal(getMemory(MEM, "tz").value, "original", "an existing memory must not be silently replaced");
});

test("several tool calls in one turn are all executed", async () => {
  nextGeminiResponse = queueGemini(
    {
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "save_memory", args: { key: "multi-a", value: "one" } } },
              { functionCall: { name: "save_memory", args: { key: "multi-b", value: "two" } } }
            ]
          }
        }
      ]
    },
    toolReply("Saved both.")
  );
  geminiCalls = 0;
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.ok(getMemory(MEM, "multi-a"), "first call should have landed");
  assert.ok(getMemory(MEM, "multi-b"), "second call should have landed too");
});

test("a model stuck in a tool loop is cut off", async () => {
  nextGeminiResponse = queueGemini(toolResponse("save_memory", { key: "loop", value: "again" }));
  geminiCalls = 0;
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.ok(geminiCalls <= 5, `the tool loop should be bounded, made ${geminiCalls} calls`);
});

test("an unknown tool name is refused rather than executed", async () => {
  nextGeminiResponse = queueGemini(
    toolResponse("drop_database", { table: "users" }),
    toolReply("I can't do that.")
  );
  geminiCalls = 0;
  await handleAiMessage(client, MEMMessage(OWNER));
  assert.match(
    JSON.stringify(lastGeminiBody?.contents?.at(-1)),
    /Unknown tool/,
    "an undeclared tool must not run"
  );
});

test("a model with no tools still replies normally", async () => {
  nextGeminiResponse = queueGemini(textResponse("just a normal answer"));
  geminiCalls = 0;
  const msg = MEMMessage(OWNER, { content: "what is the weather" });
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "no tool call means a single round trip");
  assert.equal(msg.replies.at(-1), "just a normal answer");
});

test("a model that rejects the tools still gets its answer", async () => {
  nextGeminiResponse = queueGemini(textResponse("answered without tools"));
  geminiCalls = 0;
  const msg = MEMMessage(OWNER);
  await handleAiMessage(client, msg);
  assert.equal(msg.replies.at(-1), "answered without tools", "a 400 on tools must not break the reply");
});

test("looksLikeSecret catches credentials but not ordinary facts", () => {
  for (const bad of [
    "ghp_abcdefghijklmnopqrstuvwxyz0123",
    "AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "password: hunter2",
    "-----BEGIN RSA PRIVATE KEY-----",
    "discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789-_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "reach me at someone@example.com"
  ]) {
    assert.ok(looksLikeSecret(bad), `should be treated as a secret: ${bad.slice(0, 30)}`);
  }
  for (const good of [
    "Marcus is in CET and works on the panel",
    "the server runs meetups every second Thursday",
    "she prefers dark mode",
    "reply in the general channel"
  ]) {
    assert.ok(!looksLikeSecret(good), `should be allowed: ${good}`);
  }
});

/* --- conversation memory: tracking the chat around the message --- */

const CONV = "test-aichat-conv-guild";

/* A past channel message as Discord would hand it to us. */
const pastMsg = (id, authorId, username, content, createdTimestamp, bot = false) => ({
  id,
  author: { id: authorId, username, bot },
  content,
  createdTimestamp
});

function convMessage(authorId, opts = {}) {
  const m = fakeMessage(authorId, opts);
  m.guild = { id: CONV };
  return m;
}

test("the conversation guild starts with no stored summary", () => {
  for (const ch of ["chan-1", "chan-2"]) clearConversation(CONV, ch);
  assert.equal(getConversationSummary(CONV, "chan-1"), null);
});

test("recent channel history is sent as real multi-turn context", async () => {
  setAiLimits(CONV, { daily: 0, boost: 0, cooldownSeconds: 0, imageDaily: 0 });
  setAiEnabled(CONV, true);
  setAiChannel(CONV, "chan-1");

  const history = [
    pastMsg("m1", "alice", "alice", "is the meetup still on?", 1),
    pastMsg("m2", "bob", "bob", "I think it moved to 7pm", 2),
    pastMsg("m3", "bot", "monolith", "yes, 7pm in the main room", 3, true)
  ];
  nextGeminiResponse = queueGemini(textResponse("still 7pm"));
  geminiCalls = 0;
  lastGeminiBody = null;
  await handleAiMessage(client, convMessage("carol", { content: "and where?", history }));

  const contents = lastGeminiBody?.contents ?? [];
  assert.ok(contents.length >= 4, `expected history plus the live turn, got ${contents.length}`);
  const texts = contents.map((c) => c.parts[0].text);
  assert.match(texts[0], /alice: is the meetup still on\?/, "the oldest message should come first");
  assert.match(texts[1], /bob: I think it moved to 7pm/);
  assert.match(texts[2], /You said earlier: yes, 7pm in the main room/, "the bot's own past replies are labelled as its own");
  assert.match(texts.at(-1), /carol: and where\?/, "the live turn must come last");
});

test("the triggering message is not duplicated into history", async () => {
  const m = convMessage("dave", { content: "unique-question-marker", history: [] });
  const contents = await buildHistoryContents(m, "bot");
  assert.equal(contents.length, 0);
});

test("a reply quotes the parent message into the prompt", async () => {
  nextGeminiResponse = queueGemini(textResponse("it is on friday"));
  geminiCalls = 0;
  lastGeminiBody = null;
  const parent = pastMsg("parent", "alice", "alice", "the retro is on thursday", 1);
  await handleAiMessage(
    client,
    convMessage("erin", { content: "is that right?", replyTo: parent, history: [] })
  );
  const prompt = lastGeminiBody?.contents?.at(-1)?.parts?.[0]?.text ?? "";
  assert.match(prompt, /Replying to alice/, "the reply must name who was replied to");
  assert.match(prompt, /the retro is on thursday/, "and quote what they said");
});

test("a reply to a bot message is still quoted", async () => {
  nextGeminiResponse = queueGemini(textResponse("friday, correct"));
  lastGeminiBody = null;
  const parent = pastMsg("parent", "bot", "monolith", "the retro is on thursday", 1, true);
  await handleAiMessage(
    client,
    convMessage("erin", { content: "sure?", replyTo: parent, history: [] })
  );
  const prompt = lastGeminiBody?.contents?.at(-1)?.parts?.[0]?.text ?? "";
  assert.match(prompt, /Replying to monolith/, "a reply to the bot should still be quoted");
});

test("history is capped so a busy channel cannot balloon the request", async () => {
  const many = [];
  for (let i = 0; i < CONV_HISTORY_MESSAGES + 25; i++) {
    many.push(pastMsg(`x${i}`, "u", `u${i}`, `message number ${i}`, i));
  }
  const m = convMessage("frank", { history: many });
  const contents = await buildHistoryContents(m, "bot");
  assert.ok(
    contents.length <= CONV_HISTORY_MESSAGES,
    `kept ${contents.length}, cap is ${CONV_HISTORY_MESSAGES}`
  );
  /* The newest messages must survive the cap, not the oldest. */
  assert.match(contents.at(-1).parts[0].text, new RegExp(`message number ${many.length - 1}`));
});

test("history respects the character budget", async () => {
  const huge = [];
  for (let i = 0; i < 30; i++) {
    huge.push(pastMsg(`h${i}`, "u", `u${i}`, "x".repeat(500), i));
  }
  const contents = await buildHistoryContents(convMessage("gina", { history: huge }), "bot");
  const total = contents.reduce((n, c) => n + c.parts[0].text.length, 0);
  assert.ok(total <= CONV_HISTORY_CHARS, `history was ${total} chars, budget is ${CONV_HISTORY_CHARS}`);
});

test("a channel with no history available still answers", async () => {
  nextGeminiResponse = queueGemini(textResponse("answer without history"));
  geminiCalls = 0;
  const msg = convMessage("hank", { content: "hello?", history: null });
  await handleAiMessage(client, msg);
  assert.equal(geminiCalls, 1, "missing history must not break the reply");
  assert.equal(msg.replies.at(-1), "answer without history");
});

test("a reply with no parent text does not emit an empty quote", async () => {
  nextGeminiResponse = queueGemini(textResponse("ok"));
  lastGeminiBody = null;
  const blank = pastMsg("parent", "alice", "alice", "   ", 1);
  await handleAiMessage(client, convMessage("iris", { content: "hm?", replyTo: blank, history: [] }));
  const prompt = lastGeminiBody?.contents?.at(-1)?.parts?.[0]?.text ?? "";
  assert.ok(!/Replying to/.test(prompt), "an empty parent should not produce a quote block");
});

test("a successful reply is remembered for the next turn", async () => {
  clearConversation(CONV, "chan-1");
  nextGeminiResponse = queueGemini(textResponse("the venue is the old library"));
  await handleAiMessage(client, convMessage("jack", { content: "where is the party?", history: [] }));
  const summary = getConversationSummary(CONV, "chan-1");
  assert.ok(summary, "the exchange should be recorded");
  assert.match(summary.at(-1), /jack: where is the party\?/);
});

test("the remembered summary is prepended on the next message", async () => {
  clearConversation(CONV, "chan-1");
  nextGeminiResponse = queueGemini(textResponse("first answer"));
  await handleAiMessage(client, convMessage("jack", { content: "where is the party?", history: [] }));

  nextGeminiResponse = queueGemini(textResponse("same place"));
  lastGeminiBody = null;
  await handleAiMessage(client, convMessage("jack", { content: "and tomorrow?", history: [] }));
  const prompt = lastGeminiBody?.contents?.at(-1)?.parts?.[0]?.text ?? "";
  assert.match(prompt, /WHAT YOU RECENTLY SAID IN THIS CHANNEL/);
  assert.match(prompt, /where is the party\?/, "the previous exchange should be recalled");
});

test("conversation memory is per channel", async () => {
  clearConversation(CONV, "chan-1");
  clearConversation(CONV, "chan-2");
  addConversationSummary(CONV, "chan-1", "alice: secret plans for chan-1");
  assert.match(getConversationSummary(CONV, "chan-1")?.at(-1) ?? "", /chan-1/);
  assert.equal(getConversationSummary(CONV, "chan-2"), null, "another channel must not see it");

  setAiChannel(CONV, "chan-2");
  nextGeminiResponse = queueGemini(textResponse("hi"));
  lastGeminiBody = null;
  await handleAiMessage(client, convMessage("kyle", { content: "hello", channelId: "chan-2", history: [] }));
  const prompt = lastGeminiBody?.contents?.at(-1)?.parts?.[0]?.text ?? "";
  assert.ok(!/secret plans/.test(prompt), "channel 2 must not inherit channel 1's summary");
});

test("the summary is bounded and drops the oldest entries", () => {
  clearConversation(CONV, "chan-3");
  for (let i = 0; i < CONV_SUMMARY_MAX_ENTRIES + 6; i++) {
    addConversationSummary(CONV, "chan-3", `entry ${i}`);
  }
  const summary = getConversationSummary(CONV, "chan-3");
  assert.ok(summary.length <= CONV_SUMMARY_MAX_ENTRIES, `kept ${summary.length}`);
  assert.ok(
    summary.some((l) => /entry 0\b/.test(l)) === false,
    "the oldest entry should have been dropped"
  );
});

test("summariseExchange collapses whitespace and truncates", () => {
  const line = summariseExchange("alice", "a".repeat(400).replace(/(.{40})/g, "$1 \n "));
  assert.ok(line.length <= 190, `line was ${line.length} chars`);
  assert.ok(!/\n/.test(line), "newlines should be collapsed");
  assert.match(line, /^alice: /);
});

test("clearConversation removes the stored summary", () => {
  addConversationSummary(CONV, "chan-4", "alice: something");
  assert.ok(getConversationSummary(CONV, "chan-4"));
  clearConversation(CONV, "chan-4");
  assert.equal(getConversationSummary(CONV, "chan-4"), null);
});

test("a failed reply is not recorded as conversation memory", async () => {
  clearConversation(CONV, "chan-5");
  setAiChannel(CONV, "chan-5");
  nextGeminiResponse = queueGemini({ error: true });
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("generativelanguage")) return { ok: false, status: 500, text: async () => "boom" };
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(4) };
  };
  await handleAiMessage(client, convMessage("liam", { content: "anything", channelId: "chan-5", history: [] }));
  assert.equal(getConversationSummary(CONV, "chan-5"), null, "an errored turn should not be summarised");
});

/* --- startup AI config check ---
 *
 * A missing key or owner id used to make the AI features fail silently, which
 * looks identical to the bot ignoring you. This runs on every startup, so it
 * also has to not throw.
 */
const AI_CONFIG_GUILD = "test-aichat-cfg";

function captureWarnings(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.join(" "));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return lines.join("\n");
}

test("startup says nothing when the AI is not enabled anywhere", () => {
  setAiEnabled(AI_CONFIG_GUILD, false);
  const out = captureWarnings(() => reportAiConfig([AI_CONFIG_GUILD]));
  assert.ok(!/GEMINI_API_KEY|OWNER_ID/.test(out), `unexpected warning: ${out}`);
});

test("startup warns when the AI is enabled but no API key is set", () => {
  setAiEnabled(AI_CONFIG_GUILD, true);
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const out = captureWarnings(() => reportAiConfig([AI_CONFIG_GUILD]));
    assert.match(out, /GEMINI_API_KEY is not set/, "a missing key must be reported");
  } finally {
    process.env.GEMINI_API_KEY = key;
  }
});

test("startup warns when OWNER_ID is missing, since writes would all be refused", () => {
  setAiEnabled(AI_CONFIG_GUILD, true);
  const owner = process.env.OWNER_ID;
  process.env.OWNER_ID = "";
  try {
    const out = captureWarnings(() => reportAiConfig([AI_CONFIG_GUILD]));
    assert.match(out, /OWNER_ID is not set/, "the inert memory writes should be reported");
  } finally {
    process.env.OWNER_ID = owner;
  }
});

test("startup warns when OWNER_ID is not a Discord id", () => {
  setAiEnabled(AI_CONFIG_GUILD, true);
  const owner = process.env.OWNER_ID;
  process.env.OWNER_ID = "not-a-number";
  try {
    const out = captureWarnings(() => reportAiConfig([AI_CONFIG_GUILD]));
    assert.match(out, /does not look like a Discord user ID/);
  } finally {
    process.env.OWNER_ID = owner;
  }
});

test("startup stays quiet when the AI is fully configured", () => {
  setAiEnabled(AI_CONFIG_GUILD, true);
  const key = process.env.GEMINI_API_KEY;
  const owner = process.env.OWNER_ID;
  process.env.GEMINI_API_KEY = "key-for-test";
  process.env.OWNER_ID = "123456789012345678";
  try {
    const out = captureWarnings(() => reportAiConfig([AI_CONFIG_GUILD]));
    assert.ok(out.trim() === "", `expected no warnings, got: ${out}`);
  } finally {
    process.env.GEMINI_API_KEY = key;
    process.env.OWNER_ID = owner;
  }
});

const results = [];
for (const [name, fn] of tests) {
  try {
    await fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n       ${err.message}`]);
  }
}

globalThis.fetch = realFetch;
if (realKey === undefined) delete process.env.GEMINI_API_KEY;
else process.env.GEMINI_API_KEY = realKey;

let failed = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status === "ok" ? "  ok" : "FAIL"}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
