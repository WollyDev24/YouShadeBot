import { PermissionsBitField } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

export const DEFAULT_MODEL = "gemini-3.6-flash";
export const BASE_LIMIT = 5;
export const BOOST_LIMIT = 15;

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const COOLDOWN_MS = 4000;
const cooldowns = new Map();
const notifiedToday = new Map();

const SYSTEM_PROMPT =
  "You are Monolith, an AI assistant living inside a Discord server. " +
  "Keep answers friendly, concise and Discord-appropriate. Use minimal markdown. " +
  "Never exceed about 1800 characters. If something is unclear, ask a short clarifying question.";

function cfg(guildId) {
  const data = getData();
  if (!data.aichat[guildId]) {
    data.aichat[guildId] = { enabled: false, channels: [], model: DEFAULT_MODEL, usage: {} };
  }
  return data.aichat[guildId];
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
  c.model = String(model ?? "").trim().slice(0, 60) || DEFAULT_MODEL;
  saveKey("aichat");
  return c;
}

export function requestQuota(member) {
  if (!member) return BASE_LIMIT;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return Infinity;
  if (member.premiumSince) return BOOST_LIMIT;
  return BASE_LIMIT;
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

function stripMentions(content) {
  return String(content ?? "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/<@&\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function askGemini(model, prompt, apiKey) {
  const url = `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim() ?? "";
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
  const quota = requestQuota(member);

  if (Number.isFinite(quota) && getUsage(guild.id, message.author.id) >= quota) {
    const dayKey = `${guild.id}:${message.author.id}:${today()}`;
    if (!notifiedToday.has(dayKey)) {
      notifiedToday.set(dayKey, true);
      message
        .reply(
          quota === BOOST_LIMIT
            ? `**Monolith AI limit reached.** You have used your **${quota}** booster requests for today.`
            : `**Monolith AI limit reached.** You have used your **${quota}** requests for today. Boost the server for **${BOOST_LIMIT}**/day — server admins get unlimited.`
        )
        .catch(() => {});
    }
    return;
  }

  const cdKey = `${message.author.id}:${message.channel.id}`;
  const last = cooldowns.get(cdKey) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  cooldowns.set(cdKey, Date.now());

  try {
    if (typeof message.channel.sendTyping === "function") message.channel.sendTyping().catch(() => {});
    const name = member?.displayName ?? message.author.username;
    const text = await askGemini(c.model, `${name}: ${prompt}`, apiKey);
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