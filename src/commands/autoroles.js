import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import { getAutoRoles, setAutoRoles, disableAutoRoles } from "../utils/autoroles.js";

export default {
  data: new SlashCommandBuilder()
    .setName("autoroles")
    .setDescription("Automatically give members a role when they join")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Set the auto-join roles (pick at least one)")
        .addRoleOption((o) =>
          o.setName("humans").setDescription("Role for people who join").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("bots").setDescription("Role for bots that join").setRequired(false)
        )
    )
    .addSubcommand((s) => s.setName("disable").setDescription("Stop assigning roles on join"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "set") {
      try {
        const cfg = setAutoRoles(guild, {
          humanRoleId: interaction.options.getRole("humans")?.id ?? null,
          botRoleId: interaction.options.getRole("bots")?.id ?? null
        });
        const parts = [];
        parts.push(`Humans → ${cfg.humanRoleId ? `<@&${cfg.humanRoleId}>` : "(none)"}`);
        parts.push(`Bots → ${cfg.botRoleId ? `<@&${cfg.botRoleId}>` : "(none)"}`);
        return interaction.reply({
          content: `Auto-roles enabled!\n${parts.join("\n")}`,
          flags: MessageFlags.Ephemeral
        });
      } catch (err) {
        return interaction.reply({ content: err.message, flags: MessageFlags.Ephemeral });
      }
    }

    disableAutoRoles(guild.id);
    return interaction.reply({
      content: "Auto-roles disabled — new members won't get a role.",
      flags: MessageFlags.Ephemeral
    });
  }
};
