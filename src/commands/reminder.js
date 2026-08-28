import { SlashCommandBuilder, MessageFlags, ChannelType } from "../lib/discord.js";
import {
  parseDuration,
  formatDuration,
  getReminders,
  getReminder,
  createReminder,
  removeReminder,
  clearReminders
} from "../utils/reminders.js";

export default {
  data: new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Set reminders")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Set a reminder")
        .addMentionableOption((o) =>
          o.setName("who").setDescription("Who to remind (user or role)").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("when").setDescription('When (e.g. "30s", "5m", "2h", "1d", "1w", "1h30m")').setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("message").setDescription("What to remind them about").setRequired(true).setMaxLength(1500)
        )
        .addStringOption((o) =>
          o.setName("repeat").setDescription('Repeat interval (e.g. "1h", "24h") — leave empty for one-time')
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel to post the reminder (default: this channel)")
        )
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("List all reminders in this server")
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a reminder")
        .addIntegerOption((o) => o.setName("id").setDescription("Reminder ID (see /reminder list)").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("clear").setDescription("Remove all reminders in this server")
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "set") {
      const mentionable = interaction.options.getMentionable("who");
      const target = mentionable?.user ? `<@${mentionable.user.id}>` : mentionable ? `<@&${mentionable.id}>` : null;

      const whenMs = parseDuration(interaction.options.getString("when"));
      if (!whenMs) {
        return interaction.reply({
          content: "\u274C Couldn't parse the time. Use a format like `30s`, `5m`, `2h`, `1d`, or `1h30m`.",
          flags: MessageFlags.Ephemeral
        });
      }

      const repeatStr = interaction.options.getString("repeat");
      let repeatMs = null;
      if (repeatStr) {
        repeatMs = parseDuration(repeatStr);
        if (!repeatMs) {
          return interaction.reply({
            content: "\u274C Couldn't parse the repeat interval.",
            flags: MessageFlags.Ephemeral
          });
        }
      }

      const channel = interaction.options.getChannel("channel") ?? interaction.channel;
      if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
        return interaction.reply({
          content: "\u274C The channel must be a text channel in this server.",
          flags: MessageFlags.Ephemeral
        });
      }

      const reminder = createReminder(guild.id, {
        target,
        channelId: channel.id,
        message: interaction.options.getString("message"),
        at: Date.now() + whenMs,
        repeatMs
      });

      return interaction.reply({
        content:
          `\u2705 Reminder **#${reminder.id}** set for ${target} in <#${channel.id}> ` +
          `(<t:${Math.floor(reminder.at / 1000)}:R>)` +
          (reminder.repeatMs ? ` — repeats every **${formatDuration(reminder.repeatMs)}**` : "") +
          `.\n> ${reminder.message}`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "remove") {
      const id = interaction.options.getInteger("id");
      const removed = removeReminder(guild.id, id);
      if (!removed) {
        return interaction.reply({
          content: `\u274C Reminder #${id} not found.`,
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.reply({
        content: `\u2705 Reminder #${id} removed.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "clear") {
      const count = clearReminders(guild.id);
      return interaction.reply({
        content: count ? `\u2705 Removed all **${count}** reminder(s).` : "No reminders to remove.",
        flags: MessageFlags.Ephemeral
      });
    }

    const list = getReminders(guild.id);
    if (!list.length) {
      return interaction.reply({
        content: "No reminders in this server — try `/reminder set`.",
        flags: MessageFlags.Ephemeral
      });
    }

    const lines = list.map((r) => {
      const ch = guild.channels.cache.get(r.channelId);
      const chName = ch ? `#${ch.name}` : "(deleted)";
      const target = r.target ?? "(no target)";
      return `**#${r.id}** — ${target} in ${chName} — <t:${Math.floor(r.at / 1000)}:R>${
        r.repeatMs ? ` · every ${formatDuration(r.repeatMs)}` : ""
      }\n> ${r.message.slice(0, 80)}${r.message.length > 80 ? "..." : ""}`;
    });

    return interaction.reply({
      content: `**Reminders (${list.length})**\n${lines.join("\n")}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
