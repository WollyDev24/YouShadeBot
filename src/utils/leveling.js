import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const XP_PER_MESSAGE = 10;
const XP_COOLDOWN_MS = 60_000;
const xpCooldowns = new Map();

export function getLeveling(guildId) {
  const data = getData();
  if (!data.leveling[guildId]) {
    data.leveling[guildId] = {
      enabled: false,
      annChannelId: null,
      removeLower: true,
      roles: {},
      users: {}
    };
  }
  const l = data.leveling[guildId];
  if (!l.roles) l.roles = {};
  if (!l.users) l.users = {};
  return l;
}

export function commit(guildId) {
  getData().leveling[guildId] = getLeveling(guildId);
  saveKey("leveling");
}

export function xpAtLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

export function levelFromXp(xp) {
  let level = 0;
  while (xp >= xpAtLevel(level + 1)) level++;
  return level;
}

export function progressInLevel(xp) {
  const level = levelFromXp(xp);
  const base = xpAtLevel(level);
  const next = xpAtLevel(level + 1);
  return { level, current: xp - base, needed: next - base };
}

export function canEarnXp(userId) {
  const last = xpCooldowns.get(userId) ?? 0;
  if (Date.now() - last < XP_COOLDOWN_MS) return false;
  xpCooldowns.set(userId, Date.now());
  return true;
}

export function getUserData(guildId, userId) {
  const l = getLeveling(guildId);
  if (!l.users[userId]) l.users[userId] = { xp: 0 };
  return l.users[userId];
}

export async function grantXp(client, guildId, userId) {
  const l = getLeveling(guildId);
  if (!l.enabled) return null;

  const user = getUserData(guildId, userId);
  const before = levelFromXp(user.xp);
  user.xp += XP_PER_MESSAGE;
  const after = levelFromXp(user.xp);
  commit(guildId);

  if (after <= before) return null;

  const guild = client.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(userId);
  if (guild && member && !member.user?.bot) {
    for (let lvl = before + 1; lvl <= after; lvl++) {
      const roleId = l.roles[lvl];
      if (!roleId) continue;
      await member.roles.add(roleId).catch(() => {});
      if (l.removeLower) {
        for (const [prevLvl, prevRoleId] of Object.entries(l.roles)) {
          if (Number(prevLvl) < lvl && prevRoleId !== roleId && member.roles.cache.has(prevRoleId)) {
            await member.roles.remove(prevRoleId).catch(() => {});
          }
        }
      }
    }
    if (l.annChannelId) {
      const ch = guild.channels.cache.get(l.annChannelId);
      if (ch && ch.isTextBased()) {
        ch.send(`🎉 <@${userId}> reached **level ${after}**!`).catch(() => {});
      }
    }
  }

  return after;
}

export function topLevels(guildId, limit = 10) {
  const l = getLeveling(guildId);
  return Object.entries(l.users)
    .map(([userId, d]) => ({ userId, xp: d.xp, level: levelFromXp(d.xp) }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

export function countUsers(guildId) {
  return Object.keys(getLeveling(guildId).users).length;
}

export function buildRankEmbed(guildId, userId) {
  const l = getLeveling(guildId);
  const user = l.users[userId];
  const embed = new EmbedBuilder().setColor(0x57f287);

  if (!user) {
    embed.setTitle("No XP yet").setDescription("Start chatting to earn XP!");
    return embed;
  }

  const { level, current, needed } = progressInLevel(user.xp);
  const barWidth = 12;
  const ratio = current / Math.max(needed, 1);
  const filled = Math.round(ratio * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  embed
    .setTitle(`<@${userId}>`)
    .setDescription(
      `**Level ${level}**\n${bar} ${current}/${needed} XP\nTotal: **${user.xp}** XP`
    );
  return embed;
}
