import { getGuildCounting, incrementCount, resetCount, upsertStatus } from "../utils/counting.js";

const MILESTONES = new Set([69, 100, 200, 300, 400, 500, 1000, 1500, 2000]);

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

export default {
  name: "messageCreate",
  async execute(client, message) {
    if (message.author.bot) return;
    const guild = message.guild;
    if (!guild) return;

    const cfg = getGuildCounting(guild.id);
    if (!cfg.channelId || message.channel.id !== cfg.channelId) return;

    const num = extractNumber(message.content);
    const expected = cfg.current + 1;

    if (num !== null && num === expected && message.author.id !== cfg.lastUserId) {
      incrementCount(guild.id, message.author.id);
      message.react("\u2705").catch(() => {});
      const c = getGuildCounting(guild.id);
      if (MILESTONES.has(c.current)) {
        message.react(c.current === 69 ? "\uD83D\uDD25" : "\uD83C\uDF89").catch(() => {});
      }
      upsertStatus(guild.id, message.channel);
      return;
    }

    let reason;
    if (num === null) {
      if (!cfg.strict) return; // lenient: normal chatter is allowed
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