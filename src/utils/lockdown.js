import { PermissionsBitField } from "discord.js";
import { getData, saveKey } from "./db.js";

export function isLocked(channelId) {
  return !!getData().lockdowns[channelId]?.locked;
}

export function getStatus(channelId) {
  const entry = getData().lockdowns[channelId];
  if (!entry || !entry.locked) return null;
  return {
    locked: true,
    channelId: entry.channelId,
    lockedBy: entry.lockedBy,
    lockedAt: entry.lockedAt,
    timestamp: entry.timestamp
  };
}

export function getAllLockdowns() {
  const lockdowns = getData().lockdowns;
  return Object.values(lockdowns).filter((e) => e.locked);
}

export async function lockChannel(channel, moderatorId) {
  const everyoneRole = channel.guild.roles.everyone;

  const existingOverwrites = channel.permissionOverwrites.resolve(everyoneRole.id);
  const allow = existingOverwrites ? existingOverwrites.allow.bitfield : 0n;
  const deny = existingOverwrites ? existingOverwrites.deny.bitfield : 0n;

  const newDeny = deny | PermissionsBitField.Flags.SendMessages;

  await channel.permissionOverwrites.edit(everyoneRole, {
    SendMessages: false
  });

  getData().lockdowns[channel.id] = {
    channelId: channel.id,
    guildId: channel.guild.id,
    locked: true,
    lockedBy: moderatorId,
    lockedAt: Date.now(),
    originalAllow: allow.toString(),
    originalDeny: deny.toString()
  };
  saveKey("lockdowns");
}

export async function unlockChannel(channel) {
  const everyoneRole = channel.guild.roles.everyone;
  const entry = getData().lockdowns[channel.id];

  const originalAllow = entry?.originalAllow ? BigInt(entry.originalAllow) : 0n;
  const originalDeny = entry?.originalDeny ? BigInt(entry.originalDeny) : 0n;

  const newDeny = originalDeny & ~PermissionsBitField.Flags.SendMessages;

  await channel.permissionOverwrites.edit(everyoneRole, {
    SendMessages: null,
    ViewChannel: null,
    AddReactions: null,
    CreatePublicThreads: null,
    CreatePrivateThreads: null,
    SendMessagesInThreads: null
  });

  if (originalDeny) {
    await channel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: (newDeny & PermissionsBitField.Flags.SendMessages) !== 0n ? false : null,
      ViewChannel: (newDeny & PermissionsBitField.Flags.ViewChannel) !== 0n ? false : null,
      AddReactions: (newDeny & PermissionsBitField.Flags.AddReactions) !== 0n ? false : null,
      CreatePublicThreads: (newDeny & PermissionsBitField.Flags.CreatePublicThreads) !== 0n ? false : null,
      CreatePrivateThreads: (newDeny & PermissionsBitField.Flags.CreatePrivateThreads) !== 0n ? false : null,
      SendMessagesInThreads: (newDeny & PermissionsBitField.Flags.SendMessagesInThreads) !== 0n ? false : null
    });
  }

  delete getData().lockdowns[channel.id];
  saveKey("lockdowns");
}

export function cleanup(channelId) {
  if (getData().lockdowns[channelId]) {
    delete getData().lockdowns[channelId];
    saveKey("lockdowns");
  }
}
