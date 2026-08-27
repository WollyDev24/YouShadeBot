import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import { getAutomodConfig, addCase, getCases, buildCaseEmbed } from "../utils/automod.js";
import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "../utils/db.js";

export default {
  data: new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure server automod settings")
    .addSubcommand((s) =>
      s.setName("setup").setDescription("Show current automod configuration")
    )
    .addSubcommand((s) =>
      s
        .setName("toggle")
        .setDescription("Toggle an automod feature on or off")
        .addStringOption((o) =>
          o
            .setName("feature")
            .setDescription("Feature to toggle")
            .addChoices(
              { name: "Word Filter", value: "word-filter" },
              { name: "Spam Detection", value: "spam" },
              { name: "Mass Mention", value: "mass-mention" },
              { name: "Invite Blocking", value: "invite-blocking" }
            )
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("word-add")
        .setDescription("Add a word to the filter list")
        .addStringOption((o) =>
          o.setName("word").setDescription("Word to block (max 100 chars)").setRequired(true).setMaxLength(100)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("word-remove")
        .setDescription("Remove a word from the filter list")
        .addStringOption((o) =>
          o.setName("word").setDescription("Word to unblock").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName("word-list").setDescription("List all blocked words")
    )
    .addSubcommand((s) =>
      s
        .setName("spam")
        .setDescription("Configure spam detection settings")
        .addIntegerOption((o) =>
          o.setName("messages").setDescription("Messages per window (2-50)").setMinValue(2).setMaxValue(50).setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName("window").setDescription("Time window in seconds (3-60)").setMinValue(3).setMaxValue(60).setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Action to take")
            .addChoices(
              { name: "Delete", value: "delete" },
              { name: "Warn", value: "warn" },
              { name: "Mute", value: "mute" },
              { name: "Kick", value: "kick" },
              { name: "Ban", value: "ban" }
            )
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("mention")
        .setDescription("Configure mass mention detection")
        .addIntegerOption((o) =>
          o.setName("threshold").setDescription("Mention count to trigger (2-50)").setMinValue(2).setMaxValue(50).setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Action to take")
            .addChoices(
              { name: "Delete", value: "delete" },
              { name: "Warn", value: "warn" },
              { name: "Mute", value: "mute" },
              { name: "Kick", value: "kick" },
              { name: "Ban", value: "ban" }
            )
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("invite")
        .setDescription("Configure invite link blocking")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Action to take")
            .addChoices(
              { name: "Delete", value: "delete" },
              { name: "Warn", value: "warn" },
              { name: "Mute", value: "mute" },
              { name: "Kick", value: "kick" },
              { name: "Ban", value: "ban" }
            )
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("action")
        .setDescription("Set the action for a feature")
        .addStringOption((o) =>
          o
            .setName("feature")
            .setDescription("Feature to configure")
            .addChoices(
              { name: "Word Filter", value: "word-filter" },
              { name: "Spam Detection", value: "spam" },
              { name: "Mass Mention", value: "mass-mention" },
              { name: "Invite Blocking", value: "invite-blocking" }
            )
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Action to set")
            .addChoices(
              { name: "Delete", value: "delete" },
              { name: "Warn", value: "warn" },
              { name: "Mute", value: "mute" },
              { name: "Kick", value: "kick" },
              { name: "Ban", value: "ban" }
            )
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName("duration").setDescription("Duration in minutes (only for mute)").setMinValue(1).setMaxValue(1440)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("logs")
        .setDescription("Show recent automod cases")
        .addIntegerOption((o) =>
          o.setName("count").setDescription("Number of cases to show (1-50)").setMinValue(1).setMaxValue(50)
        )
    )
    .addSubcommand((s) =>
      s.setName("clear-logs").setDescription("Clear all automod cases")
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const config = getAutomodConfig(guild.id);

    if (sub !== "setup" && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "You need the **Manage Server** permission to use this.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "setup") {
      const e = (on) => (on ? "✅" : "❌");
      const embed = new EmbedBuilder()
        .setTitle("Automod Configuration")
        .setColor(0x5865f2)
        .addFields(
          { name: "Word Filter", value: `${e(config.wordFilter.enabled)} — ${config.wordFilter.words.length} word(s)`, inline: true },
          { name: "Spam Detection", value: `${e(config.spamDetection.enabled)} — ${config.spamDetection.messagesPerWindow} msgs / ${config.spamDetection.windowSeconds}s`, inline: true },
          { name: "Mass Mention", value: `${e(config.massMention.enabled)} — threshold: ${config.massMention.threshold}`, inline: true },
          { name: "Invite Blocking", value: `${e(config.inviteBlocking.enabled)}`, inline: true },
          { name: "Word Filter Action", value: config.wordFilter.action, inline: true },
          { name: "Spam Action", value: config.spamDetection.action, inline: true },
          { name: "Mention Action", value: config.massMention.action, inline: true },
          { name: "Invite Action", value: config.inviteBlocking.action, inline: true }
        )
        .setFooter({ text: "Use subcommands to configure each feature" })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === "toggle") {
      const feature = interaction.options.getString("feature");
      const map = { "word-filter": "wordFilter", spam: "spamDetection", "mass-mention": "massMention", "invite-blocking": "inviteBlocking" };
      const key = map[feature];
      config[key].enabled = !config[key].enabled;
      saveKey("automod", getData().automod);
      return interaction.reply({
        content: `${feature} is now **${config[key].enabled ? "enabled" : "disabled"}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "word-add") {
      const word = interaction.options.getString("word").toLowerCase().trim();
      if (config.wordFilter.words.length >= 200) {
        return interaction.reply({ content: "Word list is full (max 200).", flags: MessageFlags.Ephemeral });
      }
      if (config.wordFilter.words.includes(word)) {
        return interaction.reply({ content: `Word \`${word}\` is already in the list.`, flags: MessageFlags.Ephemeral });
      }
      config.wordFilter.words.push(word);
      saveKey("automod", getData().automod);
      return interaction.reply({ content: `Added \`${word}\` to the filter list (${config.wordFilter.words.length}/200).`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "word-remove") {
      const word = interaction.options.getString("word").toLowerCase().trim();
      const idx = config.wordFilter.words.indexOf(word);
      if (idx === -1) {
        return interaction.reply({ content: `Word \`${word}\` not found in the list.`, flags: MessageFlags.Ephemeral });
      }
      config.wordFilter.words.splice(idx, 1);
      saveKey("automod", getData().automod);
      return interaction.reply({ content: `Removed \`${word}\` from the filter list (${config.wordFilter.words.length}/200).`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "word-list") {
      if (config.wordFilter.words.length === 0) {
        return interaction.reply({ content: "No words in the filter list.", flags: MessageFlags.Ephemeral });
      }
      const list = config.wordFilter.words.map((w) => `\`${w}\``).join(", ");
      return interaction.reply({ content: `**Blocked words (${config.wordFilter.words.length}):** ${list}`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "spam") {
      config.spamDetection.messagesPerWindow = interaction.options.getInteger("messages");
      config.spamDetection.windowSeconds = interaction.options.getInteger("window");
      config.spamDetection.action = interaction.options.getString("action");
      saveKey("automod", getData().automod);
      return interaction.reply({
        content: `Spam detection updated: **${config.spamDetection.messagesPerWindow}** messages in **${config.spamDetection.windowSeconds}s** → **${config.spamDetection.action}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "mention") {
      config.massMention.threshold = interaction.options.getInteger("threshold");
      config.massMention.action = interaction.options.getString("action");
      saveKey("automod", getData().automod);
      return interaction.reply({
        content: `Mass mention updated: threshold **${config.massMention.threshold}** → **${config.massMention.action}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "invite") {
      config.inviteBlocking.action = interaction.options.getString("action");
      saveKey("automod", getData().automod);
      return interaction.reply({
        content: `Invite blocking action set to **${config.inviteBlocking.action}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "action") {
      const feature = interaction.options.getString("feature");
      const action = interaction.options.getString("action");
      const duration = interaction.options.getInteger("duration");
      const map = { "word-filter": "wordFilter", spam: "spamDetection", "mass-mention": "massMention", "invite-blocking": "inviteBlocking" };
      const key = map[feature];
      config[key].action = action;
      if (action === "mute" && duration) {
        config[key].muteDuration = duration * 60000;
      }
      saveKey("automod", getData().automod);
      const durationNote = action === "mute" && duration ? ` for **${duration}** min` : "";
      return interaction.reply({
        content: `${feature} action set to **${action}**${durationNote}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "logs") {
      const count = interaction.options.getInteger("count") || 10;
      const cases = getCases(guild.id, count);
      if (cases.length === 0) {
        return interaction.reply({ content: "No automod cases found.", flags: MessageFlags.Ephemeral });
      }
      const embeds = cases.map((c) => buildCaseEmbed(guild, c));
      return interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
    }

    if (sub === "clear-logs") {
      config.cases = [];
      config.caseCounter = 0;
      saveKey("automod", getData().automod);
      return interaction.reply({ content: "All automod cases have been cleared.", flags: MessageFlags.Ephemeral });
    }
  }
};
