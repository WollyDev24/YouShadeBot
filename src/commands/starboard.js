import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import { getStarboardConfig, setStarboard, disableStarboard, DEFAULT_STAR } from "../utils/starboard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("starboard")
    .setDescription("Highlight messages that collect enough reactions")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Set the starboard channel")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel where starred messages are reposted").addChannelTypes(0).setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("threshold")
            .setDescription("How many reactions a message needs (default 3)")
            .setMinValue(1)
            .setMaxValue(50)
        )
        .addStringOption((o) =>
          o
            .setName("emoji")
            .setDescription(`Custom emoji to track (default: ${DEFAULT_STAR})`)
            .setMaxLength(32)
        )
    )
    .addSubcommand((s) => s.setName("info").setDescription("Show the current starboard settings"))
    .addSubcommand((s) => s.setName("disable").setDescription("Turn off the starboard"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "set") {
      const channel = interaction.options.getChannel("channel");
      const me = guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has("ViewChannel") || !perms?.has("SendMessages") || !perms?.has("EmbedLinks")) {
        return interaction.reply({
          content: `I need View Channel, Send Messages and Embed Links permissions in ${channel}.`,
          flags: MessageFlags.Ephemeral
        });
      }
      const threshold = interaction.options.getInteger("threshold");
      const emoji = interaction.options.getString("emoji");
      const cfg = setStarboard(guild.id, { channelId: channel.id, threshold, emoji });
      return interaction.reply({
        content: `Starboard is on — messages with ${cfg.threshold}+ ${cfg.emoji} (self-reactions don't count) will be reposted in ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "disable") {
      const cfg = getStarboardConfig(guild.id);
      if (!cfg.enabled && !cfg.channelId) {
        return interaction.reply({
          content: "The starboard isn't configured. Set it up with `/starboard set`.",
          flags: MessageFlags.Ephemeral
        });
      }
      disableStarboard(guild.id);
      return interaction.reply({
        content: `Starboard disabled${Object.keys(cfg.entries).length ? ` — ${Object.keys(cfg.entries).length} existing board post(s) were kept.` : "."}`,
        flags: MessageFlags.Ephemeral
      });
    }

    const cfg = getStarboardConfig(guild.id);
    if (!cfg.channelId) {
      return interaction.reply({
        content: "No starboard configured yet — try `/starboard set #channel`.",
        flags: MessageFlags.Ephemeral
      });
    }
    return interaction.reply({
      content:
        `**Starboard** — ${cfg.enabled ? "enabled" : "disabled"}\n` +
        `Channel: <#${cfg.channelId}>\n` +
        `Emoji: ${cfg.emoji}\n` +
        `Threshold: ${cfg.threshold}\n` +
        `Messages on the board: ${Object.keys(cfg.entries).length}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
