import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const joinsPerGuild = new Map();
const createsPerGuild = new Map();

function getList(map, guildId) {
  let list = map.get(guildId);
  if (!list) {
    list = [];
    map.set(guildId, list);
  }
  return list;
}

function prune(list, windowMs, now) {
  const recent = list.filter((e) => now - e.at < windowMs);
  list.length = 0;
  list.push(...recent);
}

function getConfig(guildId) {
  const store = getData();
  if (!store.antiraid) store.antiraid = {};
  if (!store.antiraid[guildId]) {
    store.antiraid[guildId] = {
      enabled: true,
      logChannelId: null,
      windowSeconds: 10,
      threshold: 5,
      accountAgeHours: 72,
      action: "lockdown",
      lockdownChannels: true,
      lastTriggeredAt: 0,
      cases: [],
      caseCounter: 0
    };
    saveKey("antiraid");
  }
  return store.antiraid[guildId];
}

export function getAntiRaidConfig(guildId) {
  return getConfig(guildId);
}

export function saveAntiRaidConfig(guildId) {
  saveKey("antiraid");
}

export function trackJoin(guildId, member) {
  const cfg = getConfig(guildId);
  const now = Date.now();
  const windowMs = Math.max(1000, cfg.windowSeconds * 1000);
  const list = getList(joinsPerGuild, guildId);
  const accountAgeMs = member?.user ? now - new Date(member.user.createdAt).getTime() : 0;
  list.push({ at: now, accountAgeMs, userId: member?.id, tag: member?.user?.tag ?? null });
  prune(list, windowMs, now);
  const young = list.filter((j) => j.accountAgeMs < cfg.accountAgeHours * 3600000);
  return { raid: young.length >= cfg.threshold, count: young.length, users: young };
}

export function trackChannelCreate(guildId) {
  const cfg = getConfig(guildId);
  const now = Date.now();
  const windowMs = Math.max(1000, cfg.windowSeconds * 1000);
  const list = getList(createsPerGuild, guildId);
  list.push({ at: now });
  prune(list, windowMs, now);
  return { raid: list.length >= cfg.threshold, count: list.length };
}

export function getWindowStats(guildId) {
  const cfg = getConfig(guildId);
  const windowMs = Math.max(1000, cfg.windowSeconds * 1000);
  const now = Date.now();
  return {
    joins: getList(joinsPerGuild, guildId).filter((j) => now - j.at < windowMs).length,
    creates: getList(createsPerGuild, guildId).filter((c) => now - c.at < windowMs).length
  };
}

export function buildAntiRaidEmbed(cfg, type, count, threshold, action) {
  const status = cfg.enabled
    ? `Enabled — ${cfg.threshold} ${type} within ${cfg.windowSeconds}s triggers **${action}**`
    : "Disabled";
  return new EmbedBuilder()
    .setTitle("Anti Raid")
    .setColor(0x5865f2)
    .setDescription(status)
    .addFields(
      { name: "New account window", value: `${cfg.accountAgeHours}h`, inline: true },
      { name: "Action", value: action, inline: true },
      { name: "Lockdown channels", value: cfg.lockdownChannels ? "Yes" : "No", inline: true }
    )
    .setTimestamp();
}

export async function executeAntiRaid(client, guild, info) {
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return null;

  const now = Date.now();
  if (now - (cfg.lastTriggeredAt || 0) < 60_000) return null;
  cfg.lastTriggeredAt = now;
  saveAntiRaidConfig(guild.id);

  const detail = [];
  let lockedCount = 0;

  if (cfg.lockdownChannels || cfg.action === "lockdown") {
    const { lockChannel } = await import("./lockdown.js");
    const rooms = guild.channels.cache.filter((c) => c.isTextBased() && c.permissionsFor(guild.roles.everyone)?.has("SendMessages"));
    for (const ch of rooms.values()) {
      try {
        await lockChannel(ch, "bot-auto");
        lockedCount++;
      } catch {}
    }
    detail.push(`locked ${lockedCount} channel${lockedCount === 1 ? "" : "s"}`);
  }

  if (cfg.action === "kick" || cfg.action === "ban") {
    for (const u of info.users ?? []) {
      const target = guild.members.cache.get(u.userId);
      if (!target) continue;
      const reason = "Anti-raid: new account burst";
      try {
        if (cfg.action === "kick") await target.kick(reason);
        else await target.ban({ reason });
        detail.push(`${cfg.action} ${u.tag}`);
      } catch {}
    }
  }

  const caseData = addCase(guild.id, {
    type: info.type,
    count: info.count,
    action: cfg.action,
    detail: detail.join(", ")
  });

  if (cfg.logChannelId) {
    const channel = guild.channels.cache.get(cfg.logChannelId);
    if (channel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle("Anti Raid triggered")
        .setColor(0xff453a)
        .setDescription(`${info.count} ${info.type} within ${cfg.windowSeconds}s`)
        .addFields(
          { name: "Action", value: cfg.action, inline: true },
          { name: "Detail", value: caseData.detail || "reported", inline: false }
        )
        .setFooter({ text: `Case #${caseData.caseNumber}` })
        .setTimestamp();
      try {
        await channel.send({ embeds: [embed] });
      } catch {}
    }
  }

  return { caseNumber: caseData.caseNumber, detail: detail.join(", "), count: info.count };
}

export function addCase(guildId, caseData) {
  const cfg = getConfig(guildId);
  cfg.caseCounter++;
  caseData.caseNumber = cfg.caseCounter;
  caseData.timestamp = Date.now();
  cfg.cases.push(caseData);
  saveAntiRaidConfig(guildId);
  return caseData;
}

export function getCases(guildId, limit = 10) {
  const cfg = getConfig(guildId);
  return cfg.cases.slice(-limit);
}

export function clearCases(guildId) {
  const cfg = getConfig(guildId);
  cfg.cases = [];
  cfg.caseCounter = 0;
  saveAntiRaidConfig(guildId);
  return cfg;
}