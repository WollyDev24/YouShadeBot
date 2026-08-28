import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

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

export function toggleVote(guildId, pollId, userId, optionIndex) {
  const poll = getPoll(guildId, pollId);
  if (!poll || poll.ended) return null;
  if (optionIndex < 0 || optionIndex >= poll.options.length) return null;

  const current = poll.votes[userId];
  if (current === optionIndex) {
    delete poll.votes[userId];
    saveKey("polls");
    return { action: "removed", index: optionIndex };
  }

  poll.votes[userId] = optionIndex;
  saveKey("polls");
  return { action: current === undefined ? "added" : "changed", index: optionIndex, previousIndex: current };
}

export function buildPollButtons(poll) {
  const rows = [];
  let row = new ActionRowBuilder();
  poll.options.forEach((opt, i) => {
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`poll:vote:${poll.id}:${i}`)
        .setLabel(`${i + 1}. ${opt}`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
    );
  });
  rows.push(row);
  return rows;
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
    return `**${i + 1}. ${opt}**\n${progressBar(ratio)} ${pct}% (${count} vote${count !== 1 ? "s" : ""})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join("\n\n"))
    .setColor(0x5865f2)
    .setFooter({ text: `Use the buttons below to vote · ${totalVotes} total vote${totalVotes !== 1 ? "s" : ""}` })
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
    return `**${i + 1}. ${opt}**${winner}\n${progressBar(ratio)} ${pct}% (${count} vote${count !== 1 ? "s" : ""})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join("\n\n"))
    .setColor(0x57f287)
    .setFooter({ text: `Final results · ${totalVotes} total vote${totalVotes !== 1 ? "s" : ""}` })
    .setTimestamp();

  return embed;
}
