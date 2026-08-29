import { SlashCommandBuilder, MessageFlags, EmbedBuilder, PermissionFlagsBits } from "../lib/discord.js";
import {
  getLeveling,
  commit,
  levelFromXp,
  topLevels,
  buildRankEmbed,
  countUsers,
  xpAtLevel
} from "../utils/leveling.js";

function checkAdmin(interaction) {
  if (
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member.id === interaction.guild.ownerId
  ) {
    return true;
  }
  interaction
    .reply({ content: "You need the **Manage Server** permission to do that.", flags: MessageFlags.Ephemeral })
    .catch(() => {});
  return false;
}

export default {
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Manage the leveling / XP system")
    .addSubcommand((s) => s.setName("enable").setDescription("Turn on leveling for this server"))
    .addSubcommand((s) => s.setName("disable").setDescription("Turn off leveling for this server"))
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Set the channel for level-up announcements")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel, or leave empty to disable"))
    )
    .addSubcommand((s) =>
      s
        .setName("reward")
        .setDescription("Set a role to award at a level")
        .addIntegerOption((o) => o.setName("level").setDescription("Level that grants the role").setRequired(true).setMinValue(1))
        .addRoleOption((o) => o.setName("role").setDescription("Role to award").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("removereward")
        .setDescription("Remove the role reward configured for a level")
        .addIntegerOption((o) => o.setName("level").setDescription("Level to remove the reward from").setRequired(true).setMinValue(1))
    )
    .addSubcommand((s) =>
      s
        .setName("rank")
        .setDescription("Show your (or someone's) XP and level")
        .addUserOption((o) => o.setName("user").setDescription("Member to check (default: you)"))
    )
    .addSubcommand((s) =>
      s.setName("top").setDescription("Leaderboard of the most active members")
        .addIntegerOption((o) => o.setName("top").setDescription("How many to show (default 10)").setMinValue(1).setMaxValue(25))
    )
    .addSubcommand((s) => s.setName("config").setDescription("Show the current leveling configuration")),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const l = getLeveling(guild.id);

    if (sub === "enable") {
      if (!checkAdmin(interaction)) return;
      l.enabled = true;
      commit(guild.id);
      return interaction.reply({ content: "Leveling **enabled**. Members earn XP by chatting.", flags: MessageFlags.Ephemeral });
    }

    if (sub === "disable") {
      if (!checkAdmin(interaction)) return;
      l.enabled = false;
      commit(guild.id);
      return interaction.reply({ content: "Leveling **disabled**.", flags: MessageFlags.Ephemeral });
    }

    if (sub === "channel") {
      if (!checkAdmin(interaction)) return;
      const channel = interaction.options.getChannel("channel");
      if (channel && (!channel.isTextBased() || channel.isDMBased())) {
        return interaction.reply({ content: "That must be a text channel.", flags: MessageFlags.Ephemeral });
      }
      l.annChannelId = channel ? channel.id : null;
      commit(guild.id);
      return interaction.reply({
        content: channel ? `Level-up announcements will go to <#${channel.id}>.` : "Level-up announcements disabled.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "reward") {
      if (!checkAdmin(interaction)) return;
      const level = interaction.options.getInteger("level");
      const role = interaction.options.getRole("role");
      l.roles[level] = role.id;
      commit(guild.id);
      return interaction.reply({
        content: `Role <@&${role.id}> will be awarded at **level ${level}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "removereward") {
      if (!checkAdmin(interaction)) return;
      const level = interaction.options.getInteger("level");
      if (!l.roles[level]) {
        return interaction.reply({ content: `No reward is set for level ${level}.`, flags: MessageFlags.Ephemeral });
      }
      delete l.roles[level];
      commit(guild.id);
      return interaction.reply({ content: `Removed the reward for **level ${level}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "rank") {
      const target = interaction.options.getMember("user") ?? interaction.member;
      return interaction.reply({ embeds: [buildRankEmbed(guild.id, target.id)] });
    }

    if (sub === "top") {
      const top = interaction.options.getInteger("top") ?? 10;
      const entries = topLevels(guild.id, top);
      const lines = entries.map((e, i) => {
        const member = guild.members.cache.get(e.userId);
        return `**${i + 1}.** ${member?.displayName ?? `<@${e.userId}>`} — Level **${e.level}** (${e.xp} XP)`;
      });
      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("🏆 Level Leaderboard")
        .setDescription(lines.length ? lines.join("\n") : "No XP yet — start chatting!");
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === "config") {
      const rewards = Object.entries(l.roles)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([lv, roleId]) => `Level ${lv} → <@&${roleId}>`)
        .join("\n");
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Leveling Config")
        .addFields(
          { name: "Enabled", value: l.enabled ? "Yes" : "No", inline: true },
          { name: "Announcements", value: l.annChannelId ? `<#${l.annChannelId}>` : "off", inline: true },
          { name: "Tracked members", value: String(countUsers(guild.id)), inline: true },
          { name: "Level rewards", value: rewards || "None" }
        );
      return interaction.reply({ embeds: [embed] });
    }

    return interaction.reply({ content: "Unknown subcommand.", flags: MessageFlags.Ephemeral });
  }
};
