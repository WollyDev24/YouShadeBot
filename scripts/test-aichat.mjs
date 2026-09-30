/* Tests the configurable AI rate limits.
 *
 * This imports the real src/utils/aichat.js, which opens the live SQLite
 * store, so ALWAYS run it through scripts/test-aichat.sh, which snapshots
 * src/data first and restores it afterwards.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_LIMITS,
  LIMIT_BOUNDS,
  normalizeLimits,
  requestQuota,
  getAiLimits,
  setAiLimits,
  getAiConfig,
  setAiModel,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  getUsage,
  consumeUsage
} from "../src/utils/aichat.js";
import { PermissionsBitField } from "../src/lib/discord.js";

const ADMIN = PermissionsBitField.Flags.Administrator;

const member = { premiumSince: null, permissions: { has: (f) => f === ADMIN } };
const booster = { premiumSince: new Date(), permissions: { has: () => false } };
const plain = { premiumSince: null, permissions: { has: () => false } };

const results = [];
const test = (name, fn) => {
  try {
    fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n       ${err.message}`]);
  }
};

const GUILD = "test-aichat-limits-guild";

test("defaults match the values that used to be hardcoded", () => {
  assert.deepEqual(DEFAULT_LIMITS, { daily: 5, boost: 15, cooldownSeconds: 4 });
});

test("the model list is exactly the three supported ids", () => {
  assert.deepEqual(
    AVAILABLE_MODELS.map((m) => m.id),
    ["gemini-flash-latest", "gemini-3.6-flash", "gemini-2.5-flash"]
  );
  assert.ok(
    AVAILABLE_MODELS.some((m) => m.id === DEFAULT_MODEL),
    `DEFAULT_MODEL ${DEFAULT_MODEL} is not in the selectable list`
  );
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
  assert.deepEqual(normalizeLimits({ daily: 3 }), { daily: 3, boost: 15, cooldownSeconds: 4 });
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
  assert.deepEqual(getAiLimits(GUILD), { daily: 7, boost: 15, cooldownSeconds: 4 });
  setAiLimits(GUILD, { cooldownSeconds: 0 });
  assert.deepEqual(getAiLimits(GUILD), { daily: 7, boost: 15, cooldownSeconds: 0 });
  setAiLimits(GUILD, { boost: 1, daily: 3, cooldownSeconds: 2 });
  assert.deepEqual(getAiLimits(GUILD), { daily: 3, boost: 1, cooldownSeconds: 2 });
});

test("setAiLimits clamps instead of persisting nonsense", () => {
  setAiLimits(GUILD, { daily: 10_000, boost: -4 });
  assert.deepEqual(getAiLimits(GUILD), { daily: LIMIT_BOUNDS.daily.max, boost: 0, cooldownSeconds: 2 });
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
  setAiLimits(GUILD, { daily: 5, boost: 15, cooldownSeconds: 4 });
  const it = mockInteraction("limits", { daily: 30 });
  await ai.execute({}, it);
  assert.deepEqual(getAiLimits(GUILD), { daily: 30, boost: 15, cooldownSeconds: 4 });
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
  const field = it.replied.embeds[0].fields.find((f) => f.name === "Request limits");
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
globalThis.fetch = async (url) => {
  if (String(url).includes("generativelanguage")) {
    geminiCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })
    };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function fakeMessage(authorId, { premiumSince = null } = {}) {
  const replies = [];
  return {
    guild: { id: GUILD_ID },
    author: { id: authorId, username: `u${authorId}` },
    member: {
      displayName: `u${authorId}`,
      premiumSince,
      permissions: { has: () => false }
    },
    channel: {
      id: "chan-1",
      sendTyping: async () => {}
    },
    mentions: { has: () => true },
    content: "hello",
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
