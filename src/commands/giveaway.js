import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import {
  createGiveaway,
  postGiveawayMessage,
  getGiveaways,
  endGiveaway,
  rerollGiveaway
} from "../utils/giveaways.js";

export default {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Run giveaways with join buttons, winners and automatic DMs")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Start a giveaway in this channel")
        .addStringOption((o) => o.setName("title").setDescription("What are you giving away?").setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName("description").setDescription("Description of the content").setRequired(true).setMaxLength(1500))
        .addIntegerOption((o) => o.setName("minutes").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(43200))
        .addIntegerOption((o) => o.setName("winners").setDescription("How many winners").setRequired(true).setMinValue(1).setMaxValue(20))
        .addStringOption((o) => o.setName("link").setDescription("Optional link to the content").setMaxLength(500))
        .addStringOption((o) => o.setName("code").setDescription("Optional code DM'd to the winners").setMaxLength(100))
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("End a giveaway early and pick winners")
        .addIntegerOption((o) => o.setName("id").setDescription("Giveaway ID (see /giveaway list)").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("reroll").setDescription("Pick new winner(s) for an ended giveaway")
        .addIntegerOption((o) => o.setName("id").setDescription("Giveaway ID (see /giveaway list)").setRequired(true))
    )
    .addSubcommand((s) => s.setName("list").setDescription("Show all giveaways"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "create") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const link = interaction.options.getString("link");
      if (link && !/^https?:\/\//i.test(link)) {
        return interaction.editReply({ content: "The link must start with http:// or https://" });
      }

      const gw = createGiveaway(guild.id, {
        channelId: interaction.channelId,
        title: interaction.options.getString("title"),
        description: interaction.options.getString("description"),
        link,
        code: interaction.options.getString("code"),
        winners: interaction.options.getInteger("winners"),
        endsAt: Date.now() + interaction.options.getInteger("minutes") * 60_000,
        hostId: interaction.user.id,
        hostName: interaction.user.username
      });

      try {
        await postGiveawayMessage(interaction.channel, guild.id, gw);
      } catch (err) {
        return interaction.editReply({ content: `Couldn't post the giveaway here: ${err.message}` });
      }
      return interaction.editReply({ content: `Giveaway **#${gw.id}** is live in ${interaction.channel}!` });
    }

    if (sub === "end") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const gw = await endGiveaway(client, guild.id, interaction.options.getInteger("id"));
        return interaction.editReply({
          content: `Giveaway **#${gw.id}** ended. Winner(s): ${
            gw.winnerIds.length ? gw.winnerIds.map((w) => `<@${w}>`).join(", ") : "none"
          }.`
        });
      } catch (err) {
        return interaction.editReply({ content: err.message });
      }
    }

    if (sub === "reroll") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const fresh = await rerollGiveaway(client, guild.id, interaction.options.getInteger("id"));
        return interaction.editReply({
          content: `New winner(s): ${fresh.map((w) => `<@${w}>`).join(", ")}.`
        });
      } catch (err) {
        return interaction.editReply({ content: err.message });
      }
    }

    const list = getGiveaways(guild.id);
    if (!list.length) {
      return interaction.reply({
        content: "No giveaways yet — try `/giveaway create`.",
        flags: MessageFlags.Ephemeral
      });
    }
    const lines = list.slice(0, 15).map(
      (g) =>
        `**#${g.id}** ${g.ended ? "(ended)" : "(running)"} — ${g.title}\n` +
        `> ends <t:${Math.floor(g.endsAt / 1000)}:R> · ${g.winners} winner(s) · ${g.entries.length} entries` +
        (g.winnerIds.length ? ` · won by ${g.winnerIds.map((w) => `<@${w}>`).join(", ")}` : "")
    );
    return interaction.reply({
      content: `**Giveaways**\n${lines.join("\n")}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
