import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const STORE_KEY = "reactionRoles";

export function getReactionRoles(guildId) {
  const data = getData();
  return data.reactionRoles[guildId] ?? {};
}

export function getReactionRole(guildId, messageId) {
  return getReactionRoles(guildId)[messageId] ?? null;
}

export function createReactionRole(guildId, opts) {
  const data = getData();
  if (!data.reactionRoles[guildId]) data.reactionRoles[guildId] = {};
  const config = {
    channelId: String(opts.channelId),
    messageId: null,
    mode: opts.mode === "synced" ? "synced" : "unique",
    title: String(opts.title ?? "Reaction Roles"),
    description: String(opts.description ?? "React to get a role."),
    color: String(opts.color ?? "#5865F2"),
    mappings: {}
  };
  data.reactionRoles[guildId][config.messageId] = config;
  saveKey(STORE_KEY);
  return config;
}

export function addMapping(guildId, messageId, emoji, roleId, label) {
  const config = getReactionRole(guildId, messageId);
  if (!config) return null;
  config.mappings[emoji] = { roleId: String(roleId), label: String(label ?? "") };
  saveKey(STORE_KEY);
  return config;
}

export function removeMapping(guildId, messageId, emoji) {
  const config = getReactionRole(guildId, messageId);
  if (!config) return false;
  if (!(emoji in config.mappings)) return false;
  delete config.mappings[emoji];
  saveKey(STORE_KEY);
  return true;
}

export function deleteReactionRole(guildId, messageId) {
  const data = getData();
  const guild = data.reactionRoles[guildId];
  if (!guild || !(messageId in guild)) return false;
  delete guild[messageId];
  saveKey(STORE_KEY);
  return true;
}

export function normalizeEmoji(emoji) {
  if (emoji.id) {
    const prefix = emoji.animated ? "a" : "";
    return `<${prefix}:${emoji.name}:${emoji.id}>`;
  }
  return emoji.name;
}

export function buildReactionRoleMessage(guild, config) {
  const lines = Object.entries(config.mappings).map(
    ([emoji, mapping]) => `${emoji} → <@&${mapping.roleId}>${mapping.label ? ` (${mapping.label})` : ""}`
  );

  const embed = new EmbedBuilder()
    .setTitle(config.title)
    .setDescription(config.description)
    .setColor(config.color)
    .setFooter({ text: lines.length ? lines.join("\n") : "No roles configured." });

  return { embeds: [embed], components: [] };
}

export async function handleReactionAdd(reaction, user) {
  try {
    if (user.bot) return;

    if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
    if (!reaction) return;

    let message = reaction.message;
    if (message.partial) message = await message.fetch().catch(() => null);
    if (!message || !message.guild) return;

    const config = getReactionRole(message.guild.id, message.id);
    if (!config) return;

    const emojiKey = normalizeEmoji(reaction.emoji);
    const mapping = config.mappings[emojiKey];
    if (!mapping) return;

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (config.mode === "unique") {
      for (const [key, m] of Object.entries(config.mappings)) {
        if (key !== emojiKey && member.roles.cache.has(m.roleId)) {
          await member.roles.remove(m.roleId).catch(() => {});
        }
      }
    }

    await member.roles.add(mapping.roleId).catch(() => {});
  } catch (err) {
    console.error("[reactionRoles] handleReactionAdd:", err.message);
  }
}

export async function handleReactionRemove(reaction, user) {
  try {
    if (user.bot) return;

    if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
    if (!reaction) return;

    let message = reaction.message;
    if (message.partial) message = await message.fetch().catch(() => null);
    if (!message || !message.guild) return;

    const config = getReactionRole(message.guild.id, message.id);
    if (!config) return;

    const emojiKey = normalizeEmoji(reaction.emoji);
    const mapping = config.mappings[emojiKey];
    if (!mapping) return;

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    await member.roles.remove(mapping.roleId).catch(() => {});
  } catch (err) {
    console.error("[reactionRoles] handleReactionRemove:", err.message);
  }
}
