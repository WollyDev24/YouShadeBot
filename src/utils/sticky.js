import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const timers = new Map();

function commitGuild(guildId, data) {
  getData().sticky[guildId] = data;
  saveKey("sticky");
}

export function getStickyAll(guildId) {
  return getData().sticky[guildId] ?? {};
}

export function getSticky(guildId, channelId) {
  return getStickyAll(guildId)[channelId] ?? null;
}

export function setSticky(guildId, channelId, opts) {
  const data = getStickyAll(guildId);
  data[channelId] = {
    content: opts.content,
    embedJson: opts.embedJson ?? null,
    authorTag: opts.authorTag,
    authorId: opts.authorId,
    interval: opts.interval ?? 5,
    messageId: null
  };
  commitGuild(guildId, data);
  return data[channelId];
}

export function removeSticky(guildId, channelId) {
  const data = getStickyAll(guildId);
  const removed = data[channelId];
  if (!removed) return null;
  delete data[channelId];
  commitGuild(guildId, data);
  clearTimer(guildId, channelId);
  return removed;
}

export function getAllActive() {
  const result = [];
  for (const [guildId, channels] of Object.entries(getData().sticky ?? {})) {
    for (const [channelId, sticky] of Object.entries(channels)) {
      result.push({ guildId, channelId, ...sticky });
    }
  }
  return result;
}

function timerKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function clearTimer(guildId, channelId) {
  const key = timerKey(guildId, channelId);
  const t = timers.get(key);
  if (t) {
    clearInterval(t);
    timers.delete(key);
  }
}

export async function repostSticky(client, guildId, channelId) {
  const sticky = getSticky(guildId, channelId);
  if (!sticky) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return;

  if (sticky.messageId) {
    const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const msgPayload = { content: sticky.content };

  if (sticky.embedJson) {
    try {
      const embed = EmbedBuilder.from(JSON.parse(sticky.embedJson));
      msgPayload.embeds = [embed];
    } catch {}
  }

  try {
    const msg = await channel.send(msgPayload);
    sticky.messageId = msg.id;
    commitGuild(guildId, getStickyAll(guildId));
  } catch (err) {
    console.error(`[sticky] repost failed in ${channelId}:`, err.message);
  }
}

export function startTimer(client, guildId, channelId) {
  const sticky = getSticky(guildId, channelId);
  if (!sticky) return;

  clearTimer(guildId, channelId);

  const intervalMs = Math.max(1, sticky.interval) * 60_000;
  const key = timerKey(guildId, channelId);

  const t = setInterval(() => {
    repostSticky(client, guildId, channelId);
  }, intervalMs);

  timers.set(key, t);
}

export function restoreAllTimers(client) {
  for (const { guildId, channelId } of getAllActive()) {
    startTimer(client, guildId, channelId);
  }
}

export function getStickyCount(guildId) {
  return Object.keys(getStickyAll(guildId)).length;
}
