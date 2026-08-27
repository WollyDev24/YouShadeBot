import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import {
  createSurvey,
  deleteSurvey,
  getSurveys,
  getSurvey,
  buildSurveyMessage,
  updateSurvey
} from "../utils/surveys.js";

export default {
  data: new SlashCommandBuilder()
    .setName("survey")
    .setDescription("Create and manage interactive surveys")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create a new survey")
        .addStringOption((o) =>
          o.setName("question").setDescription("The survey question").setRequired(true).setMaxLength(200)
        )
        .addStringOption((o) =>
          o.setName("description").setDescription("Optional description below the question").setMaxLength(1000)
        )
        .addChannelOption((o) =>
          o.setName("response_channel").setDescription("Channel where responses are sent").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("button_label").setDescription("Button text (default: Take Survey)").setMaxLength(80)
        )
        .addStringOption((o) =>
          o.setName("button_emoji").setDescription("Emoji for the button (default: 📋)").setMaxLength(32)
        )
        .addStringOption((o) =>
          o.setName("color").setDescription("Embed color hex (default: #5865F2)").setMaxLength(7)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("post")
        .setDescription("Post a survey to a channel")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Survey ID (see /survey list)").setRequired(true)
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel to post to (uses saved channel if omitted)")
        )
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("List all surveys")
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Delete a survey")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Survey ID (see /survey list)").setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "create") {
      const question = interaction.options.getString("question");
      const description = interaction.options.getString("description") ?? "";
      const responseChannel = interaction.options.getChannel("response_channel");
      const buttonLabel = interaction.options.getString("button_label") ?? "Take Survey";
      const buttonEmoji = interaction.options.getString("button_emoji") ?? "📋";
      const color = interaction.options.getString("color") ?? "#5865f2";

      if (responseChannel && (!responseChannel.isTextBased() || responseChannel.isDMBased())) {
        return interaction.reply({
          content: "\u274C The response channel must be a text channel in this server.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (!/^#?[0-9a-fA-F]{6}$/.test(color)) {
        return interaction.reply({
          content: "\u274C Invalid hex color. Use format `#FF5733` or `FF5733`.",
          flags: MessageFlags.Ephemeral
        });
      }

      const survey = createSurvey(guild.id, {
        question,
        description,
        responseChannelId: responseChannel?.id ?? null,
        buttonLabel,
        buttonEmoji,
        color: color.startsWith("#") ? color : `#${color}`
      });

      return interaction.reply({
        content: `\u2705 Survey **#${survey.id}** created!\n**Question:** ${question}\nUse \`/survey post id:${survey.id}\` to send it to a channel.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "post") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const id = interaction.options.getInteger("id");
      const survey = getSurvey(guild.id, id);
      if (!survey) {
        return interaction.editReply({ content: `\u274C Survey #${id} not found.` });
      }

      const channel = interaction.options.getChannel("channel") ?? guild.channels.cache.get(survey.channelId);
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return interaction.editReply({
          content: "\u274C Pick a valid text channel, or set a default channel when creating the survey."
        });
      }

      try {
        const msg = await channel.send(buildSurveyMessage(guild, survey));
        survey.messageId = msg.id;
        survey.channelId = channel.id;
        const { save } = await import("../utils/db.js");
        save();

        return interaction.editReply({
          content: `\u2705 Survey posted to <#${channel.id}>!`
        });
      } catch (err) {
        return interaction.editReply({
          content: `\u274C Couldn't post: ${err.message}`
        });
      }
    }

    if (sub === "list") {
      const surveys = getSurveys(guild.id);
      const list = Object.values(surveys);

      if (!list.length) {
        return interaction.reply({
          content: "No surveys yet — try `/survey create`.",
          flags: MessageFlags.Ephemeral
        });
      }

      const lines = list.map((s) => {
        const responses = Object.keys(s.responses).length;
        return `**#${s.id}** — ${s.question}\n> ${responses} response(s) · ${s.channelId ? `<#${s.channelId}>` : "no channel"} · ${s.buttonEmoji} ${s.buttonLabel}`;
      });

      return interaction.reply({
        content: `**Surveys**\n${lines.join("\n")}`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "delete") {
      const id = interaction.options.getInteger("id");
      const removed = deleteSurvey(guild.id, id);

      if (!removed) {
        return interaction.reply({
          content: `\u274C Survey #${id} not found.`,
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.reply({
        content: `\u2705 Survey #${id} deleted. ${Object.keys(removed.responses).length} response(s) removed.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
