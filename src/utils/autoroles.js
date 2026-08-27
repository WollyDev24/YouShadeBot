import { getData, saveKey } from "./db.js";

export function getAutoRoles(guildId) {
  const cfg = getData().autoroles[guildId];
  return {
    humanRoleId: cfg?.humanRoleId ?? null,
    botRoleId: cfg?.botRoleId ?? null
  };
}

function validateRole(guild, roleId) {
  if (!roleId) return null;
  const role = guild.roles.cache.get(roleId);
  if (!role) throw new Error("That role doesn't exist (anymore).");
  if (role.id === guild.roles.everyone.id) throw new Error("You can't auto-assign @everyone.");
  if (role.managed) throw new Error(`**${role.name}** is managed by an integration and can't be assigned.`);
  const me = guild.members.me;
  if (me && me.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error(
      `**${role.name}** is above my highest role — move my role higher in Server Settings > Roles first.`
    );
  }
  return role;
}

export function setAutoRoles(guild, { humanRoleId, botRoleId }) {
  if (!humanRoleId && !botRoleId) throw new Error("Pick at least one role (humans or bots).");
  const human = validateRole(guild, humanRoleId);
  const bot = validateRole(guild, botRoleId);

  getData().autoroles[guild.id] = {
    humanRoleId: human?.id ?? null,
    botRoleId: bot?.id ?? null
  };
  saveKey("autoroles");
  return getAutoRoles(guild.id);
}

export function disableAutoRoles(guildId) {
  delete getData().autoroles[guildId];
  saveKey("autoroles");
}

export async function applyAutoRoles(member) {
  const { humanRoleId, botRoleId } = getAutoRoles(member.guild.id);
  const roleId = member.user.bot ? botRoleId : humanRoleId;
  if (!roleId) return;

  const role = member.guild.roles.cache.get(roleId);
  if (!role || role.managed) return;

  try {
    await member.roles.add(roleId, "Auto role on join");
  } catch (err) {
    console.error(`[autoroles] failed to add ${role.name} to ${member.user.tag}:`, err.message);
  }
}
