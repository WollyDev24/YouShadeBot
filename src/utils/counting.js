import { getData, save } from "./db.js";

export function getGuildCounting(guildId) {
  const data = getData();
  if (!data.counting[guildId])
    data.counting[guildId] = {
      channelId: null,
      current: 0,
      best: 0,
      lastUserId: null,
      strict: false,
      chill: false,
      statusMessageId: null,
      totals: {}
    };
  return data.counting[guildId];
}

export function commit(guildId) {
  getData().counting[guildId] = getGuildCounting(guildId);
  save();
}

export function incrementCount(guildId, userId) {
  const c = getGuildCounting(guildId);
  c.current += 1;
  if (c.current > c.best) c.best = c.current;
  c.lastUserId = userId;
  c.totals[userId] = (c.totals[userId] ?? 0) + 1;
  commit(guildId);
}

export function resetCount(guildId) {
  const c = getGuildCounting(guildId);
  c.current = 0;
  c.lastUserId = null;
  commit(guildId);
}

export function topCounters(guildId, limit = 10) {
  const c = getGuildCounting(guildId);
  return Object.entries(c.totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([userId, count]) => ({ userId, count }));
}

export async function upsertStatus(guildId, channel) {
  const cfg = getGuildCounting(guildId);
  const text = `\uD83D\uDCCD Count: **${cfg.current}** \u2022 Next: **${cfg.current + 1}** \u2022 Best: **${cfg.best}**${cfg.chill ? " \u2022 \u2744\uFE0F chill" : ""}`;

  if (cfg.statusMessageId) {
    try {
      const msg = await channel.messages.fetch(cfg.statusMessageId);
      await msg.edit(text);
      return;
    } catch {
      cfg.statusMessageId = null;
    }
  }
  try {
    const sent = await channel.send(text);
    cfg.statusMessageId = sent.id;
    commit(guildId);
  } catch {}
}