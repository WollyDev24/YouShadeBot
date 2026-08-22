import { SlashCommandBuilder, PermissionsBitField, MessageFlags } from "../lib/discord.js";
import { refreshStats, setupStats, disableStats } from "../utils/stats.js";

export default {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Manage live server stats voice channels")
    .addSubcommand((s) =>
      s.setName("setup").setDescription("Create the stats category + voice channels")
    )
    .addSubcommand((s) =>
      s.setName("refresh").setDescription("Force-refresh the stat channels now")
    )
    .addSubcommand((s) =>
      s.setName("disable").setDescription("Delete the stats channels and disable updates")
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (
      sub !== "refresh" &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
      interaction.member.id !== guild.ownerId
    ) {
      return interaction.reply({
        content: "You need the **Manage Channels** permission to use this.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "refresh") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await refreshStats(guild);
        return await interaction.editReply({ content: "Stats channels refreshed." });
      } catch (err) {
        console.error("[stats] refresh failed:", err);
        return interaction.editReply({
          content: `Couldn't refresh stats: ${err.message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    if (sub === "setup") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await setupStats(guild);
        return await interaction.editReply({
          content: "Stats channels created! They update every 5 minutes and on voice activity."
        });
      } catch (err) {
        console.error("[stats] setup failed:", err);
        return interaction.editReply({
          content: `Couldn't create stats channels: ${err.message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await disableStats(guild);
      return await interaction.editReply({
        content: "Stats channels removed and updates disabled."
      });
    } catch (err) {
      console.error("[stats] disable failed:", err);
      return interaction.editReply({
        content: `Couldn't remove stats channels: ${err.message}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};