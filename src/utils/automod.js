import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const spamTracker = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of spamTracker.entries()) {
    const windowMs = data.windowSeconds * 2000;
    const filtered = data.timestamps.filter(t => now - t < windowMs);
    if (filtered.length === 0) {
      spamTracker.delete(key);
    } else {
      data.timestamps = filtered;
    }
  }
}, 60000);

function getConfig(guildId) {
  const store = getData();
  if (!store.automod) store.automod = {};
  if (!store.automod[guildId]) {
    store.automod[guildId] = {
      enabled: false,
      logChannelId: null,
      wordFilter: { enabled: false, words: [], action: "delete", muteDuration: 300000 },
      spamDetection: { enabled: false, messagesPerWindow: 5, windowSeconds: 10, action: "warn", muteDuration: 300000 },
      massMention: { enabled: false, threshold: 5, action: "delete", muteDuration: 300000 },
      inviteBlocking: { enabled: false, action: "delete", muteDuration: 300000 },
      cases: [],
      caseCounter: 0
    };
    saveKey("automod", store.automod);
  }
  return store.automod[guildId];
}

export function getAutomodConfig(guildId) {
  return getConfig(guildId);
}

export function getCaseCount(guildId) {
  return getConfig(guildId).caseCounter;
}

export function addCase(guildId, caseData) {
  const config = getConfig(guildId);
  config.caseCounter++;
  caseData.caseNumber = config.caseCounter;
  caseData.timestamp = Date.now();
  config.cases.push(caseData);
  saveKey("automod", getData().automod);
  return caseData;
}

export function getCases(guildId, limit = 10) {
  const config = getConfig(guildId);
  return config.cases.slice(-limit);
}

export function checkWordFilter(guildId, content) {
  const config = getConfig(guildId);
  if (!config.wordFilter.enabled || config.wordFilter.words.length === 0) {
    return { matched: false, word: null };
  }
  for (const word of config.wordFilter.words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(content)) {
      return { matched: true, word };
    }
  }
  return { matched: false, word: null };
}

export function checkSpam(guildId, userId, content) {
  const config = getConfig(guildId);
  if (!config.spamDetection.enabled) {
    return { spam: false };
  }
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const windowMs = config.spamDetection.windowSeconds * 1000;
  if (!spamTracker.has(key)) {
    spamTracker.set(key, { timestamps: [], windowSeconds: config.spamDetection.windowSeconds });
  }
  const tracker = spamTracker.get(key);
  tracker.timestamps = tracker.timestamps.filter(t => now - t < windowMs);
  tracker.timestamps.push(now);
  if (tracker.timestamps.length >= config.spamDetection.messagesPerWindow) {
    return { spam: true };
  }
  return { spam: false };
}

export function checkMassMention(guildId, message) {
  const config = getConfig(guildId);
  if (!config.massMention.enabled) {
    return { exceeded: false, count: 0 };
  }
  const userMentions = message.mentions?.users?.size || 0;
  const roleMentions = message.mentions?.roles?.size || 0;
  const total = userMentions + roleMentions;
  if (total >= config.massMention.threshold) {
    return { exceeded: true, count: total };
  }
  return { exceeded: false, count: total };
}

export function checkInviteLink(content) {
  const regex = /(discord\.(gg|com\/invite|app\/com\/invite)|dis\.gd)\/\w+/i;
  return { invited: regex.test(content) };
}

export async function executeAction(member, action, reason, duration) {
  switch (action) {
    case "warn":
      return `Warned ${member.user.tag}`;
    case "mute":
      await member.timeout(duration || 300000, reason);
      return `Muted ${member.user.tag} for ${Math.ceil((duration || 300000) / 60000)} minutes`;
    case "kick":
      await member.kick(reason);
      return `Kicked ${member.user.tag}`;
    case "ban":
      await member.ban({ reason });
      return `Banned ${member.user.tag}`;
    default:
      return `Unknown action: ${action}`;
  }
}

export function buildCaseEmbed(guild, caseData) {
  const embed = new EmbedBuilder()
    .setTitle(`Case #${caseData.caseNumber}`)
    .setColor(0xffa500)
    .addFields(
      { name: "User", value: `${caseData.userTag} (${caseData.userId})`, inline: true },
      { name: "Moderator", value: `${caseData.moderatorTag} (${caseData.moderatorId})`, inline: true },
      { name: "Action", value: caseData.action, inline: true }
    )
    .setTimestamp(caseData.timestamp);
  if (caseData.reason) {
    embed.addFields({ name: "Reason", value: caseData.reason, inline: false });
  }
  if (caseData.duration) {
    embed.addFields({ name: "Duration", value: `${Math.ceil(caseData.duration / 60000)} minutes`, inline: true });
  }
  return embed;
}
