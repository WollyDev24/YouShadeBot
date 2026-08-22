import crypto from "node:crypto";
import {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  AttachmentBuilder,
  MessageFlags
} from "../lib/discord.js";
import { getData, save } from "./db.js";

const TYPE_DEFAULTS = {
  name: "New Panel",
  enabled: true,
  categoryId: null,
  closedCategoryId: null,
  staffRoleId: null,
  logChannelId: null,
  panelChannelId: null,
  panelMessageId: null
};

export function getTickets(guildId) {
  const data = getData();
  const raw = data.tickets[guildId];

  if (!raw || !raw.types) {
    const cfg = {
      counter: raw?.counter ?? 0,
      open: raw?.open ?? {},
      types: {},
      combinedMessageId: raw?.combinedMessageId ?? null,
      combinedChannelId: raw?.combinedChannelId ?? null
    };

    // migrate pre-multi-panel flat config into a single "support" type
    if (raw && ("categoryId" in raw || "enabled" in raw)) {
      cfg.types.support = {
        ...TYPE_DEFAULTS,
        id: "support",
        name: "Support",
        enabled: raw.enabled ?? false,
        categoryId: raw.categoryId ?? null,
        staffRoleId: raw.staffRoleId ?? null,
        logChannelId: raw.logChannelId ?? null,
        panelChannelId: raw.panelChannelId ?? null,
        panelMessageId: raw.panelMessageId ?? null
      };
    }

    data.tickets[guildId] = cfg;
    save();
    return cfg;
  }

  return raw;
}

function commit(guildId, cfg) {
  getData().tickets[guildId] = cfg;
  save();
}

export function saveType(guildId, input) {
  const cfg = getTickets(guildId);
  const id = input.id && cfg.types[input.id] ? input.id : crypto.randomUUID().slice(0, 8);
  cfg.types[id] = { ...TYPE_DEFAULTS, ...(cfg.types[id] ?? {}), ...input, id };
  commit(guildId, cfg);
  return cfg.types[id];
}

export function deleteType(guildId, id) {
  const cfg = getTickets(guildId);
  const removed = cfg.types[id];
  delete cfg.types[id];
  commit(guildId, cfg);
  return removed ?? null;
}

/* ---------- panels ---------- */

function typeButton(type) {
  return new ButtonBuilder()
    .setCustomId(`yst_open:${type.id}`)
    .setLabel(type.name.slice(0, 80))
    .setEmoji("\uD83D\uDCAC")
    .setStyle(ButtonStyle.Primary);
}

export function buildSinglePanel(type) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`\uD83D\uDCDD ${type.name}`)
    .setDescription(
      `Need help with **${type.name}**? Click the button below to open a private ticket.\nOnly you and the staff team will be able to see it.`
    );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(typeButton(type))] };
}

export function buildCombinedPanel(types) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("\uD83D\uDCDD Support Tickets")
    .setDescription(
      `Pick what you need help with below.\nEach ticket is private — only you and the staff team can see it.`
    );
  const rows = [];
  for (let i = 0; i < Math.min(types.length, 25); i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...types.slice(i, i + 5).map(typeButton)));
  }
  return { embeds: [embed], components: rows };
}

const closeRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("yst_close")
      .setLabel("Close Ticket")
      .setEmoji("\uD83D\uDD12")
      .setStyle(ButtonStyle.Danger)
  );

const confirmRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("yst_confirm")
      .setLabel("Confirm close")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("yst_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

async function ephemeral(interaction, content, method = "reply") {
  await interaction[method]({ content, flags: MessageFlags.Ephemeral });
}

/* ---------- interactions ---------- */

export async function handleOpen(interaction, typeId) {
  const guild = interaction.guild;
  if (!guild) return;
  const cfg = getTickets(guild.id);
  const type = cfg.types[typeId];

  if (!type || !type.enabled) {
    return ephemeral(interaction, "This ticket panel is currently disabled.", "reply");
  }
  if (!type.categoryId || !type.staffRoleId) {
    return ephemeral(
      interaction,
      "This panel isn't fully configured yet (category/staff role missing). Ask an admin.",
      "reply"
    );
  }

  const existing = Object.entries(cfg.open).find(([, v]) => v.userId === interaction.user.id);
  if (existing) {
    return ephemeral(interaction, `You already have an open ticket: <#${existing[0]}>`, "reply");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    cfg.counter += 1;
    const slug =
      type.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 20) || "ticket";
    const name = `${slug}-${String(cfg.counter).padStart(4, "0")}`;

    const allow = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.EmbedLinks
    ];

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: type.categoryId,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow },
        { id: type.staffRoleId, allow: [...allow, PermissionsBitField.Flags.ManageMessages] },
        {
          id: interaction.client.user.id,
          allow: [...allow, PermissionsBitField.Flags.ManageChannels]
        }
      ]
    });

    cfg.open[channel.id] = { userId: interaction.user.id, typeId: type.id };
    commit(guild.id, cfg);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${type.name} — ${name}`)
      .setDescription(
        `${interaction.user} opened this ticket.\nDescribe your issue and the staff team will get back to you.`
      )
      .setTimestamp();

    await channel.send({ embeds: [embed], components: [closeRow()] });
    await interaction.editReply({ content: `Your ticket is ready: <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error("[tickets] open failed:", err);
    await interaction
      .editReply({ content: "Couldn't create the ticket — check the bot's permissions.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

export async function handleCloseRequest(interaction) {
  const cfg = getTickets(interaction.guild.id);
  if (!cfg.open[interaction.channelId]) {
    return ephemeral(interaction, "This isn't a tracked ticket channel.", "reply");
  }
  await interaction.reply({
    content: "Really close this ticket?",
    components: [confirmRow()],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleCancel(interaction) {
  await interaction.update({ content: "Cancelled.", components: [] });
}

async function sendTranscript(guild, type, channel, entry, closer) {
  if (!type?.logChannelId) return;
  try {
    const logChannel = guild.channels.cache.get(type.logChannelId);
    if (!logChannel) return;

    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = sorted.map((m) => {
      const t = new Date(m.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
      const att = m.attachments.size ? ` [+${m.attachments.size} attachment(s)]` : "";
      return `[${t}] ${m.author.tag}: ${m.content}${att}`;
    });
    const header =
      `Transcript for ${channel.name} (${type?.name ?? "unknown type"})\n` +
      `Opened by: <@${entry.userId}>\n` +
      `Closed by: ${closer.tag}\n` +
      `Messages: ${lines.length}\n` +
      `${"-".repeat(40)}\n`;
    const file = new AttachmentBuilder(Buffer.from(header + lines.join("\n"), "utf8"), {
      name: `transcript-${channel.name}.txt`
    });
    const summary = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`Ticket closed: ${channel.name}`)
      .addFields(
        { name: "Opened by", value: `<@${entry.userId}>`, inline: true },
        { name: "Closed by", value: `${closer}`, inline: true }
      )
      .setTimestamp();
    await logChannel.send({ embeds: [summary], files: [file] });
  } catch (err) {
    console.error("[tickets] transcript failed:", err.message);
  }
}

export async function handleConfirm(interaction) {
  const guild = interaction.guild;
  const cfg = getTickets(guild.id);
  const channelId = interaction.channelId;
  const entry = cfg.open[channelId];

  if (!entry) {
    return interaction.update({ content: "This channel isn't a tracked ticket anymore.", components: [] });
  }
  const normalized = typeof entry === "string" ? { userId: entry, typeId: null } : entry;
  const type = normalized.typeId ? cfg.types[normalized.typeId] : null;

  await interaction.update({ content: "\uD83D\uDD12 Closing ticket\u2026", components: [] });

  const channel = interaction.channel;
  await sendTranscript(guild, type, channel, normalized, interaction.user);

  const closedCategoryId = type?.closedCategoryId;
  const moveToClosed =
    closedCategoryId && guild.channels.cache.get(closedCategoryId)?.type === ChannelType.GuildCategory;

  delete cfg.open[channelId];
  commit(guild.id, cfg);

  if (moveToClosed) {
    await channel.permissionOverwrites
      .edit(normalized.userId, {
        ViewChannel: false,
        SendMessages: false
      })
      .catch(() => {});
    await channel.setParent(closedCategoryId, { lockPermissions: false }).catch(() => {});
    await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => {});
    return;
  }

  await channel.delete("Ticket closed").catch(() => {});
}

export async function routeButton(interaction) {
  const [ns, arg] = interaction.customId.split(":");
  switch (ns) {
    case "yst_open":
      return handleOpen(interaction, arg ?? "support");
    case "yst_close":
      return handleCloseRequest(interaction);
    case "yst_confirm":
      return handleConfirm(interaction);
    case "yst_cancel":
      return handleCancel(interaction);
  }
}