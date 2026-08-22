import { SlashCommandBuilder, PermissionsBitField, MessageFlags } from "../lib/discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Bulk delete messages in this channel")
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("How many messages to delete (2-100)")
        .setMinValue(2)
        .setMaxValue(100)
        .setRequired(true)
    ),

  async execute(client, interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: "You need the **Manage Messages** permission.", flags: MessageFlags.Ephemeral });
    }

    const amount = interaction.options.getInteger("amount");
    const deleted = await interaction.channel.bulkDelete(amount, true);

    const reply = await interaction.reply({
      content: `Deleted **${deleted.size}** message(s).`,
      flags: MessageFlags.Ephemeral
    });

    setTimeout(() => reply.delete().catch(() => {}), 5000);
  }
};