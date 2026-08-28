import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import {
  createPoll,
  endPoll,
  getPoll,
  getPolls,
  buildPollEmbed,
  buildPollResultsEmbed,
  buildPollButtons
} from "../utils/polls.js";

export default {
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create and manage polls")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create a new poll")
        .addStringOption((o) =>
          o.setName("question").setDescription("The poll question").setRequired(true).setMaxLength(200)
        )
        .addStringOption((o) =>
          o.setName("option1").setDescription("First option").setRequired(true).setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("option2").setDescription("Second option").setRequired(true).setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("option3").setDescription("Third option").setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("option4").setDescription("Fourth option").setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("option5").setDescription("Fifth option").setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("option6").setDescription("Sixth option").setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("option7").setDescription("Seventh option").setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("option8").setDescription("Eighth option").setMaxLength(100)
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel to post the poll (default: this channel)")
        )
    )
    .addSubcommand((s) =>
      s
        .setName("end")
        .setDescription("End a poll and show final results")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Poll ID (see /poll list)").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("List all polls in this server")
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "create") {
      const question = interaction.options.getString("question");
      const options = [];
      for (let i = 1; i <= 8; i++) {
        const opt = interaction.options.getString(`option${i}`);
        if (opt) options.push(opt);
      }

      if (options.length < 2) {
        return interaction.reply({
          content: "\u274C You need at least 2 options.",
          flags: MessageFlags.Ephemeral
        });
      }

      const channel = interaction.options.getChannel("channel") ?? interaction.channel;
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return interaction.reply({
          content: "\u274C The channel must be a text channel in this server.",
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const poll = createPoll(guild.id, {
        question,
        options,
        channelId: channel.id,
        authorId: interaction.user.id
      });

      try {
        const embed = buildPollEmbed(poll);
        const msg = await channel.send({ embeds: [embed], components: buildPollButtons(poll) });

        poll.messageId = msg.id;
        const { saveKey } = await import("../utils/db.js");
        saveKey("polls");

        return interaction.editReply({
          content: `\u2705 Poll **#${poll.id}** created and posted to <#${channel.id}>!`
        });
      } catch (err) {
        return interaction.editReply({
          content: `\u274C Couldn't post the poll: ${err.message}`
        });
      }
    }

    if (sub === "end") {
      const id = interaction.options.getInteger("id");
      const poll = getPoll(guild.id, id);

      if (!poll) {
        return interaction.reply({
          content: `\u274C Poll #${id} not found.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (poll.ended) {
        return interaction.reply({
          content: `\u274C Poll #${id} has already ended.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (poll.authorId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: "\u274C Only the poll creator or a moderator can end this poll.",
          flags: MessageFlags.Ephemeral
        });
      }

      endPoll(guild.id, id);

      if (poll.messageId && poll.channelId) {
        try {
          const ch = guild.channels.cache.get(poll.channelId);
          if (ch) {
            const msg = await ch.messages.fetch(poll.messageId).catch(() => null);
            if (msg) {
              const resultsEmbed = buildPollResultsEmbed(poll);
              await msg.edit({ embeds: [resultsEmbed], components: [] });
            }
          }
        } catch {}
      }

      return interaction.reply({
        content: `\u2705 Poll **#${id}** has ended!`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "list") {
      const polls = getPolls(guild.id);
      const list = Object.values(polls);

      if (!list.length) {
        return interaction.reply({
          content: "No polls yet — try `/poll create`.",
          flags: MessageFlags.Ephemeral
        });
      }

      const lines = list.map((p) => {
        const votes = Object.keys(p.votes).length;
        const status = p.ended ? "ended" : "active";
        return `**#${p.id}** — ${p.question}\n> ${p.options.length} options · ${votes} vote(s) · ${status}`;
      });

      return interaction.reply({
        content: `**Polls**\n${lines.join("\n")}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
