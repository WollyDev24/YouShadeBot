import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "../lib/discord.js";
import { getData, save } from "./db.js";

const ACCENT = 0x5865f2;
const ENDED_COLOR = 0x2b2d31;

function cfg(guildId) {
  const data = getData();
  if (!data.giveaways[guildId]) data.giveaways[guildId] = { nextId: 1, list: {} };
  return data.giveaways[guildId];
}

export function getGiveaways(guildId) {
  const list = getData().giveaways[guildId]?.list ?? {};
  return Object.values(list).sort((a, b) => Number(a.ended) - Number(b.ended) || a.endsAt - b.endsAt);
}

export function getGiveaway(guildId, id) {
  return cfg(guildId).list[id] ?? null;
}

export function createGiveaway(guildId, { channelId, title, description, link, code, winners, endsAt, hostId, hostName }) {
  const c = cfg(guildId);
  const gw = {
    id: c.nextId++,
    channelId: String(channelId),
    messageId: null,
    title: String(title).trim().slice(0, 200),
    description: String(description ?? "").trim().slice(0, 1500),
    link: String(link ?? "").trim(),
    code: String(code ?? "").trim().slice(0, 100),
    winners: Math.min(Math.max(Number(winners) || 1, 1), 20),
    endsAt: Number(endsAt),
    hostId: hostId ?? null,
    hostName: String(hostName ?? "Dashboard").slice(0, 80),
    entries: [],
    ended: false,
    winnerIds: []
  };
  c.list[gw.id] = gw;
  save();
  return gw;
}

export function toggleEntry(guildId, id, userId) {
  const gw = getGiveaway(guildId, id);
  if (!gw || gw.ended) return null;
  const idx = gw.entries.indexOf(userId);
  let joined;
  if (idx === -1) {
    gw.entries.push(userId);
    joined = true;
  } else {
    gw.entries.splice(idx, 1);
    joined = false;
  }
  save();
  return { joined, count: gw.entries.length };
}

export function pickWinners(entries, count, exclude = []) {
  const pool = [...new Set(entries)].filter((u) => !exclude.includes(u));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function buildEmbed(gw, { ended = false } = {}) {
  const embed = new EmbedBuilder()
    .setColor(ended ? ENDED_COLOR : ACCENT)
    .setTitle(gw.title)
    .setDescription(
      (gw.description ? `${gw.description}\n\n` : "") +
        (gw.link ? `[Click here for the content](${gw.link})\n` : "")
    );
  if (ended) {
    embed.addFields({
      name: "Winners",
      value: gw.winnerIds.length ? gw.winnerIds.map((w) => `<@${w}>`).join(", ") : "No valid entries"
    });
  } else {
    embed.addFields(
      { name: "Winners", value: String(gw.winners), inline: true },
      { name: "Ends", value: `<t:${Math.floor(gw.endsAt / 1000)}:R>`, inline: true },
      { name: "Entries", value: String(gw.entries.length), inline: true }
    );
  }
  embed.setFooter({ text: `Hosted by ${gw.hostName}` });
  return embed;
}

function joinRow(guildId, gw, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw_join:${guildId}:${gw.id}`)
      .setLabel(`Join (${gw.entries.length})`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

export function renderMessage(guildId, gw) {
  return { embeds: [buildEmbed(gw)], components: [joinRow(guildId, gw)] };
}

export async function postGiveawayMessage(channel, guildId, gw) {
  const msg = await channel.send(renderMessage(guildId, gw));
  gw.messageId = msg.id;
  save();
  return msg;
}

async function dmWinners(client, gw, winnerIds) {
  for (const userId of winnerIds) {
    try {
      const user = await client.users.fetch(userId);
      const content =
        `You won **${gw.title}**!` +
        (gw.code ? `\nYour code: \`${gw.code}\`` : "\nCongratulations!") +
        (gw.link ? `\n${gw.link}` : "");
      await user.send(content);
    } catch {
      // DMs closed or user gone — ignore
    }
  }
}

async function editGiveawayMessage(guild, guildId, gw) {
  const channel = guild.channels.cache.get(gw.channelId);
  if (!channel || !gw.messageId) return;
  const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
  if (!msg) return;
  await msg
    .edit({
      embeds: [buildEmbed(gw, { ended: true })],
      components: [joinRow(guildId, gw, true)]
    })
    .catch(() => {});
}

async function announceWinners(channel, gw, winnerIds) {
  if (!channel) return;
  const body = winnerIds.length
    ? `Congratulations ${winnerIds.map((w) => `<@${w}>`).join(", ")}! You won **${gw.title}**${
        gw.code ? " — check your DMs for your code." : "!"
      }`
    : `**${gw.title}** ended with no entries.`;
  await channel.send(body).catch(() => {});
}

async function conclude(client, guildId, gw) {
  gw.ended = true;
  const winners = pickWinners(gw.entries, gw.winners);
  gw.winnerIds = winners;
  save();

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  await editGiveawayMessage(guild, guildId, gw);
  await announceWinners(guild.channels.cache.get(gw.channelId), gw, winners);
  await dmWinners(client, gw, winners);
}

export async function endGiveaway(client, guildId, id) {
  const gw = getGiveaway(guildId, id);
  if (!gw) throw new Error("Giveaway not found.");
  if (gw.ended) throw new Error("That giveaway already ended.");
  await conclude(client, guildId, gw);
  return gw;
}

export async function rerollGiveaway(client, guildId, id) {
  const gw = getGiveaway(guildId, id);
  if (!gw) throw new Error("Giveaway not found.");
  if (!gw.ended) throw new Error("That giveaway is still running — end it first.");
  if (!gw.entries.length) throw new Error("Nobody entered that giveaway.");

  const fresh = pickWinners(gw.entries, gw.winners, gw.winnerIds);
  if (!fresh.length) throw new Error("Everyone who entered already won.");

  gw.winnerIds.push(...fresh);
  save();

  const guild = client.guilds.cache.get(guildId);
  if (guild) {
    await editGiveawayMessage(guild, guildId, gw);
    await announceWinners(guild.channels.cache.get(gw.channelId), gw, fresh);
  }
  await dmWinners(client, gw, fresh);
  return fresh;
}

export async function runDue(client) {
  const now = Date.now();
  const data = getData();
  for (const guildId of Object.keys(data.giveaways ?? {})) {
    for (const gw of Object.values(data.giveaways[guildId]?.list ?? {})) {
      if (gw.ended || gw.endsAt > now) continue;
      try {
        await conclude(client, guildId, gw);
      } catch (err) {
        console.error(`[giveaways] failed to conclude #${gw.id} in ${guildId}:`, err.message);
      }
    }
  }
}
