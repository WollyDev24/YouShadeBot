import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import {
  setSticky,
  removeSticky,
  getStickyAll,
  startTimer,
  repostSticky
} from "../utils/sticky.js";

function parseMessageId(input) {
  if (!input) return null;
  input = input.trim();

  const linkMatch = input.match(/discord\.com\/channels\/\d+\/(\d+)\/(\d+)/);
  if (linkMatch) return linkMatch[2];

  if (/^\d{17,20}$/.test(input)) return input;

  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Make a message stick to the top of this channel")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Make a message sticky (paste message link or ID)")
        .addStringOption((o) =>
          o.setName("message").setDescription("Message link or ID").setRequired(true).setMaxLength(300)
        )
        .addIntegerOption((o) =>
          o.setName("interval").setDescription("Repost interval in minutes (default: 5)").setMinValue(1).setMaxValue(1440)
        )
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Remove the sticky message from this channel")
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("List all active sticky messages")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "set") {
      const input = interaction.options.getString("message");
      const msgId = parseMessageId(input);
      if (!msgId) {
        return interaction.reply({
          content: "\u274C Could not parse that. Provide a message link or a message ID.",
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let ref;
      try {
        ref = await interaction.channel.messages.fetch(msgId);
      } catch {
        return interaction.editReply({ content: "\u274C Couldn't find that message in this channel." });
      }

      const interval = interaction.options.getInteger("interval") ?? 5;

      setSticky(guild.id, interaction.channelId, {
        content: ref.content,
        embedJson: ref.embeds?.length ? JSON.stringify(ref.embeds[0].toJSON()) : null,
        authorTag: ref.author.tag,
        authorId: ref.author.id,
        interval
      });

      await repostSticky(client, guild.id, interaction.channelId);
      startTimer(client, guild.id, interaction.channelId);

      return interaction.editReply({
        content: `\u2705 Sticky message set — reposting every **${interval}** minute(s).`
      });
    }

    if (sub === "remove") {
      const removed = removeSticky(guild.id, interaction.channelId);
      if (!removed) {
        return interaction.reply({
          content: "\u274C No sticky message in this channel.",
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.reply({
        content: "\u2705 Sticky message removed.",
        flags: MessageFlags.Ephemeral
      });
    }

    const stickies = getStickyAll(guild.id);
    const list = Object.entries(stickies);
    if (!list.length) {
      return interaction.reply({
        content: "No sticky messages in this server.",
        flags: MessageFlags.Ephemeral
      });
    }

    const lines = list.map(([channelId, s]) => {
      const ch = guild.channels.cache.get(channelId);
      const chName = ch ? `#${ch.name}` : "(deleted)";
      return `> ${chName} — every ${s.interval}m — *${s.content.slice(0, 60)}${s.content.length > 60 ? "..." : ""}*`;
    });

    return interaction.reply({
      content: `**Sticky messages**\n${lines.join("\n")}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
