import { EmbedBuilder } from "../lib/discord.js";
import { getData, save } from "./db.js";

export const DEFAULT_STAR = "⭐";

export function getStarboardConfig(guildId) {
  const data = getData();
  let cfg = data.starboard[guildId];
  if (!cfg || typeof cfg !== "object" || !cfg.entries) {
    cfg = { enabled: false, channelId: null, threshold: 3, emoji: DEFAULT_STAR, entries: cfg?.entries ?? {} };
    if (cfg.channelId === undefined) cfg.channelId = null;
    if (!cfg.threshold) cfg.threshold = 3;
    if (!cfg.emoji) cfg.emoji = DEFAULT_STAR;
    data.starboard[guildId] = cfg;
    save();
  }
  return cfg;
}

export function setStarboard(guildId, { channelId, threshold, emoji }) {
  const cfg = getStarboardConfig(guildId);
  const t = Number(threshold ?? cfg.threshold);
  cfg.threshold = Number.isFinite(t) && t >= 1 ? Math.min(Math.floor(t), 50) : cfg.threshold;
  if (emoji !== undefined) cfg.emoji = String(emoji).slice(0, 32) || DEFAULT_STAR;
  if (channelId) {
    cfg.channelId = String(channelId);
    cfg.enabled = true;
  }
  save();
  return cfg;
}

export function disableStarboard(guildId) {
  const cfg = getStarboardConfig(guildId);
  cfg.enabled = false;
  save();
  return cfg;
}

async function countStars(reaction, message) {
  const users = await reaction.users.fetch().catch(() => null);
  if (!users) return 0;
  let stars = 0;
  for (const user of users.values()) {
    if (user.bot) continue;
    if (message.author && user.id === message.author.id) continue;
    stars++;
  }
  return stars;
}

function buildBoardEmbed(message, stars, emoji) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({
      name: message.member?.displayName ?? message.author.username,
      iconURL: message.author.displayAvatarURL({ size: 64 })
    })
    .setDescription(message.content?.slice(0, 4000) || "*no text content*")
    .setFooter({ text: `${emoji} ${stars} · in #${message.channel.name}` })
    .setTimestamp(message.createdTimestamp);

  const image = message.attachments.find((a) => a.contentType?.startsWith("image/"));
  if (image) embed.setImage(image.url);

  const files = [...message.attachments.values()].filter((a) => a !== image);
  if (files.length) {
    embed.addFields({
      name: "Attachments",
      value: files
        .slice(0, 5)
        .map((a) => `[${a.name}](${a.url})`)
        .join("\n")
        .slice(0, 1024)
    });
  }

  return embed;
}

export async function handleStarChange(reaction) {
  try {
    if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
    if (!reaction) return;

    let message = reaction.message;
    if (message.partial) message = await message.fetch().catch(() => null);
    if (!message || !message.guild) return;

    const cfg = getStarboardConfig(message.guild.id);
    if (!cfg.enabled || !cfg.channelId) return;

    if (reaction.emoji.name !== cfg.emoji) return;
    if (message.channel.id === cfg.channelId) return;
    if (message.author?.bot) return;

    const stars = await countStars(reaction, message);
    const entry = cfg.entries[message.id];

    if (entry && stars === 0) {
      delete cfg.entries[message.id];
      save();
      const boardChannel = message.guild.channels.cache.get(cfg.channelId);
      if (boardChannel?.isTextBased()) {
        await boardChannel.messages.delete(entry.boardMessageId).catch(() => {});
      }
      return;
    }

    if (!entry && stars < cfg.threshold) return;

    const boardChannel = message.guild.channels.cache.get(cfg.channelId);
    if (!boardChannel?.isTextBased()) return;

    if (!entry) {
      const sent = await boardChannel.send({ embeds: [buildBoardEmbed(message, stars, cfg.emoji)] }).catch(() => null);
      if (!sent) return;
      cfg.entries[message.id] = { boardMessageId: sent.id, channelId: message.channel.id };
      save();
      return;
    }

    if (entry.lastStars === stars) return;
    entry.lastStars = stars;
    save();

    const boardMessage = await boardChannel.messages.fetch(entry.boardMessageId).catch(() => null);
    if (boardMessage) {
      await boardMessage.edit({ embeds: [buildBoardEmbed(message, stars, cfg.emoji)] }).catch(() => {});
    }
  } catch (err) {
    console.error("[starboard]", err.message);
  }
}
