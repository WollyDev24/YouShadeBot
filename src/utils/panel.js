import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from "../lib/discord.js";
import { getData, save } from "./db.js";
import { getGuildTemp } from "./temp.js";
import { getWelcome, commitWelcome } from "./welcome.js";
import { getGuildCounting, commit as commitCounting, DEFAULT_COUNTING_EMOJIS } from "./counting.js";
import { getStarboardConfig, setStarboard, disableStarboard } from "./starboard.js";
import { getAutoRoles, setAutoRoles, disableAutoRoles } from "./autoroles.js";
import { statsConfig, setupStats, disableStats } from "./stats.js";
import { getLogChannel, setLogChannel } from "./updater.js";

const on = "\u2705";

export function getPanelConfig(guildId) {
  const data = getData();
  if (!data.panel[guildId]) data.panel[guildId] = { roleId: null };
  return data.panel[guildId];
}

export function setPanelRole(guildId, roleId) {
  const cfg = getPanelConfig(guildId);
  cfg.roleId = roleId || null;
  save();
  return cfg;
}

export function hasPanelAccess(member) {
  const cfg = getPanelConfig(member.guild.id);
  if (!cfg.roleId) return member.permissions.has("ManageGuild");
  return member.roles.cache.has(cfg.roleId) || member.permissions.has("ManageGuild");
}

function status(enabled) {
  return enabled ? on : off;
}

function backBtn() {
  return new ButtonBuilder()
    .setCustomId("pn_main")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("\u2B05\uFE0F");
}

export function mainMenu() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("\u2699\uFE0F Server Panel")
    .setDescription("Pick a feature to manage:")
    .setFooter({ text: "Only members with the panel role can use this." });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pn_temp").setLabel("Temp Channels").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4E5}"),
    new ButtonBuilder().setCustomId("pn_stats").setLabel("Stats").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4CA}"),
    new ButtonBuilder().setCustomId("pn_welcome").setLabel("Welcome").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F44B}"),
    new ButtonBuilder().setCustomId("pn_starboard").setLabel("Starboard").setStyle(ButtonStyle.Secondary).setEmoji("\u2B50"),
    new ButtonBuilder().setCustomId("pn_counting").setLabel("Counting").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F522}")
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pn_autoroles").setLabel("Auto-Roles").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F451}"),
    new ButtonBuilder().setCustomId("pn_logging").setLabel("Logging").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4DD}"),
    new ButtonBuilder().setCustomId("pn_commands").setLabel("Commands").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4AC}")
  );

  return { embeds: [embed], components: [row1, row2] };
}

export function tempView(guild) {
  const t = getGuildTemp(guild.id);
  const enabled = Boolean(t.trigger);
  const triggerName = t.trigger ? guild.channels.cache.get(t.trigger)?.name ?? "(deleted)" : null;
  const activeCount = Object.keys(t.channels).length;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${status(enabled)} Temporary Channels`)
    .setDescription(
      enabled
        ? `Trigger: **#${triggerName}**\nActive temp channels: **${activeCount}**`
        : "Temporary channels are **disabled**."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_temp_toggle")
      .setLabel(enabled ? "Disable" : "Enable")
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    backBtn()
  );

  return { embeds: [embed], components: [row] };
}

export async function toggleTemp(guild) {
  const t = getGuildTemp(guild.id);
  const { getData: gd } = await import("./db.js");
  if (t.trigger) {
    gd().temp[guild.id] = { trigger: null, channels: {} };
    (await import("./db.js")).save();
  }
  return tempView(guild);
}

export function statsView(guild) {
  const cfg = statsConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${status(cfg.enabled)} Server Stats`)
    .setDescription(
      cfg.enabled
        ? `Live stats channels are active and updated every 5 minutes.`
        : "Server stats are **disabled**."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_stats_toggle")
      .setLabel(cfg.enabled ? "Remove stats" : "Create stats")
      .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    backBtn()
  );

  return { embeds: [embed], components: [row] };
}

export async function toggleStats(guild) {
  const cfg = statsConfig(guild.id);
  if (cfg.enabled) await disableStats(guild);
  else await setupStats(guild);
  return statsView(guild);
}

export function welcomeView(guild) {
  const cfg = getWelcome(guild.id);
  const channelName = cfg.channelId ? guild.channels.cache.get(cfg.channelId)?.name ?? "(deleted)" : "not set";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${status(cfg.enabled)} Welcome Messages`)
    .setDescription(
      `Channel: <#${channelName}>\nMode: **${cfg.mode}**\nMessage: ${cfg.message.slice(0, 200)}${cfg.message.length > 200 ? "..." : ""}`
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_welcome_toggle")
      .setLabel(cfg.enabled ? "Disable" : "Enable")
      .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("pn_welcome_modal")
      .setLabel("Edit message")
      .setStyle(ButtonStyle.Secondary),
    backBtn()
  );

  return { embeds: [embed], components: [row1] };
}

