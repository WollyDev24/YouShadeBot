import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const MODES = new Set(["text", "embed", "mix"]);

export function getWelcome(guildId) {
  const data = getData();
  let cfg = data.welcome[guildId];

  if (!cfg) {
    cfg = {
      enabled: false,
      channelId: null,
      message: "Welcome {user} to {server}! You are member #{memberCount}.",
      mode: "text",
      mixText: "Hey {user}, thanks for joining!",
      title: "",
      embedColor: "#5865f2"
    };
    data.welcome[guildId] = cfg;
    saveKey("welcome");
    return cfg;
  }

  let dirty = false;
  if (!cfg.mode) {
    cfg.mode = cfg.useEmbed ? "embed" : "text";
    dirty = true;
  }
  if (cfg.mixText === undefined) {
    cfg.mixText = "Hey {user}, thanks for joining!";
    dirty = true;
  }
  if (dirty) saveKey("welcome");
  return cfg;
}

export function commitWelcome(guildId) {
  getData().welcome[guildId] = getWelcome(guildId);
  saveKey("welcome");
}

export function renderTemplate(tpl, ctx) {
  return String(tpl).replace(/\{(\w+)\}/g, (match, key) => {
    switch (key.toLowerCase()) {
      case "user":
      case "mention":
        return `<@${ctx.userId}>`;
      case "username":
      case "name":
        return ctx.username;
      case "server":
      case "guild":
        return ctx.server;
      case "membercount":
        return String(ctx.memberCount);
      default:
        return match;
    }
  });
}

export function buildContext(member) {
  return {
    userId: member.id,
    username: member.displayName,
    server: member.guild?.name ?? member.guildName,
    memberCount: member.guild?.memberCount ?? member.memberCount
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PERMANENT_ERRORS = new Set(["10003", "50001", "50013"]);

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || PERMANENT_ERRORS.has(String(err.code))) throw err;
      console.warn(`[welcome] send failed (attempt ${attempt}/${attempts}): ${err.message} — retrying…`);
      await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

export function sanitize(input = {}, guild) {
  const cfg = getWelcome(guild.id);

  if ("channelId" in input)
    cfg.channelId =
      input.channelId && guild.channels.cache.get(input.channelId)?.type === 0 ? input.channelId : null;

  if ("message" in input) cfg.message = String(input.message ?? "").slice(0, 1000).trim() || cfg.message;
  if ("title" in input) cfg.title = String(input.title ?? "").slice(0, 256);
  if ("mixText" in input) cfg.mixText = String(input.mixText ?? "").slice(0, 500);
  if ("mode" in input && MODES.has(input.mode)) cfg.mode = input.mode;
  if ("useEmbed" in input && !("mode" in input)) cfg.mode = input.useEmbed ? "embed" : "text";
  if ("embedColor" in input && HEX.test(String(input.embedColor)))
    cfg.embedColor = String(input.embedColor).toLowerCase();
  if ("enabled" in input) cfg.enabled = Boolean(input.enabled);

  commitWelcome(guild.id);
  return cfg;
}

export async function sendWelcome(channel, cfg, ctx) {
  const text = renderTemplate(cfg.message, ctx);
  const payload = {};

  if (cfg.mode === "text") {
    payload.content = text;
  } else {
    const embed = new EmbedBuilder().setColor(parseInt((cfg.embedColor || "#5865f2").slice(1), 16));
    if (cfg.title) embed.setTitle(renderTemplate(cfg.title, ctx).slice(0, 256));
    embed.setDescription(text);
    payload.embeds = [embed];

    if (cfg.mode === "mix") {
      const plain = renderTemplate(cfg.mixText || "", ctx);
      payload.content = plain || undefined;
    }
  }

  return withRetry(() => channel.send(payload));
}