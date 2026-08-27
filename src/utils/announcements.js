import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";
import crypto from "node:crypto";

function all() {
  const data = getData();
  if (!data.announcements) data.announcements = {};
  return data.announcements;
}

export function getAnnouncements(guildId) {
  const map = all()[guildId];
  if (!map || typeof map !== "object") return {};
  return map;
}

export function upcoming(guildId) {
  const map = getAnnouncements(guildId);
  return Object.values(map)
    .filter((a) => a && !a.posted)
    .sort((a, b) => a.at - b.at);
}

export function scheduleAnnouncement(guildId, item) {
  const data = getData();
  if (!data.announcements[guildId]) data.announcements[guildId] = {};
  const id = crypto.randomBytes(4).toString("hex");
  data.announcements[guildId][id] = {
    id,
    channelId: String(item.channelId),
    mode: item.mode === "embed" ? "embed" : "text",
    message: String(item.message ?? "").slice(0, 2000),
    title: String(item.title ?? "").slice(0, 256),
    color: String(item.color ?? "#5865F2"),
    footer: String(item.footer ?? "").slice(0, 2048),
    at: Number(item.at),
    posted: false
  };
  saveKey("announcements");
  return data.announcements[guildId][id];
}

export function cancelAnnouncement(guildId, annId) {
  const map = getAnnouncements(guildId);
  if (!map[annId]) return false;
  delete map[annId];
  saveKey("announcements");
  return true;
}

export async function postAnnouncement(client, guildId, ann) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error("Guild not found");
  const channel = await guild.channels.fetch(ann.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error("Channel not found or not text-based");

  let payload;
  if (ann.mode === "embed") {
    let color = parseInt(ann.color.replace("#", ""), 16);
    if (Number.isNaN(color)) color = 0x5865f2;
    const embed = new EmbedBuilder().setColor(color).setDescription(ann.message);
    if (ann.title) embed.setTitle(ann.title);
    if (ann.footer) embed.setFooter({ text: ann.footer });
    payload = { embeds: [embed] };
  } else {
    payload = { content: ann.message };
  }

  await channel.send(payload);
}

export function markPosted(guildId, annId) {
  const map = getAnnouncements(guildId);
  if (map[annId]) {
    map[annId].posted = true;
    saveKey("announcements");
  }
}

export async function runDue(client) {
  const now = Date.now();
  const data = getData();
  for (const guildId of Object.keys(data.announcements || {})) {
    for (const ann of Object.values(data.announcements[guildId] || {})) {
      if (ann.posted || ann.at > now) continue;
      try {
        await postAnnouncement(client, guildId, ann);
        markPosted(guildId, ann.id);
      } catch (err) {
        console.error(`[announcements] failed to post ${ann.id} in guild ${guildId}:`, err.message);
      }
    }
  }
}