export function welcomeModal() {
  const modal = new ModalBuilder()
    .setCustomId("pn_welcome_modal_submit")
    .setTitle("Welcome Message");

  const msg = new TextInputBuilder()
    .setCustomId("message")
    .setLabel("Message (use {user}, {server}, {memberCount})")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);

  const channelInput = new TextInputBuilder()
    .setCustomId("channelId")
    .setLabel("Channel ID (leave empty to keep current)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(20)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(msg),
    new ActionRowBuilder().addComponents(channelInput)
  );
  return modal;
}

export function handleWelcomeSubmit(interaction, values) {
  const guild = interaction.guild;
  const cfg = getWelcome(guild.id);

  const message = values.message?.trim();
  if (message) cfg.message = message;

  const channelId = values.channelId?.trim();
  if (channelId) {
    const ch = guild.channels.cache.get(channelId);
    cfg.channelId = ch && ch.type === 0 ? channelId : cfg.channelId;
  }

  cfg.enabled = true;
  commitWelcome(guild.id);

  return welcomeView(guild);
}

export function starboardView(guild) {
  const cfg = getStarboardConfig(guild.id);
  const channelName = cfg.channelId ? guild.channels.cache.get(cfg.channelId)?.name ?? "(deleted)" : "not set";

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${status(cfg.enabled)} Starboard`)
    .setDescription(
      `Channel: <#${channelName}>\nEmoji: ${cfg.emoji}\nThreshold: **${cfg.threshold}**\nMessages on board: **${Object.keys(cfg.entries).length}**`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_star_toggle")
      .setLabel(cfg.enabled ? "Disable" : "Enable")
      .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("pn_star_modal")
      .setLabel("Settings")
      .setStyle(ButtonStyle.Secondary),
    backBtn()
  );

  return { embeds: [embed], components: [row] };
}

export function starboardModal() {
  const modal = new ModalBuilder()
    .setCustomId("pn_star_modal_submit")
    .setTitle("Starboard Settings");

  const emoji = new TextInputBuilder()
    .setCustomId("emoji")
    .setLabel("Emoji (e.g. ⭐ or <:name:id>)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(32)
    .setRequired(true);

  const threshold = new TextInputBuilder()
    .setCustomId("threshold")
    .setLabel("Reaction threshold (1-50)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(2)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(emoji),
    new ActionRowBuilder().addComponents(threshold)
  );
  return modal;
}

export function handleStarSubmit(interaction, values) {
  const guild = interaction.guild;
  const emoji = values.emoji?.trim();
  const threshold = Number(values.threshold);
  setStarboard(guild.id, { emoji, threshold: Number.isFinite(threshold) && threshold >= 1 ? threshold : undefined });
  return starboardView(guild);
}

export function countingView(guild) {
  const cfg = getGuildCounting(guild.id);
  const channelName = cfg.channelId ? guild.channels.cache.get(cfg.channelId)?.name ?? "(deleted)" : "not set";
  const enabled = Boolean(cfg.channelId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${status(enabled)} Counting Game`)
    .setDescription(
      `Channel: <#${channelName}>\nCurrent: **${cfg.current}** · Best: **${cfg.best}**\nMode: **${cfg.chill ? "Chill" : cfg.strict ? "Strict" : "Lenient"}**\nEmojis: ${cfg.emojis.correct} ${cfg.emojis.sixtyNine} ${cfg.emojis.milestone}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_count_toggle")
      .setLabel(enabled ? "Disable" : "Enable")
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("pn_count_modal")
      .setLabel("Settings")
      .setStyle(ButtonStyle.Secondary),
    backBtn()
  );

  return { embeds: [embed], components: [row] };
}

export function countingModal(guild) {
  const cfg = getGuildCounting(guild.id);
  const emojis = cfg.emojis ?? DEFAULT_COUNTING_EMOJIS;

  const modal = new ModalBuilder()
    .setCustomId("pn_count_modal_submit")
    .setTitle("Counting Settings");

  const correct = new TextInputBuilder()
    .setCustomId("correct")
    .setLabel("Correct emoji")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(32)
    .setValue(emojis.correct)
    .setRequired(true);

  const sixtyNine = new TextInputBuilder()
    .setCustomId("sixtyNine")
    .setLabel("69 emoji")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(32)
    .setValue(emojis.sixtyNine)
    .setRequired(true);

  const milestone = new TextInputBuilder()
    .setCustomId("milestone")
    .setLabel("Milestone emoji")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(32)
    .setValue(emojis.milestone)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(correct),
    new ActionRowBuilder().addComponents(sixtyNine),
    new ActionRowBuilder().addComponents(milestone)
  );
  return modal;
}

export function handleCountSubmit(interaction, values) {
  const guild = interaction.guild;
  const cfg = getGuildCounting(guild.id);

  if (values.correct) cfg.emojis.correct = values.correct.trim() || DEFAULT_COUNTING_EMOJIS.correct;
  if (values.sixtyNine) cfg.emojis.sixtyNine = values.sixtyNine.trim() || DEFAULT_COUNTING_EMOJIS.sixtyNine;
  if (values.milestone) cfg.emojis.milestone = values.milestone.trim() || DEFAULT_COUNTING_EMOJIS.milestone;
  commitCounting(guild.id);

  return countingView(guild);
}

