import { SlashCommandBuilder, ChannelType, PermissionsBitField, MessageFlags, EmbedBuilder } from "../lib/discord.js";
import { getGuildCounting, topCounters, commit, upsertStatus } from "../utils/counting.js";

export default {
  data: new SlashCommandBuilder()
    .setName("counting")
    .setDescription("Manage the counting game")
    .addSubcommand((s) =>
      s
        .setName("setup")
        .setDescription("Set the counting channel and (re)start the game")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Text channel to play in")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addBooleanOption((o) =>
          o.setName("strict").setDescription("Strict mode: any non-number message breaks the count")
        )
    )
    .addSubcommand((s) => s.setName("disable").setDescription("Disable the counting game"))
    .addSubcommand((s) =>
      s
        .setName("chill")
        .setDescription("Toggle chill mode — mistakes no longer reset the count")
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("true = chill on, false = chill off")
        )
    )
    .addSubcommand((s) => s.setName("info").setDescription("Show current counting status"))
    .addSubcommand((s) =>
      s
        .setName("leaderboard")
        .setDescription("Top counters in this server")
        .addIntegerOption((o) => o.setName("top").setDescription("How many to show (default 10)"))
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const cfg = getGuildCounting(guild.id);

    if (sub === "setup") {
      if (
        !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
        interaction.member.id !== guild.ownerId
      ) {
        return interaction.reply({
          content: "You need the **Manage Channels** permission to do that.",
          flags: MessageFlags.Ephemeral
        });
      }
      const channel = interaction.options.getChannel("channel");
      const strict = interaction.options.getBoolean("strict") ?? cfg.strict;

      cfg.channelId = channel.id;
      cfg.strict = strict;
      cfg.current = 0;
      cfg.lastUserId = null;
      cfg.statusMessageId = null;
      commit(guild.id);

      upsertStatus(guild.id, channel);

      return interaction.reply({
        content: `Counting game enabled in ${channel}${strict ? " (**strict** mode)" : ""}. Start at **1**!`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "disable") {
      if (
        !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
        interaction.member.id !== guild.ownerId
      ) {
        return interaction.reply({
          content: "You need the **Manage Channels** permission to do that.",
          flags: MessageFlags.Ephemeral
        });
      }
      const old = cfg.channelId;
      const statusId = cfg.statusMessageId;
      cfg.channelId = null;
      cfg.statusMessageId = null;
      commit(guild.id);

      if (statusId) {
        const ch = guild.channels.cache.get(old);
        const msg = ch ? await ch.messages.fetch(statusId).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => {});
      }

      return interaction.reply({
        content: old ? "Counting game disabled." : "Counting game was already disabled.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "chill") {
      if (
        !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
        interaction.member.id !== guild.ownerId
      ) {
        return interaction.reply({
          content: "You need the **Manage Channels** permission to do that.",
          flags: MessageFlags.Ephemeral
        });
      }
      const enabled = interaction.options.getBoolean("enabled") ?? !cfg.chill;
      cfg.chill = enabled;
      commit(guild.id);
      return interaction.reply({
        content: enabled
          ? "Chill mode **on** — mistakes are flagged but the count never resets."
          : "Chill mode **off** — mistakes reset the count again.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "info") {
      const mode = cfg.chill ? "Chill" : cfg.strict ? "Strict" : "Lenient";
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Counting Game")
        .addFields(
          {
            name: "Channel",
            value: cfg.channelId ? `<#${cfg.channelId}>` : "not set",
            inline: true
          },
          { name: "Current", value: String(cfg.current), inline: true },
          { name: "Next", value: String(cfg.current + 1), inline: true },
          { name: "Best streak", value: String(cfg.best), inline: true },
          { name: "Mode", value: mode, inline: true }
        );
      return interaction.reply({ embeds: [embed] });
    }

    const top = interaction.options.getInteger("top") ?? 10;
    const entries = topCounters(guild.id, top);
    const lines = entries.map((e, i) => {
      const member = guild.members.cache.get(e.userId);
      return `**${i + 1}.** ${member?.displayName ?? `<@${e.userId}>`} — ${e.count}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("\u{1F3C6} Top Counters")
      .setDescription(lines.length ? lines.join("\n") : "No counts yet. Start the game with `/counting setup`!");
    return interaction.reply({ embeds: [embed] });
  }
};