import { EmbedBuilder } from "../lib/discord.js";
import { getData, saveKey } from "./db.js";

const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export function parseDuration(input) {
  const str = String(input ?? "").trim().toLowerCase();
  if (!str) return null;

  const total = { weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  let matchedAny = false;

  const weekMatch = str.match(/(\d+)\s*w(?!e)/);
  const dayMatch = str.match(/(\d+)\s*d(?!a)/);
  const hourMatch = str.match(/(\d+)\s*h(?!o)/);
  const minMatch = str.match(/(\d+)\s*(?:m(?!s)|min)/);
  const secMatch = str.match(/(\d+)\s*s(?!e)/);

  const pick = (m) => (m ? parseInt(m[1], 10) : 0);
  total.weeks = pick(weekMatch);
  total.days = pick(dayMatch);
  total.hours = pick(hourMatch);
  total.minutes = pick(minMatch);
  total.seconds = pick(secMatch);
  matchedAny = !!(weekMatch || dayMatch || hourMatch || minMatch || secMatch);

  if (!matchedAny) return null;
  const ms =
    total.weeks * 604_800_000 +
    total.days * 86_400_000 +
    total.hours * 3_600_000 +
    total.minutes * 60_000 +
    total.seconds * 1000;
  if (ms <= 0 || ms > MAX_DURATION_MS) return null;
  return ms;
}

export function formatDuration(ms) {
  const secs = Math.round(ms / 1000);
  const w = Math.floor(secs / 604_800);
  const d = Math.floor((secs % 604_800) / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts = [];
  if (w) parts.push(`${w}w`);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(" ") || "0s";
}

export function getReminders(guildId) {
  return getData().reminders[guildId] ?? [];
}

export function getReminder(guildId, id) {
  return getReminders(guildId).find((r) => r.id === id) ?? null;
}

function commit(guildId, list) {
  getData().reminders[guildId] = list;
  saveKey("reminders");
}

export function createReminder(guildId, opts) {
  const list = getReminders(guildId).slice();
  const id = list.length ? Math.max(...list.map((r) => r.id)) + 1 : 1;
  const reminder = {
    id,
    target: opts.target ?? null,
    channelId: String(opts.channelId),
    message: String(opts.message).trim().slice(0, 1500),
    at: Number(opts.at),
    repeatMs: opts.repeatMs ?? null,
    createdAt: Date.now()
  };
  list.push(reminder);
  commit(guildId, list);
  return reminder;
}

export function removeReminder(guildId, id) {
  const list = getReminders(guildId);
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  commit(guildId, list);
  return removed;
}

export function clearReminders(guildId) {
  const count = getReminders(guildId).length;
  if (count) commit(guildId, []);
  return count;
}

export function buildReminderEmbed(reminder) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🔔 Reminder")
    .setDescription(reminder.message)
    .setFooter({
      text:
        (reminder.repeatMs ? `Repeats every ${formatDuration(reminder.repeatMs)} · ` : "") +
        `Reminder #${reminder.id}`
    });
  if (reminder.target) {
    embed.addFields({ name: "For", value: reminder.target, inline: true });
  }
  return embed;
}

async function deliver(client, guildId, reminder) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  const channel = guild.channels.cache.get(reminder.channelId);
  if (!channel || !channel.isTextBased()) return false;

  const content = [
    `🔔 Reminder for ${reminder.target ?? "you"}`,
    reminder.repeatMs
      ? `(repeats every ${formatDuration(reminder.repeatMs)})`
      : "(one-time reminder)"
  ].join(" ");

  try {
    await channel.send({ content, embeds: [buildReminderEmbed(reminder)] });
    return true;
  } catch (err) {
    console.error(`[reminders] delivery failed in ${reminder.channelId}:`, err.message);
    return false;
  }
}

export async function runDue(client) {
  const now = Date.now();
  const data = getData();
  for (const guildId of Object.keys(data.reminders ?? {})) {
    const list = getReminders(guildId);
    if (!list.length) continue;

    let changed = false;
    const kept = [];
    const due = [];

    for (const reminder of list) {
      if (reminder.at <= now) due.push(reminder);
      else kept.push(reminder);
    }

    for (const reminder of due) {
      const ok = await deliver(client, guildId, reminder);
      if (ok && reminder.repeatMs) {
        while (reminder.at <= Date.now()) reminder.at += reminder.repeatMs;
        kept.push(reminder);
        changed = true;
      }
    }

    if (changed || due.length) commit(guildId, kept);
  }
}