export async function toggleCounting(guild) {
  const cfg = getGuildCounting(guild.id);
  if (cfg.channelId) {
    cfg.channelId = null;
    cfg.statusMessageId = null;
    commitCounting(guild.id);
  }
  return countingView(guild);
}

export function autorolesView(guild) {
  const cfg = getAutoRoles(guild.id);
  const enabled = Boolean(cfg.humanRoleId || cfg.botRoleId);
  const humanName = cfg.humanRoleId ? guild.roles.cache.get(cfg.humanRoleId)?.name ?? "(deleted)" : "none";
  const botName = cfg.botRoleId ? guild.roles.cache.get(cfg.botRoleId)?.name ?? "(deleted)" : "none";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${status(enabled)} Auto-Roles`)
    .setDescription(`Human role: **${humanName}**\nBot role: **${botName}**`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_ar_toggle")
      .setLabel(enabled ? "Disable" : "Enable")
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("pn_ar_modal")
      .setLabel("Settings")
      .setStyle(ButtonStyle.Secondary),
    backBtn()
  );

  return { embeds: [embed], components: [row] };
}

export function autorolesModal() {
  const modal = new ModalBuilder()
    .setCustomId("pn_ar_modal_submit")
    .setTitle("Auto-Role Settings");

  const humanRole = new TextInputBuilder()
    .setCustomId("humanRoleId")
    .setLabel("Role ID for humans (leave empty for none)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(20)
    .setRequired(false);

  const botRole = new TextInputBuilder()
    .setCustomId("botRoleId")
    .setLabel("Role ID for bots (leave empty for none)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(20)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(humanRole),
    new ActionRowBuilder().addComponents(botRole)
  );
  return modal;
}

export function handleArSubmit(interaction, values) {
  const guild = interaction.guild;
  const humanRoleId = values.humanRoleId?.trim() || null;
  const botRoleId = values.botRoleId?.trim() || null;

  if (!humanRoleId && !botRoleId) {
    disableAutoRoles(guild.id);
  } else {
    try {
      setAutoRoles(guild, { humanRoleId, botRoleId });
    } catch (err) {
      return {
        content: `\u274C ${err.message}`,
        components: [new ActionRowBuilder().addComponents(backBtn())],
        flags: MessageFlags.Ephemeral
      };
    }
  }
  return autorolesView(guild);
}

export function loggingView(guild) {
  const channelId = getLogChannel(guild.id);
  const channelName = channelId ? guild.channels.cache.get(channelId)?.name ?? "(deleted)" : "not set";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("\u{1F4DD} Logging")
    .setDescription(`Update log channel: <#${channelName}>`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_log_modal")
      .setLabel("Set channel")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("pn_log_clear")
      .setLabel("Clear")
      .setStyle(ButtonStyle.Danger),
    backBtn()
  );

  return { embeds: [embed], components: [row] };
}

export function loggingModal() {
  const modal = new ModalBuilder()
    .setCustomId("pn_log_modal_submit")
    .setTitle("Logging Channel");

  const channel = new TextInputBuilder()
    .setCustomId("channelId")
    .setLabel("Channel ID (leave empty to disable)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(20)
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(channel));
  return modal;
}

export function handleLogSubmit(interaction, values) {
  const guild = interaction.guild;
  const channelId = values.channelId?.trim() || null;
  if (channelId) {
    const ch = guild.channels.cache.get(channelId);
    if (!ch || !ch.isTextBased()) {
      return {
        content: "\u274C That's not a valid text channel.",
        components: [new ActionRowBuilder().addComponents(backBtn())],
        flags: MessageFlags.Ephemeral
      };
    }
  }
  setLogChannel(guild.id, channelId);
  return loggingView(guild);
}

export function commandsView(guild) {
  const data = getData();
  const disabled = data.commands?.[guild.id]?.disabled ?? [];

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("\u{1F4AC} Commands")
    .setDescription(
      disabled.length
        ? `**${disabled.length}** command(s) disabled: ${disabled.map((c) => `\`/${c}\``).join(", ")}`
        : "All commands are **enabled**."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pn_cmds_modal")
      .setLabel("Toggle commands")
      .setStyle(ButtonStyle.Secondary),
    backBtn()
  );

  return { embeds: [embed], components: [row] };
}

export function commandsModal(guild) {
  const data = getData();
  const disabled = data.commands?.[guild.id]?.disabled ?? [];

  const modal = new ModalBuilder()
    .setCustomId("pn_cmds_modal_submit")
    .setTitle("Toggle Commands");

  const input = new TextInputBuilder()
    .setCustomId("disabled")
    .setLabel("Disabled commands (comma-separated, e.g. ping,avatar)")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setValue(disabled.join(", "))
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export function handleCmdsSubmit(interaction, values) {
  const guild = interaction.guild;
  const raw = values.disabled ?? "";
  const disabled = raw
    .split(",")
    .map((s) => s.trim().replace(/^\//, ""))
    .filter(Boolean);

  const data = getData();
  if (!data.commands[guild.id]) data.commands[guild.id] = {};
  data.commands[guild.id].disabled = [...new Set(disabled)];
  save();

  return commandsView(guild);
}
