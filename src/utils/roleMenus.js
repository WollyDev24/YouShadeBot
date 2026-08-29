import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const STORE_KEY = "roleMenus";
const MAX_ROLES = 25;

export function getRoleMenus(guildId) {
  const data = getData();
  return data.roleMenus[guildId] ?? {};
}

export function getRoleMenu(guildId, messageId) {
  return getRoleMenus(guildId)[messageId] ?? null;
}

export function createRoleMenu(guildId, opts) {
  const data = getData();
  if (!data.roleMenus[guildId]) data.roleMenus[guildId] = {};
  const id = opts.id ?? String(Date.now());
  const config = {
    id,
    channelId: String(opts.channelId),
    messageId: null,
    title: String(opts.title ?? "Role Menu").slice(0, 100),
    description: String(opts.description ?? "Select the roles you want.").slice(0, 500),
    color: String(opts.color ?? "#5865F2"),
    mode: opts.mode === "unique" ? "unique" : "multi",
    roles: []
  };
  data.roleMenus[guildId][id] = config;
  saveKey(STORE_KEY);
  return config;
}

export function addRole(guildId, messageId, roleId, label) {
  const config = getRoleMenu(guildId, messageId);
  if (!config) return { ok: false, error: "menu not found" };
  if (config.roles.length >= MAX_ROLES) return { ok: false, error: `max ${MAX_ROLES} roles` };
  if (config.roles.some((r) => r.roleId === roleId)) return { ok: false, error: "role already in menu" };
  config.roles.push({ roleId: String(roleId), label: String(label ?? "").slice(0, 80) });
  saveKey(STORE_KEY);
  return { ok: true, config };
}

export function removeRole(guildId, messageId, roleId) {
  const config = getRoleMenu(guildId, messageId);
  if (!config) return { ok: false, error: "menu not found" };
  const before = config.roles.length;
  config.roles = config.roles.filter((r) => r.roleId !== roleId);
  if (config.roles.length === before) return { ok: false, error: "role not in menu" };
  saveKey(STORE_KEY);
  return { ok: true, config };
}

export function deleteRoleMenu(guildId, messageId) {
  const data = getData();
  if (!data.roleMenus[guildId] || !data.roleMenus[guildId][messageId]) return false;
  delete data.roleMenus[guildId][messageId];
  saveKey(STORE_KEY);
  return true;
}

export function buildMenuText(config) {
  if (!config.roles.length) return [];
  const lines = config.roles.map((r) => {
    const name = r.label || "role";
    return `• ${name} — <@&${r.roleId}>`;
  });
  return lines;
}

export function buildMenuPayload(guild, config) {
  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(config.title)
    .setDescription(config.description);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rolemenu:${config.id}`)
    .setPlaceholder(config.mode === "unique" ? "Pick one role" : "Choose your roles");

  const lines = buildMenuText(config);
  embed.setFooter({ text: lines.length ? lines.join("\n") : "No roles configured yet." });

  for (const r of config.roles) {
    const role = guild?.roles.cache.get(r.roleId);
    const label = (r.label ? `${r.label}` : role?.name ?? "Role").slice(0, 80);
    const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(r.roleId).setDescription(role ? `@${role.name}` : "Deleted role");
    menu.addOptions(opt);
  }

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

export async function handleMenuSelect(interaction) {
  const [, id] = interaction.customId.split(":");
  const guildId = interaction.guildId;
  const config = getRoleMenu(guildId, id);
  if (!config) return interaction.reply({ content: "This role menu no longer exists.", flags: MessageFlags.Ephemeral }).catch(() => {});
  if (!config.roles.length) return interaction.reply({ content: "No roles configured for this menu.", flags: MessageFlags.Ephemeral }).catch(() => {});

  const selected = interaction.values;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return;

  if (config.mode === "unique") {
    const keep = selected[0];
    const added = [];
    for (const r of config.roles) {
      if (member.roles.cache.has(r.roleId) && r.roleId !== keep) {
        await member.roles.remove(r.roleId).catch(() => {});
      }
    }
    if (keep && !member.roles.cache.has(keep)) {
      await member.roles.add(keep).catch(() => {});
      added.push(keep);
    }
    const addedNames = added.map((id) => `<@&${id}>`).join(", ");
    return interaction.reply({
      content: addedNames ? `Role added: ${addedNames}` : "No change.",
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }

  // multi mode: toggle
  for (const id of selected) {
    if (member.roles.cache.has(id)) await member.roles.remove(id).catch(() => {});
    else await member.roles.add(id).catch(() => {});
  }
  return interaction.reply({ content: "Updated your roles.", flags: MessageFlags.Ephemeral }).catch(() => {});
}
