import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import {
  getAntiRaidConfig,
  saveAntiRaidConfig,
  executeAntiRaid,
  getWindowStats,
  buildAntiRaidEmbed,
  getCases,
  clearCases
} from "../utils/antiraid.js";

const ACTIONS = ["lockdown", "kick", "ban"];

export default {
  data: new SlashCommandBuilder()
    .setName("antiraid")
    .setDescription("Protect the server against join raids")
    .addSubcommand((s) => s.setName("status").setDescription("Show anti-raid status and settings"))
    .addSubcommand((s) => s.setName("enable").setDescription("Enable anti-raid"))
    .addSubcommand((s) => s.setName("disable").setDescription("Disable anti-raid"))
    .addSubcommand((s) =>
      s
        .setName("threshold")
        .setDescription("Joins/channels in the window that trigger a raid response")
        .addIntegerOption((o) => o.setName("count").setDescription("Trigger threshold").setMinValue(2).setMaxValue(50).setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("window")
        .setDescription("Detection window in seconds")
        .addIntegerOption((o) => o.setName("seconds").setDescription("Window length").setMinValue(2).setMaxValue(300).setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("age")
        .setDescription("Max account age (hours) counted as suspicious")
        .addIntegerOption((o) => o.setName("hours").setDescription("Account age in hours").setMinValue(1).setMaxValue(720).setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("action")
        .setDescription("What to do when a raid is detected")
        .addStringOption((o) =>
          o
            .setName("kind")
            .setDescription("Response action")
            .setRequired(true)
            .addChoices(
              { name: "Lockdown", value: "lockdown" },
              { name: "Kick new accounts", value: "kick" },
              { name: "Ban new accounts", value: "ban" }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName("lockchannels")
        .setDescription("Also lock text channels on raid")
        .addBooleanOption((o) => o.setName("value").setDescription("Lock channels or not").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("logchannel")
        .setDescription("Channel for raid alerts")
        .addChannelOption((o) => o.setName("channel").setDescription("Alerts channel").setRequired(true))
    )
    .addSubcommand((s) => s.setName("cases").setDescription("Recent anti-raid cases"))
    .addSubcommand((s) => s.setName("clear").setDescription("Clear anti-raid case history"))
    .addSubcommand((s) => s.setName("trigger").setDescription("Force anti-raid now (test)"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const cfg = getAntiRaidConfig(guild.id);

    if (sub === "status") {
      const stats = getWindowStats(guild.id);
      const embed = buildAntiRaidEmbed(cfg, "joins", cfg.threshold, cfg.threshold, cfg.action);
      embed.setDescription(`${cfg.enabled ? "Enabled" : "Disabled"} — **${cfg.threshold}** joins/channels within **${cfg.windowSeconds}s** triggers **${cfg.action}**.`)
        .addFields(
          { name: "Current window", value: `${stats.joins} joins · ${stats.creates} channels`, inline: true },
          { name: "Log channel", value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : "None", inline: true }
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === "enable") {
      cfg.enabled = true;
      saveAntiRaidConfig(guild.id);
      return interaction.reply({ content: "Anti-raid is now **enabled**.", flags: MessageFlags.Ephemeral });
    }

    if (sub === "disable") {
      cfg.enabled = false;
      saveAntiRaidConfig(guild.id);
      return interaction.reply({ content: "Anti-raid is now **disabled**.", flags: MessageFlags.Ephemeral });
    }

    if (sub === "threshold") {
      cfg.threshold = interaction.options.getInteger("count");
      saveAntiRaidConfig(guild.id);
      return interaction.reply({ content: `Raid threshold set to **${cfg.threshold}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "window") {
      cfg.windowSeconds = interaction.options.getInteger("seconds");
      saveAntiRaidConfig(guild.id);
      return interaction.reply({ content: `Detection window set to **${cfg.windowSeconds}s**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "age") {
      cfg.accountAgeHours = interaction.options.getInteger("hours");
      saveAntiRaidConfig(guild.id);
      return interaction.reply({ content: `Suspicious account age set to **${cfg.accountAgeHours}h**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "action") {
      const kind = interaction.options.getString("kind");
      if (ACTIONS.includes(kind)) {
        cfg.action = kind;
        saveAntiRaidConfig(guild.id);
        return interaction.reply({ content: `Raid action set to **${kind}**.`, flags: MessageFlags.Ephemeral });
      }
    }

    if (sub === "lockchannels") {
      cfg.lockdownChannels = interaction.options.getBoolean("value");
      saveAntiRaidConfig(guild.id);
      return interaction.reply({ content: `Channel locking on raid is now **${cfg.lockdownChannels ? "on" : "off"}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "logchannel") {
      cfg.logChannelId = interaction.options.getChannel("channel").id;
      saveAntiRaidConfig(guild.id);
      return interaction.reply({ content: `Raid alerts will be sent to <#${cfg.logChannelId}>.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "cases") {
      const cases = getCases(guild.id, 10);
      if (!cases.length) return interaction.reply({ content: "No anti-raid cases yet.", flags: MessageFlags.Ephemeral });
      const lines = cases
        .reverse()
        .map((c) => `**#${c.caseNumber}** — ${c.count} ${c.type} → ${c.action}${c.detail ? ` (${c.detail})` : ""} — <t:${Math.floor(c.timestamp / 1000)}:R>`);
      return interaction.reply({ content: `**Recent anti-raid cases**\n${lines.join("\n")}`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "clear") {
      clearCases(guild.id);
      return interaction.reply({ content: "Anti-raid case history cleared.", flags: MessageFlags.Ephemeral });
    }

    if (sub === "trigger") {
      const stats = getWindowStats(guild.id);
      const result = await executeAntiRaid(client, guild, {
        type: "manual",
        count: Math.max(stats.joins, stats.creates, 1)
      });
      if (!result) return interaction.reply({ content: "Anti-raid is disabled or on cooldown.", flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: `Anti-raid triggered — ${result.detail || "no action"} (case #${result.caseNumber}).`, flags: MessageFlags.Ephemeral });
    }
  }
};