import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import { hasPanelAccess, mainMenu } from "../utils/panel.js";

export default {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open the server management panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    if (!hasPanelAccess(interaction.member)) {
      const { getPanelConfig } = await import("../utils/panel.js");
      const cfg = getPanelConfig(interaction.guild.id);
      const msg = cfg.roleId
        ? "You don't have the panel role."
        : "You need the **Manage Server** permission to use this.";
      return interaction.reply({ content: `\u274C ${msg}`, flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({ ...mainMenu(), flags: MessageFlags.Ephemeral });
  }
};
