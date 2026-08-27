import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import {
  createReactionRole,
  addMapping,
  removeMapping,
  deleteReactionRole,
  getReactionRole,
  getReactionRoles,
  buildReactionRoleMessage
} from "../utils/reactionRoles.js";
import { getData, saveKey } from "../utils/db.js";

export default {
  data: new SlashCommandBuilder()
    .setName("reactionrole")
    .setDescription("Set up reaction roles for your server")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create a reaction role message")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel to post the message in").addChannelTypes(0).setRequired(true)
        )
        .addStringOption((o) => o.setName("title").setDescription("Embed title").setMaxLength(200))
        .addStringOption((o) => o.setName("description").setDescription("Embed description").setMaxLength(1500))
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("unique = one role at a time, synced = multiple")
            .addChoices(
              { name: "unique", value: "unique" },
              { name: "synced", value: "synced" }
            )
        )
        .addStringOption((o) => o.setName("color").setDescription("Embed color hex (e.g. #5865F2)"))
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add an emoji-role mapping")
        .addStringOption((o) => o.setName("emoji").setDescription("Emoji to use").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to assign").setRequired(true))
        .addStringOption((o) => o.setName("label").setDescription("Label shown next to the role"))
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove an emoji-role mapping")
        .addStringOption((o) => o.setName("emoji").setDescription("Emoji to remove").setRequired(true))
    )
    .addSubcommand((s) => s.setName("delete").setDescription("Delete a reaction role message and its config"))
    .addSubcommand((s) => s.setName("list").setDescription("List all reaction role configs in this server"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const guildId = guild.id;

    const getMostRecent = () => {
      const roles = getReactionRoles(guildId);
      const keys = Object.keys(roles);
      if (!keys.length) return null;
      const lastKey = keys[keys.length - 1];
      return { messageId: lastKey, config: roles[lastKey] };
    };

    if (sub === "create") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const channel = interaction.options.getChannel("channel");
      if (!channel.isTextBased()) {
        return interaction.editReply({ content: "That channel is not a text channel." });
      }

      const me = guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has("ViewChannel") || !perms?.has("SendMessages") || !perms?.has("EmbedLinks")) {
        return interaction.editReply({
          content: "I need View Channel, Send Messages and Embed Links permissions in that channel."
        });
      }

      const config = createReactionRole(guildId, {
        channelId: channel.id,
        title: interaction.options.getString("title") ?? "Pick your roles!",
        description: interaction.options.getString("description") ?? "React to get a role.",
        mode: interaction.options.getString("mode") ?? "unique",
        color: interaction.options.getString("color") ?? "#5865F2"
      });

      const payload = buildReactionRoleMessage(guild, config);
      const msg = await channel.send(payload);

      const data = getData();
      delete data.reactionRoles[guildId][config.messageId];
      config.messageId = msg.id;
      data.reactionRoles[guildId][msg.id] = config;
      saveKey("reactionRoles");

      return interaction.editReply({ content: `Reaction role message posted in ${channel}.` });
    }

    if (sub === "add") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const recent = getMostRecent();
      if (!recent) {
        return interaction.editReply({ content: "No reaction role configs found. Create one first with `/reactionrole create`." });
      }

      const emoji = interaction.options.getString("emoji");
      const role = interaction.options.getRole("role");
      const label = interaction.options.getString("label") ?? "";

      const result = addMapping(guildId, recent.messageId, emoji, role.id, label);
      if (!result) {
        return interaction.editReply({ content: "Failed to add mapping. Make sure the reaction role exists." });
      }

      const freshConfig = getReactionRole(guildId, recent.messageId);
      const channel = guild.channels.cache.get(freshConfig.channelId);
      if (channel) {
        const msg = await channel.messages.fetch(recent.messageId).catch(() => null);
        if (msg) {
          const payload = buildReactionRoleMessage(guild, freshConfig);
          await msg.edit(payload).catch(() => {});
        }
      }

      return interaction.editReply({ content: `Mapping added: ${emoji} → ${role}` });
    }

    if (sub === "remove") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const recent = getMostRecent();
      if (!recent) {
        return interaction.editReply({ content: "No reaction role configs found." });
      }

      const emoji = interaction.options.getString("emoji");
      const removed = removeMapping(guildId, recent.messageId, emoji);
      if (!removed) {
        return interaction.editReply({ content: `No mapping found for ${emoji}.` });
      }

      const freshConfig = getReactionRole(guildId, recent.messageId);
      const channel = guild.channels.cache.get(freshConfig.channelId);
      if (channel) {
        const msg = await channel.messages.fetch(recent.messageId).catch(() => null);
        if (msg) {
          const payload = buildReactionRoleMessage(guild, freshConfig);
          await msg.edit(payload).catch(() => {});
        }
      }

      return interaction.editReply({ content: `Mapping for ${emoji} removed.` });
    }

    if (sub === "delete") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const recent = getMostRecent();
      if (!recent) {
        return interaction.editReply({ content: "No reaction role configs found." });
      }

      const channel = guild.channels.cache.get(recent.config.channelId);
      if (channel) {
        const msg = await channel.messages.fetch(recent.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }

      deleteReactionRole(guildId, recent.messageId);
      return interaction.editReply({ content: "Reaction role deleted." });
    }

    if (sub === "list") {
      const roles = getReactionRoles(guildId);
      const keys = Object.keys(roles);

      if (!keys.length) {
        return interaction.reply({ content: "No reaction role configs in this server.", flags: MessageFlags.Ephemeral });
      }

      const lines = keys.map((msgId) => {
        const cfg = roles[msgId];
        const mappingCount = Object.keys(cfg.mappings).length;
        return (
          `**${cfg.title}** (${cfg.mode})\n` +
          `> Channel: <#${cfg.channelId}> · Message: ${msgId}\n` +
          `> ${mappingCount} mapping(s): ${mappingCount ? Object.entries(cfg.mappings).map(([e, m]) => `${e} → <@&${m.roleId}>`).join(", ") : "none"}`
        );
      });

      return interaction.reply({ content: `**Reaction Roles**\n${lines.join("\n")}`, flags: MessageFlags.Ephemeral });
    }
  }
};
