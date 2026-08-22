import { ChannelType } from "../lib/discord.js";
import { getData, save } from "./db.js";

const limiter = (s) => (s.length > 100 ? s.slice(0, 100) : s);

export function statsConfig(guildId) {
  const data = getData();
  if (!data.stats[guildId])
    data.stats[guildId] = { categoryId: null, channels: {}, enabled: false };
  return data.stats[guildId];
}

export async function refreshStats(guild) {
  const cfg = statsConfig(guild.id);
  if (!cfg.enabled) return;

  try {
    await guild.members.fetch();
  } catch (err) {
    console.error("[stats] member fetch failed:", err.message);
  }

  const online = guild.members.cache.filter((m) => !!m.presence && m.presence.status !== "offline").size;
  const voiceUsers = guild.members.cache.filter((m) => m.voice.channelId).size;
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  const total = guild.memberCount;

  const patches = [
    [cfg.channels.total, `\u{1F465} Members: ${total}`],
    [cfg.channels.bots, `\u{1F916} Bots: ${bots}`],
    [cfg.channels.online, `\u{1F7E2} Online: ${online}`],
    [cfg.channels.voice, `\u{1F3A4} In Voice: ${voiceUsers}`]
  ].filter(([id]) => id);

  for (const [id, rawName] of patches) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.setName(limiter(rawName)).catch(() => {});
  }
}

export async function setupStats(guild) {
  const cfg = statsConfig(guild.id);

  const category = await guild.channels.create({
    name: "\u{1F4C8} Server Stats",
    type: ChannelType.GuildCategory
  });

  const mk = (name) =>
    guild.channels.create({
      name: limiter(name),
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: ["Connect", "Speak"] }]
    });

  const [total, bots, online, voice] = await Promise.all([
    mk(`\u{1F465} Members: ${guild.memberCount}`),
    mk(`\u{1F916} Bots: 0`),
    mk(`\u{1F7E2} Online: 0`),
    mk(`\u{1F3A4} In Voice: 0`)
  ]);

  cfg.categoryId = category.id;
  cfg.channels = { total: total.id, bots: bots.id, online: online.id, voice: voice.id };
  cfg.enabled = true;
  getData().stats[guild.id] = cfg;
  save();
  return cfg;
}

export async function disableStats(guild) {
  const cfg = statsConfig(guild.id);
  const ids = [...Object.values(cfg.channels), cfg.categoryId].filter(Boolean);
  for (const id of ids) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.delete().catch(() => {});
  }
  getData().stats[guild.id] = { categoryId: null, channels: {}, enabled: false };
  save();
}