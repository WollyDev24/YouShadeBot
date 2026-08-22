import { SlashCommandBuilder, PermissionsBitField, MessageFlags } from "../lib/discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Moderation tools: kick, ban, timeout, unban")
    .addSubcommand((s) =>
      s
        .setName("kick")
        .setDescription("Kick a member from the server")
        .addUserOption((o) => o.setName("target").setDescription("Member to kick").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Kick reason"))
    )
    .addSubcommand((s) =>
      s
        .setName("ban")
        .setDescription("Ban a member from the server")
        .addUserOption((o) => o.setName("target").setDescription("Member to ban").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Ban reason"))
        .addIntegerOption((o) => o.setName("days").setDescription("Delete messages from last N days").setMinValue(0).setMaxValue(7))
    )
    .addSubcommand((s) =>
      s
        .setName("unban")
        .setDescription("Unban a user by ID")
        .addUserOption((o) => o.setName("user").setDescription("User to unban").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("timeout")
        .setDescription("Timeout a member")
        .addUserOption((o) => o.setName("target").setDescription("Member to timeout").setRequired(true))
        .addIntegerOption((o) => o.setName("duration").setDescription("Minutes").setMinValue(1).setMaxValue(10080).setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Timeout reason"))
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.member;
    const me = interaction.guild.members.me;

    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers) && member.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: "You need the **Moderate Members** permission.", flags: MessageFlags.Ephemeral });
    }
    if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ content: "I need the **Moderate Members** permission.", flags: MessageFlags.Ephemeral });
    }

    const running = interaction.options.getString("reason") ?? "No reason provided";

    switch (sub) {
      case "kick": {
        const target = interaction.options.getMember("target");
        if (!target) return interaction.reply({ content: "That member isn't in this server.", flags: MessageFlags.Ephemeral });
        if (target.id === member.id) return interaction.reply({ content: "You can't kick yourself.", flags: MessageFlags.Ephemeral });
        await target.kick(running);
        return interaction.reply({ content: `Kicked **${target.user.tag}**.\nReason: ${running}`, flags: MessageFlags.Ephemeral });
      }

      case "ban": {
        const target = interaction.options.getMember("target");
        if (!target) return interaction.reply({ content: "That member isn't in this server.", flags: MessageFlags.Ephemeral });
        if (target.id === member.id) return interaction.reply({ content: "You can't ban yourself.", flags: MessageFlags.Ephemeral });
        const days = interaction.options.getInteger("days") ?? 0;
        await target.ban({ deleteMessageSeconds: days * 86400, reason: running });
        return interaction.reply({ content: `Banned **${target.user.tag}**.\nReason: ${running}`, flags: MessageFlags.Ephemeral });
      }

      case "unban": {
        const user = interaction.options.getUser("user");
        await interaction.guild.bans.remove(user.id, running);
        return interaction.reply({ content: `Unbanned **${user.tag}**.`, flags: MessageFlags.Ephemeral });
      }

      case "timeout": {
        const target = interaction.options.getMember("target");
        if (!target) return interaction.reply({ content: "That member isn't in this server.", flags: MessageFlags.Ephemeral });
        const minutes = interaction.options.getInteger("duration");
        await target.timeout(minutes * 60_000, running);
        return interaction.reply({
          content: `Timed out **${target.user.tag}** for ${minutes} minute(s).\nReason: ${running}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};