import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export function progressBar(ratio, length = 10) {
  const filled = Math.round(ratio * length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

export function getPolls(guildId) {
  return getData().polls[guildId] ?? {};
}

export function getPoll(guildId, pollId) {
  return getPolls(guildId)[pollId] ?? null;
}

export function getActivePollByMessage(messageId) {
  const allPolls = getData().polls;
  for (const [guildId, guildPolls] of Object.entries(allPolls)) {
    for (const [id, poll] of Object.entries(guildPolls)) {
      if (poll.messageId === messageId && !poll.ended) {
        return { guildId: Number(guildId), pollId: Number(id), poll };
      }
    }
  }
  return null;
}

export function createPoll(guildId, opts) {
  const polls = getPolls(guildId);
  const id = Object.keys(polls).length
    ? Math.max(...Object.keys(polls).map(Number)) + 1
    : 1;

  polls[id] = {
    id,
    question: opts.question,
    options: opts.options,
    votes: {},
    channelId: opts.channelId ?? null,
    messageId: null,
    authorId: opts.authorId,
    ended: false,
    createdAt: Date.now()
  };

  getData().polls[guildId] = polls;
  saveKey("polls");
  return polls[id];
}

export function endPoll(guildId, pollId) {
  const poll = getPoll(guildId, pollId);
  if (!poll || poll.ended) return null;
  poll.ended = true;
  saveKey("polls");
  return poll;
}

export function addVote(guildId, pollId, userId, optionIndex) {
  const poll = getPoll(guildId, pollId);
  if (!poll || poll.ended) return false;
  if (optionIndex < 0 || optionIndex >= poll.options.length) return false;

  const prev = poll.votes[userId];
  poll.votes[userId] = optionIndex;
  saveKey("polls");
  return { changed: prev !== undefined, previousIndex: prev };
}

export function removeVote(guildId, pollId, userId) {
  const poll = getPoll(guildId, pollId);
  if (!poll || poll.ended) return null;
  if (!(userId in poll.votes)) return null;
  const prev = poll.votes[userId];
  delete poll.votes[userId];
  saveKey("polls");
  return prev;
}

export function buildPollEmbed(poll) {
  const totalVotes = Object.keys(poll.votes).length;
  const counts = poll.options.map(() => 0);
  for (const opt of Object.values(poll.votes)) {
    counts[opt]++;
  }

  const lines = poll.options.map((opt, i) => {
    const count = counts[i];
    const ratio = totalVotes > 0 ? count / totalVotes : 0;
    const pct = totalVotes > 0 ? Math.round(ratio * 100) : 0;
    return `${NUMBER_EMOJIS[i]} **${opt}**\n${progressBar(ratio)} ${pct}% (${count} vote${count !== 1 ? "s" : ""})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setDescription(lines.join("\n\n"))
    .setColor(0x5865f2)
    .setFooter({ text: `${totalVotes} total vote${totalVotes !== 1 ? "s" : ""}` })
    .setTimestamp(poll.createdAt);

  return embed;
}

export function buildPollResultsEmbed(poll) {
  const totalVotes = Object.keys(poll.votes).length;
  const counts = poll.options.map(() => 0);
  for (const opt of Object.values(poll.votes)) {
    counts[opt]++;
  }

  const maxCount = Math.max(...counts, 0);
  const lines = poll.options.map((opt, i) => {
    const count = counts[i];
    const ratio = totalVotes > 0 ? count / totalVotes : 0;
    const pct = totalVotes > 0 ? Math.round(ratio * 100) : 0;
    const winner = count === maxCount && totalVotes > 0 ? " 👑" : "";
    return `${NUMBER_EMOJIS[i]} **${opt}**${winner}\n${progressBar(ratio)} ${pct}% (${count} vote${count !== 1 ? "s" : ""})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join("\n\n"))
    .setColor(0x57f287)
    .setFooter({ text: `Final results · ${totalVotes} total vote${totalVotes !== 1 ? "s" : ""}` })
    .setTimestamp();

  return embed;
}
