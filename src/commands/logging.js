import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import { getLogChannel, setLogChannel } from "../utils/updater.js";

export default {
  data: new SlashCommandBuilder()
    .setName("logging")
    .setDescription("Configure the channel for bot status logs (updates, restarts)")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Set the logging channel")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel where update/restart messages are posted")
            .addChannelTypes(0)
            .setRequired(true)
        )
    )
    .addSubcommand((s) => s.setName("disable").setDescription("Stop posting bot status logs"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "set") {
      const channel = interaction.options.getChannel("channel");
      const me = guild.members.me;
      if (!channel.permissionsFor(me)?.has("ViewChannel") || !channel.permissionsFor(me)?.has("SendMessages")) {
        return interaction.reply({
          content: `I can't send messages in ${channel} — check my permissions there first.`,
          flags: MessageFlags.Ephemeral
        });
      }
      setLogChannel(guild.id, channel.id);
      return interaction.reply({
        content: `Bot status logs (auto-updates, restarts) will now be posted in ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (!getLogChannel(guild.id)) {
      return interaction.reply({
        content: "Bot status logging is not configured. Set it with `/logging set`.",
        flags: MessageFlags.Ephemeral
      });
    }
    setLogChannel(guild.id, null);
    return interaction.reply({
      content: "Bot status logging disabled.",
      flags: MessageFlags.Ephemeral
    });
  }
};
