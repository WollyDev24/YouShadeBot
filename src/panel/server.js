import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ChannelType, EmbedBuilder } from "../lib/discord.js";
import { getData, save } from "../utils/db.js";
import { getGuildTemp } from "../utils/temp.js";
import { setupStats, disableStats, refreshStats, statsConfig } from "../utils/stats.js";
import { getTickets, saveType, deleteType, buildSinglePanel, buildCombinedPanel } from "../utils/tickets.js";
import { getWelcome, sanitize as sanitizeWelcome, sendWelcome, buildContext } from "../utils/welcome.js";
import { upcoming as upcomingAnnouncements, scheduleAnnouncement, cancelAnnouncement, postAnnouncement } from "../utils/announcements.js";
import { getGuildCounting, commit as commitCounting } from "../utils/counting.js";
import { getRules as getFilterRules, addRule as addFilterRule, removeRule as removeFilterRule } from "../utils/autores.js";
import { getAutoRoles as getGuildAutoRoles, setAutoRoles as setGuildAutoRoles, disableAutoRoles as disableGuildAutoRoles } from "../utils/autoroles.js";
import {
  createGiveaway,
  postGiveawayMessage,
  getGiveaways,
  endGiveaway,
  rerollGiveaway
} from "../utils/giveaways.js";
import { getLogChannel, setLogChannel, checkForUpdates } from "../utils/updater.js";
import { getStarboardConfig, setStarboard, disableStarboard } from "../utils/starboard.js";
import { registerCommands } from "../utils/register.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

function authPassword() {
  const pw = process.env.PANEL_PASSWORD || "admin";
  return crypto.createHash("sha256").update(pw).digest("hex");
}

async function guildPayload(client, guild) {
  const temp = getGuildTemp(guild.id).trigger ?? null;
  const stats = statsConfig(guild.id);

  let triggerName = null;
  if (temp) triggerName = guild.channels.cache.get(temp)?.name ?? null;

  const customEmojis = (await guild.emojis.fetch().catch(() => guild.emojis.cache))
    .map((e) => ({ id: e.id, name: e.name, animated: e.animated }));

  const channels = guild.channels.cache
    .filter((c) => c.type === 0 || c.type === 2)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parent: c.parentId
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const categories = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const roles = guild.roles.cache
    .filter((r) => !r.managed && r.id !== guild.roles.everyone.id && r.editable)
    .sort((a, b) => b.rawPosition - a.rawPosition)
    .map((r) => ({ id: r.id, name: r.name }));

  const tickets = getTickets(guild.id);
  const data = getData();

  return {
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL({ size: 128 }),
    memberCount: guild.memberCount,
    temp: {
      enabled: Boolean(temp),
      triggerId: temp,
      triggerName
    },
    stats: {
      enabled: stats.enabled,
      channels: stats.channels,
      categoryId: stats.categoryId
    },
    tickets: {
      openCount: Object.keys(tickets.open).length,
      types: Object.values(tickets.types).map((t) => ({
        id: t.id,
        name: t.name,
        enabled: t.enabled,
        categoryId: t.categoryId,
        closedCategoryId: t.closedCategoryId,
        staffRoleId: t.staffRoleId,
        logChannelId: t.logChannelId,
        panelChannelId: t.panelChannelId
      })),
      combinedChannelId: tickets.combinedChannelId
    },
    welcome: { ...getWelcome(guild.id) },
    announcements: upcomingAnnouncements(guild.id),
    filters: getFilterRules(guild.id),
    autoRoles: getGuildAutoRoles(guild.id),
    giveaways: getGiveaways(guild.id).map((g) => ({
      id: g.id,
      channelId: g.channelId,
      title: g.title,
      endsAt: g.endsAt,
      winners: g.winners,
      entries: g.entries.length,
      ended: g.ended,
      winnerIds: g.winnerIds
    })),
    disabledCommands: data.commands?.[guild.id]?.disabled ?? [],
    logChannelId: getLogChannel(guild.id),
    starboard: (() => {
      const s = getStarboardConfig(guild.id);
      return { enabled: s.enabled, channelId: s.channelId, threshold: s.threshold, emoji: s.emoji };
    })(),
    counting: (() => {
      const c = getGuildCounting(guild.id);
      return { channelId: c.channelId, emojis: { ...c.emojis } };
    })(),
    availableCommands: [...client.commands.keys()].sort(),
    customEmojis,
    channels,
    categories,
    roles
  };
}

