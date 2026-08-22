import { ChannelType, PermissionsBitField } from "../lib/discord.js";
import { getData, save as _save } from "./db.js";

export const save = _save;

const pendingDeletes = new Map();

export function getGuildTemp(guildId) {
  const data = getData();
  if (!data.temp[guildId]) data.temp[guildId] = { trigger: null, channels: {} };
  return data.temp[guildId];
}

export function isTriggerChannel(guildId, channelId) {
  const t = getGuildTemp(guildId);
  return t.trigger === channelId;
}

export function isTempChannel(guildId, channelId) {
  return Boolean(getGuildTemp(guildId).channels[channelId]);
}

export function getOwner(guildId, channelId) {
  return getGuildTemp(guildId).channels[channelId] ?? null;
}

export async function createTempChannel(guild, member, triggerChannel) {
  const parent = triggerChannel.parentId ?? null;
  const name = member.displayName.length > 28 ? member.displayName.slice(0, 28) : member.displayName;

  const channel = await guild.channels.create({
    name: `\u{1F3AC} ${name}`,
    type: ChannelType.GuildVoice,
    parent,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect],
        deny: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.KickMembers]
      }
    ]
  });

  getGuildTemp(guild.id).channels[channel.id] = member.id;
  save();

  await member.voice.setChannel(channel).catch(() => {});

  await channel
    .send(`Welcome, ${member}! This is your temporary channel.\nUse \`/temp\` commands to manage it.`)
    .catch(() => {});
  return channel;
}

export function scheduleDelete(client, guildId, channelId, delayMs = 60_000) {
  const existing = pendingDeletes.get(channelId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingDeletes.delete(channelId);
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel) return;
    const temp = getGuildTemp(guildId);
    if (temp.channels[channelId] && channel.members.size === 0) {
      delete temp.channels[channelId];
      save();
      await channel.delete("Empty temporary channel").catch(() => {});
    }
  }, delayMs);

  pendingDeletes.set(channelId, timer);
}

export function cancelDelete(channelId) {
  const timer = pendingDeletes.get(channelId);
  if (timer) clearTimeout(timer);
  pendingDeletes.delete(channelId);
}