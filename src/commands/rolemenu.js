import { SlashCommandBuilder, MessageFlags, EmbedBuilder, PermissionFlagsBits } from "../lib/discord.js";
import {
  getRoleMenus,
  getRoleMenu,
  createRoleMenu,
  addRole,
  removeRole,
  deleteRoleMenu,
  buildMenuPayload
} from "../utils/roleMenus.js";

function checkAdmin(interaction) {
  if (
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member.id === interaction.guild.ownerId
  ) {
    return true;
  }
  interaction
    .reply({ content: "You need the **Manage Server** permission to do that.", flags: MessageFlags.Ephemeral })
    .catch(() => {});
  return false;
}

async function rerender(client, guildId, config) {
  const guild = client.guilds.cache.get(guildId);
  const ch = guild?.channels.cache.get(config.channelId);
  if (!ch || !config.messageId) return;
  const msg = await ch.messages.fetch(config.messageId).catch(() => null);
  if (msg) await msg.edit(buildMenuPayload(guild, config)).catch(() => {});
}

export default {
  data: new SlashCommandBuilder()
    .setName("rolemenu")
    .setDescription("Create a select-menu role picker")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create a role menu in a channel")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel to post the menu in").setRequired(true))
        .addStringOption((o) => o.setName("title").setDescription("Menu title").setMaxLength(100))
        .addStringOption((o) => o.setName("description").setDescription("Short description").setMaxLength(500))
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("unique = one role only, multi = combine roles (default multi)")
            .addChoices(
              { name: "Multi (combine roles)", value: "multi" },
              { name: "Unique (pick one)", value: "unique" }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName("addrole")
        .setDescription("Add a role to a role menu")
        .addStringOption((o) => o.setName("id").setDescription("Role menu ID (see /rolemenu list)").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to add").setRequired(true))
        .addStringOption((o) => o.setName("label").setDescription("Custom label (default: role name)"))
    )
    .addSubcommand((s) =>
      s
        .setName("removerole")
        .setDescription("Remove a role from a role menu")
        .addStringOption((o) => o.setName("id").setDescription("Role menu ID").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to remove").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Delete a role menu")
        .addStringOption((o) => o.setName("id").setDescription("Role menu ID").setRequired(true))
    )
    .addSubcommand((s) => s.setName("list").setDescription("List role menus in this server")),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "create") {
      if (!checkAdmin(interaction)) return;
      const channel = interaction.options.getChannel("channel");
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return interaction.reply({ content: "That must be a text channel.", flags: MessageFlags.Ephemeral });
      }
      const config = createRoleMenu(guild.id, {
        channelId: channel.id,
        title: interaction.options.getString("title"),
        description: interaction.options.getString("description"),
        mode: interaction.options.getString("mode")
      });
      const payload = buildMenuPayload(guild, config);
      const msg = await channel.send(payload);
      config.messageId = msg.id;
      const db = await import("../utils/db.js");
      db.saveKey("roleMenus");
      return interaction.reply({
        content: `Role menu created! Add roles with \`/rolemenu addrole id:${config.id}\`.\nMessage: ${msg.url}\nMenu ID: \`${config.id}\``,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "addrole") {
      if (!checkAdmin(interaction)) return;
      const id = interaction.options.getString("id");
      const config = getRoleMenu(guild.id, id);
      if (!config) return interaction.reply({ content: "Role menu not found (use the Menu ID, see /rolemenu list).", flags: MessageFlags.Ephemeral });
      const result = addRole(guild.id, id, interaction.options.getRole("role").id, interaction.options.getString("label") ?? "");
      if (!result.ok) return interaction.reply({ content: `Couldn't add role: ${result.error}`, flags: MessageFlags.Ephemeral });
      await rerender(client, guild.id, config);
      return interaction.reply({ content: "Role added to the menu.", flags: MessageFlags.Ephemeral });
    }

    if (sub === "removerole") {
      if (!checkAdmin(interaction)) return;
      const id = interaction.options.getString("id");
      const config = getRoleMenu(guild.id, id);
      if (!config) return interaction.reply({ content: "Role menu not found.", flags: MessageFlags.Ephemeral });
      const result = removeRole(guild.id, id, interaction.options.getRole("role").id);
      if (!result.ok) return interaction.reply({ content: `Couldn't remove role: ${result.error}`, flags: MessageFlags.Ephemeral });
      await rerender(client, guild.id, config);
      return interaction.reply({ content: "Role removed from the menu.", flags: MessageFlags.Ephemeral });
    }

    if (sub === "delete") {
      if (!checkAdmin(interaction)) return;
      const id = interaction.options.getString("id");
      const config = getRoleMenu(guild.id, id);
      if (!config) return interaction.reply({ content: "Role menu not found.", flags: MessageFlags.Ephemeral });
      if (config.messageId && config.channelId) {
        const ch = guild.channels.cache.get(config.channelId);
        const msg = ch ? await ch.messages.fetch(config.messageId).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => {});
      }
      deleteRoleMenu(guild.id, id);
      return interaction.reply({ content: "Role menu deleted.", flags: MessageFlags.Ephemeral });
    }

    const menus = Object.values(getRoleMenus(guild.id));
    if (!menus.length) {
      return interaction.reply({ content: "No role menus yet — try `/rolemenu create`.", flags: MessageFlags.Ephemeral });
    }
    const lines = menus.map((m) => {
      const ch = guild.channels.cache.get(m.channelId);
      return `**${m.id}** — ${m.title} — ${m.roles.length} role(s) in ${ch ? `#${ch.name}` : "(deleted)"}`;
    });
    return interaction.reply({ content: `**Role menus**\n${lines.join("\n")}`, flags: MessageFlags.Ephemeral });
  }
};