export function startPanel(client) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const AUTH_COOKIE = "ys_panel";

  const requireAuth = (req, res, next) => {
    if (req.cookies?.[AUTH_COOKIE] === authPassword()) return next();
    return res.status(401).json({ error: "unauthorized" });
  };

  app.post("/api/login", (req, res) => {
    const { password } = req.body ?? {};
    if (crypto.createHash("sha256").update(String(password)).digest("hex") !== authPassword()) {
      return res.status(401).json({ error: "wrong password" });
    }
    res.cookie(AUTH_COOKIE, authPassword(), {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    res.clearCookie(AUTH_COOKIE);
    return res.json({ ok: true });
  });

  app.get("/api/status", requireAuth, async (req, res) => {
    if (!client.user) return res.json({ online: false });
    const guilds = client.guilds.cache;
    return res.json({
      online: true,
      tag: client.user.tag,
      id: client.user.id,
      ping: Math.round(client.ws.ping),
      uptime: Math.floor(process.uptime()),
      guildCount: guilds.size,
      totalMembers: guilds.reduce((n, g) => n + g.memberCount, 0)
    });
  });

  app.get("/api/guilds", requireAuth, async (req, res) => {
    const guilds = client.guilds.cache;
    if (!guilds.size) return res.json([]);
    const out = [];
    for (const guild of guilds.values()) {
      out.push(await guildPayload(client, guild));
    }
    return res.json(out.sort((a, b) => a.name.localeCompare(b.name)));
  });

  app.get("/api/guilds/:id", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    return res.json(await guildPayload(client, guild));
  });

  app.post("/api/guilds/:id/temp/setup", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { channelId } = req.body ?? {};
    const ch = guild.channels.cache.get(channelId);
    if (!ch || ch.type !== 2)
      return res.status(400).json({ error: "not a valid voice channel" });

    const data = getData();
    data.temp[guild.id] = data.temp[guild.id] ?? { trigger: null, channels: {} };
    data.temp[guild.id].trigger = channelId;
    save();
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/temp/disable", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const data = getData();
    data.temp[guild.id] = { trigger: null, channels: {} };
    save();
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/stats/setup", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    try {
      await setupStats(guild);
      await refreshStats(guild);
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/stats/refresh", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    await refreshStats(guild);
    return res.json({ ok: true });
  });

  app.post("/api/guilds/:id/stats/disable", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    await disableStats(guild);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/commands/register", requireAuth, async (req, res) => {
    try {
      await registerCommands(client);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/tickets/types/save", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const chan = (v) => (v && guild.channels.cache.has(v) ? v : null);
    const role = (v) => (v && guild.roles.cache.has(v) ? v : null);

    const type = saveType(guild.id, {
      id: body.id ?? null,
      name: String(body.name ?? "New Panel").slice(0, 80) || "New Panel",
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      categoryId: chan(body.categoryId),
      closedCategoryId: chan(body.closedCategoryId),
      staffRoleId: role(body.staffRoleId),
      logChannelId: chan(body.logChannelId),
      panelChannelId: chan(body.panelChannelId)
    });

    return res.json({
      ok: true,
      savedId: type.id,
      payload: await guildPayload(client, guild)
    });
  });

  app.post("/api/guilds/:id/tickets/types/delete", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const { id } = req.body ?? {};
    const removed = deleteType(guild.id, id);

    if (removed?.panelMessageId && removed.panelChannelId) {
      const panel = guild.channels.cache.get(removed.panelChannelId);
      const old = panel ? await panel.messages.fetch(removed.panelMessageId).catch(() => null) : null;
      if (old) await old.delete().catch(() => {});
    }

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/tickets/post", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const cfg = getTickets(guild.id);
    const type = cfg.types[req.body?.typeId];
    if (!type) return res.status(400).json({ error: "Unknown ticket type." });
    if (!type.panelChannelId)
      return res.status(400).json({ error: "Pick a panel channel for this ticket type first." });

    try {
      const panel = guild.channels.cache.get(type.panelChannelId);
      if (!panel) return res.status(400).json({ error: "Panel channel no longer exists." });

      if (type.panelMessageId) {
        const old = await panel.messages.fetch(type.panelMessageId).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }

      const msg = await panel.send(buildSinglePanel(type));
      type.panelMessageId = msg.id;
      save();
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/tickets/post-combined", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const cfg = getTickets(guild.id);
    const channelId = req.body?.channelId;
    const typeIds = Array.isArray(req.body?.typeIds) ? req.body.typeIds : [];

    if (!channelId || !guild.channels.cache.has(channelId))
      return res.status(400).json({ error: "Pick a channel for the combined panel." });

    const types = typeIds.map((id) => cfg.types[id]).filter(Boolean);
    if (!types.length)
      return res.status(400).json({ error: "Enable at least one ticket type first." });
    if (types.length > 25) types.length = 25;

    try {
      const panel = guild.channels.cache.get(channelId);

      if (cfg.combinedMessageId && cfg.combinedChannelId) {
        const oldCh = guild.channels.cache.get(cfg.combinedChannelId);
        const old =
          oldCh && oldCh.id !== channelId
            ? await oldCh.messages.fetch(cfg.combinedMessageId).catch(() => null)
            : await panel.messages.fetch(cfg.combinedMessageId).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }

      const msg = await panel.send(buildCombinedPanel(types));
      cfg.combinedMessageId = msg.id;
      cfg.combinedChannelId = channelId;
      save();
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/tickets/disable", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const cfg = getTickets(guild.id);

    for (const type of Object.values(cfg.types)) {
      type.enabled = false;
      if (type.panelMessageId && type.panelChannelId) {
        const panel = guild.channels.cache.get(type.panelChannelId);
        const old = panel ? await panel.messages.fetch(type.panelMessageId).catch(() => null) : null;
        if (old) await old.delete().catch(() => {});
      }
      type.panelMessageId = null;
    }

    if (cfg.combinedMessageId && cfg.combinedChannelId) {
      const ch = guild.channels.cache.get(cfg.combinedChannelId);
      const old = ch ? await ch.messages.fetch(cfg.combinedMessageId).catch(() => null) : null;
      if (old) await old.delete().catch(() => {});
    }
    cfg.combinedMessageId = null;
    cfg.combinedChannelId = null;
    save();

    const openCount = Object.keys(cfg.open).length;
    return res.json({
      ok: true,
      note: openCount ? `${openCount} open ticket channel(s) left untouched.` : undefined,
      payload: await guildPayload(client, guild)
    });
  });

  app.post("/api/guilds/:id/welcome/save", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const cfg = sanitizeWelcome(req.body ?? {}, guild);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/welcome/test", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    let cfg;
    try {
      cfg = sanitizeWelcome(req.body ?? {}, guild);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!cfg.channelId) return res.status(400).json({ error: "Pick a welcome channel first." });
    const channel = guild.channels.cache.get(cfg.channelId);

    try {
      const ctx = buildContext({
        id: client.user.id,
        displayName: "TestUser",
        guild
      });
      await sendWelcome(channel, cfg, ctx);
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/embeds/send", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const channel = guild.channels.cache.get(body.channelId);
    if (!channel || !channel.isTextBased())
      return res.status(400).json({ error: "Pick a valid text channel." });

    const message = String(body.message ?? "").trim();
    if (!message) return res.status(400).json({ error: "Message cannot be empty." });

    try {
      if (body.mode === "embed") {
        let color = parseInt(String(body.color ?? "#5865F2").replace("#", ""), 16);
        if (Number.isNaN(color)) color = 0x5865f2;
        const embed = new EmbedBuilder().setColor(color).setDescription(message);
        const title = String(body.title ?? "").trim();
        const footer = String(body.footer ?? "").trim();
        if (title) embed.setTitle(title.slice(0, 256));
        if (footer) embed.setFooter({ text: footer.slice(0, 2048) });
        await channel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: message.slice(0, 2000) });
      }
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/announcements/schedule", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const channel = guild.channels.cache.get(body.channelId);
    if (!channel || !channel.isTextBased())
      return res.status(400).json({ error: "Pick a valid text channel." });

    const message = String(body.message ?? "").trim();
    if (!message) return res.status(400).json({ error: "Message cannot be empty." });

    const at = Number(body.at);
    if (!Number.isFinite(at) || at <= Date.now())
      return res.status(400).json({ error: "Pick a time in the future." });

    const item = scheduleAnnouncement(guild.id, {
      channelId: body.channelId,
      mode: body.mode,
      message,
      title: String(body.title ?? "").trim(),
      color: body.color,
      footer: String(body.footer ?? "").trim(),
      at
    });

    return res.json({
      ok: true,
      savedId: item.id,
      payload: await guildPayload(client, guild)
    });
  });

  app.post("/api/guilds/:id/announcements/send-now", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const annId = req.body?.id;
    const map = upcomingAnnouncements(guild.id);
    const ann = map.find((a) => a.id === annId);
    if (!ann) return res.status(400).json({ error: "Announcement not found." });

    try {
      await postAnnouncement(client, guild.id, ann);
      cancelAnnouncement(guild.id, annId);
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/announcements/delete", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const removed = cancelAnnouncement(guild.id, req.body?.id);
    if (!removed) return res.status(400).json({ error: "Announcement not found." });

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/commands/toggles", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const disabled = Array.isArray(req.body?.disabled)
      ? [...new Set(req.body.disabled.map((n) => String(n)))]
      : [];

    const data = getData();
    if (!data.commands[guild.id]) data.commands[guild.id] = {};
    data.commands[guild.id].disabled = disabled;
    save();

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/filters/add", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const trigger = String(req.body?.trigger ?? "").trim();
    const response = String(req.body?.response ?? "").trim();
    const match = req.body?.match === "exact" ? "exact" : "contains";

    if (!trigger) return res.status(400).json({ error: "Trigger cannot be empty." });
    if (!response) return res.status(400).json({ error: "Response cannot be empty." });
    if (getFilterRules(guild.id).length >= 25)
      return res.status(400).json({ error: "Limit reached — 25 rules per server." });

    const rule = addFilterRule(guild.id, { trigger, response, match });
    return res.json({ ok: true, savedId: rule.id, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/filters/remove", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const removed = removeFilterRule(guild.id, Number(req.body?.id));
    if (!removed) return res.status(400).json({ error: "Rule not found." });

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/autoroles/save", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    try {
      const cfg = setGuildAutoRoles(guild, {
        humanRoleId: body.humanRoleId || null,
        botRoleId: body.botRoleId || null
      });
      return res.json({ ok: true, autoRoles: cfg, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/autoroles/disable", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    disableGuildAutoRoles(guild.id);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/giveaways/create", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const channel = guild.channels.cache.get(body.channelId);
    if (!channel || !channel.isTextBased())
      return res.status(400).json({ error: "Pick a valid text channel." });
    if (!String(body.title ?? "").trim()) return res.status(400).json({ error: "Title cannot be empty." });
    if (!String(body.description ?? "").trim())
      return res.status(400).json({ error: "Description cannot be empty." });
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes < 1)
      return res.status(400).json({ error: "Duration must be at least 1 minute." });
    const winners = Number(body.winners);
    if (!Number.isFinite(winners) || winners < 1 || winners > 20)
      return res.status(400).json({ error: "Winners must be between 1 and 20." });

    const gw = createGiveaway(guild.id, {
      channelId: body.channelId,
      title: body.title,
      description: body.description,
      link: String(body.link ?? "").trim(),
      code: body.code,
      winners,
      endsAt: Date.now() + minutes * 60_000,
      hostName: "Dashboard"
    });

    try {
      await postGiveawayMessage(channel, guild.id, gw);
    } catch (err) {
      return res.status(500).json({ error: `Couldn't post: ${err.message}` });
    }
    return res.json({ ok: true, savedId: gw.id, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/giveaways/end", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    try {
      await endGiveaway(client, guild.id, Number(req.body?.id));
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/giveaways/reroll", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    try {
      await rerollGiveaway(client, guild.id, Number(req.body?.id));
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/logging/save", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const channelId = req.body?.channelId;
    if (channelId) {
      const ch = guild.channels.cache.get(channelId);
      if (!ch || !ch.isTextBased())
        return res.status(400).json({ error: "Pick a valid text channel." });
    }
    setLogChannel(guild.id, channelId || null);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/starboard/save", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const channelId = req.body?.channelId;
    if (channelId) {
      const ch = guild.channels.cache.get(channelId);
      if (!ch || !ch.isTextBased())
        return res.status(400).json({ error: "Pick a valid text channel." });
    }
    const threshold = Number(req.body?.threshold);
    if (Number.isFinite(threshold) && threshold < 1)
      return res.status(400).json({ error: "Threshold must be at least 1." });
    const emoji = req.body?.emoji;

    const cfg = setStarboard(guild.id, { channelId: channelId || null, threshold, emoji });
    if (!cfg.channelId) return res.status(400).json({ error: "Pick a channel first." });
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/starboard/disable", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    disableStarboard(guild.id);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/counting/emojis", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const cfg = getGuildCounting(guild.id);
    const body = req.body ?? {};
    if (body.correct) cfg.emojis.correct = String(body.correct).slice(0, 32);
    if (body.sixtyNine) cfg.emojis.sixtyNine = String(body.sixtyNine).slice(0, 32);
    if (body.milestone) cfg.emojis.milestone = String(body.milestone).slice(0, 32);
    commitCounting(guild.id);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/update/check", requireAuth, async (req, res) => {
    const result = await checkForUpdates(client);
    return res.json(result);
  });

  app.use(express.static(PUBLIC));

  const port = Number(process.env.PANEL_PORT || 3000);
  const host = process.env.PANEL_HOST || "0.0.0.0";
  const server = app.listen(port, host, () => {
    console.log(`[panel] dashboard running at http://${host}:${port}`);
    if (host === "0.0.0.0" || host === "::") {
      for (const ni of Object.values(os.networkInterfaces()).flat()) {
        if (ni?.family === "IPv4" && !ni.internal) {
          console.log(`[panel] on your local network: http://${ni.address}:${port}`);
        }
      }
    }
  });
  return server;
}