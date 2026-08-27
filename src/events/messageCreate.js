import { getGuildCounting, incrementCount, resetCount, upsertStatus } from "../utils/counting.js";
import { findMatch, renderResponse } from "../utils/autores.js";
import { getAutomodConfig, checkWordFilter, checkSpam, checkMassMention, checkInviteLink, executeAction, addCase, buildCaseEmbed } from "../utils/automod.js";

const MILESTONES = new Set([69, 100, 200, 300, 400, 500, 1000, 1500, 2000]);
const replyCooldowns = new Map();
const COOLDOWN_MS = 15_000;

function extractNumber(content) {
  const m = content.trim().match(/^(\d{1,9})/);
  return m ? parseInt(m[1], 10) : null;
}

function hint(channel, text, ms = 8000) {
  channel
    .send(text)
    .then((m) => setTimeout(() => m.delete().catch(() => {}), ms))
    .catch(() => {});
}

async function runAutomod(client, message) {
  const guild = message.guild;
  const cfg = getAutomodConfig(guild.id);
  if (!cfg.enabled) return;

  const member = message.member;
  if (!member || member.permissions.has("ManageMessages")) return;

  const actions = [];

  if (cfg.wordFilter.enabled) {
    const result = checkWordFilter(guild.id, message.content);
    if (result.matched) {
      actions.push({ rule: "word-filter", reason: `Blocked word: ${result.word}` });
    }
  }

  if (cfg.inviteBlocking.enabled) {
    const result = checkInviteLink(message.content);
    if (result.invited) {
      actions.push({ rule: "invite-link", reason: "Invite link not allowed" });
    }
  }

  if (cfg.massMention.enabled) {
    const result = checkMassMention(guild.id, message);
    if (result.exceeded) {
      actions.push({ rule: "mass-mention", reason: `${result.count} mentions (threshold: ${cfg.massMention.threshold})` });
    }
  }

  if (cfg.spamDetection.enabled) {
    const result = checkSpam(guild.id, message.author.id, message.content);
    if (result.spam) {
      actions.push({ rule: "spam", reason: `Spam: ${cfg.spamDetection.messagesPerWindow} msgs in ${cfg.spamDetection.windowSeconds}s` });
    }
  }

  if (!actions.length) return;

  const action = actions[0];
  const featureKey = action.rule.replace("-", "").replace("filter", "Filter").replace("link", "Link").replace("mention", "Mention").replace("spam", "spamDetection");
  const featureCfg = cfg[action.rule.replace("-", "").replace("filter", "Filter").replace("link", "Link").replace("mention", "Mention").replace("spam", "spamDetection")] ?? {};
  const modAction = featureCfg.action ?? "delete";

  if (modAction === "delete" || modAction === "warn" || modAction === "mute" || modAction === "kick" || modAction === "ban") {
    await message.delete().catch(() => {});
  }

  let actionResult = "deleted";
  if (modAction !== "delete") {
    try {
      actionResult = await executeAction(member, modAction, action.reason, featureCfg.muteDuration ?? 300000);
    } catch (err) {
      actionResult = `failed: ${err.message}`;
    }
  }

  const caseData = addCase(guild.id, {
    userId: message.author.id,
    userTag: message.author.tag,
    moderatorId: "bot",
    action: modAction,
    rule: action.rule,
    reason: action.reason,
    messageContent: message.content.slice(0, 200),
    channelId: message.channel.id,
    messageId: message.id,
    timestamp: Date.now()
  });

  if (cfg.logChannelId) {
    const logCh = guild.channels.cache.get(cfg.logChannelId);
    if (logCh && logCh.isTextBased()) {
      try {
        await logCh.send({ embeds: [buildCaseEmbed(guild, caseData)] });
      } catch {}
    }
  }
}

export default {
  name: "messageCreate",
  async execute(client, message) {
    if (message.author.bot) return;
    const guild = message.guild;
    if (!guild) return;

    await runAutomod(client, message);

    const rule = findMatch(guild.id, message.content);
    let replied = false;
    if (rule) {
      const key = `${guild.id}:${rule.id}:${message.channel.id}`;
      const last = replyCooldowns.get(key) ?? 0;
      if (Date.now() - last > COOLDOWN_MS) {
        replyCooldowns.set(key, Date.now());
        replied = true;
        message.reply({ content: renderResponse(rule, message), allowedMentions: { repliedUser: true } }).catch(() => {});
      }
      if (replied && message.channel.id === getGuildCounting(guild.id).channelId) return;
    }

    const cfg = getGuildCounting(guild.id);
    if (!cfg.channelId || message.channel.id !== cfg.channelId) return;

    const num = extractNumber(message.content);
    const expected = cfg.current + 1;

    if (num !== null && num === expected && message.author.id !== cfg.lastUserId) {
      incrementCount(guild.id, message.author.id);
      message.react(cfg.emojis.correct).catch(() => {});
      const c = getGuildCounting(guild.id);
      if (MILESTONES.has(c.current)) {
        message.react(c.current === 69 ? c.emojis.sixtyNine : c.emojis.milestone).catch(() => {});
      }
      upsertStatus(guild.id, message.channel);
      return;
    }

    let reason;
    if (num === null) {
      if (!cfg.strict) return;
      reason = "numbers only in this channel!";
    } else if (message.author.id === cfg.lastUserId) {
      reason = "you can't count twice in a row!";
    } else {
      reason = `expected **${expected}**, not **${num}**`;
    }

    await message.delete().catch(() => {});

    if (cfg.chill) {
      hint(message.channel, `\uD83D\uDD34 ${reason} \u2014 next is still **${expected}**.`);
      return;
    }

    const reached = cfg.current;
    if (reached > 0) resetCount(guild.id);

    const tail = reached > 0 ? ` Run ended at **${reached}**.` : "";
    hint(message.channel, `\uD83D\uDD34 <@${message.author.id}>, ${reason}.${tail} Next: **1**.`);
    upsertStatus(guild.id, message.channel);
  }
};