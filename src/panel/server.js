import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ChannelType, EmbedBuilder } from "../lib/discord.js";
import { getData, save, saveKey } from "../utils/db.js";
import { getGuildTemp } from "../utils/temp.js";
import { setupStats, disableStats, refreshStats, statsConfig } from "../utils/stats.js";
import { getTickets, saveType, deleteType, buildSinglePanel, buildCombinedPanel } from "../utils/tickets.js";
import { getWelcome, sanitize as sanitizeWelcome, sendWelcome, buildContext } from "../utils/welcome.js";
import { upcoming as upcomingAnnouncements, scheduleAnnouncement, cancelAnnouncement, postAnnouncement } from "../utils/announcements.js";
import { getGuildCounting, commit as commitCounting, setReward as setCountingReward } from "../utils/counting.js";
import { getRules as getFilterRules, addRule as addFilterRule, removeRule as removeFilterRule } from "../utils/autores.js";
import { getAutoRoles as getGuildAutoRoles, setAutoRoles as setGuildAutoRoles, disableAutoRoles as disableGuildAutoRoles } from "../utils/autoroles.js";
import {
  createGiveaway,
  postGiveawayMessage,
  getGiveaways,
  endGiveaway,
  rerollGiveaway
} from "../utils/giveaways.js";
import { parseDuration } from "../utils/reminders.js";
import { getLogChannel, setLogChannel, checkForUpdates } from "../utils/updater.js";
import { getStarboardConfig, setStarboard, disableStarboard } from "../utils/starboard.js";
import { getPanelConfig, setPanelRole } from "../utils/panel.js";
import {
  getSurveys,
  getSurvey,
  createSurvey,
  updateSurvey,
  deleteSurvey,
  buildSurveyMessage
} from "../utils/surveys.js";
import {
  getStickyAll,
  setSticky,
  removeSticky,
  startTimer,
  repostSticky
} from "../utils/sticky.js";
import { registerCommands } from "../utils/register.js";
import { getAutomodConfig } from "../utils/automod.js";
import { getReactionRoles } from "../utils/reactionRoles.js";
import { isLocked, getStatus, getAllLockdowns, lockChannel, unlockChannel, cleanup } from "../utils/lockdown.js";
import { getPolls } from "../utils/polls.js";
import { getReminders } from "../utils/reminders.js";
import { getLeveling, commit as commitLeveling } from "../utils/leveling.js";
import {
  getRoleMenus,
  createRoleMenu,
  addRole as addRoleToMenu,
  removeRole as removeRoleFromMenu,
  deleteRoleMenu,
  buildMenuPayload
} from "../utils/roleMenus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

const FRONTEND_REV = crypto
  .createHash("sha1")
  .update(
    ["index.html", "app.js", "style.css", "privacy.html"]
      .map((f) => fs.readFileSync(path.join(PUBLIC, f)))
      .join("")
  )
  .digest("hex")
  .slice(0, 12);

function authPassword() {
  const pw = process.env.PANEL_PASSWORD || "admin";
  return crypto.createHash("sha256").update(pw).digest("hex");
}

/* ---------- Discord OAuth / sessions ---------- */

const SESSION_COOKIE = "ys_session";
// Bump when the session schema changes (e.g. the meaning of canManage) to force
// Discord users to re-authenticate instead of using a stale stored session.
const SESSION_VERSION = 3;
const OAUTH_CALLBACK_PATH = "/api/oauth/callback";
const DISCORD_API = "https://discord.com/api/v10";
const SESSIONS_FILE = path.join(__dirname, "..", "data", "panel-sessions.json");

// Discord application (bot) ID used for both the OAuth sign-in link and the
// "add the bot to your server" link. A DISCORD_CLIENT_ID env var overrides it.
const PANEL_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1539983823280934952";

function oauthConfig() {
  return {
    enabled: Boolean(process.env.DISCORD_CLIENT_SECRET),
    clientId: PANEL_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET || ""
  };
}

// Discord user IDs granted full panel admin rights (full access to every server,
// "Re-register commands" and update checks). Set via PANEL_ADMIN_USERS="id1,id2".
// Permission integer for the bot invite link (matches README: Manage Channels,
// Manage Messages, Moderate Members, Move Members, View Channel, Send Messages).
const INVITE_PERMISSIONS = 1099528416272;

const adminUserIds = () =>
  new Set((process.env.PANEL_ADMIN_USERS || "").split(",").map((s) => s.trim()).filter(Boolean));

const isSuperuser = (auth) =>
  auth?.kind === "password" ||
  (auth?.kind === "discord" && adminUserIds().has(auth.session.userId));

function oauthRedirect(req) {
  const base = process.env.PANEL_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}${OAUTH_CALLBACK_PATH}`;
}

const sessions = new Map();
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    const stored = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    for (const [k, v] of Object.entries(stored)) sessions.set(k, v);
  }
} catch (err) {
  console.error("[panel] could not load panel sessions:", err.message);
}

function persistSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)));
  } catch (err) {
    console.error("[panel] could not persist panel sessions:", err.message);
  }
}

function newSession(sess) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, sess);
  persistSessions();
  return token;
}

function getSession(req) {
  return sessions.get(req.cookies?.[SESSION_COOKIE] ?? "") ?? null;
}

function deleteSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token && sessions.delete(token)) persistSessions();
}

async function discordRequest(path, { token, method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${DISCORD_API}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function exchangeCode(code, redirectUri) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: PANEL_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    })
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : null;
}

async function refreshOauthToken(refreshToken) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: PANEL_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : null;
}

async function ensureSession(session) {
  if (Date.now() < session.tokenExpires) return session;
  if (!session.refreshToken) return null;
  try {
    const tok = await refreshOauthToken(session.refreshToken);
    if (!tok) return null;
    session.accessToken = tok.access_token;
    session.refreshToken = tok.refresh_token ?? session.refreshToken;
    session.tokenExpires = Date.now() + (tok.expires_in ?? 0) * 1000;
    persistSessions();
    return session;
  } catch {
    return null;
  }
}

function parseMemberGuilds(list) {
  const ADMIN = 0x8n; // Administrator
  return (list ?? []).map((g) => {
    let perms = 0n;
    try {
      perms = typeof g.permissions === "string" ? BigInt(g.permissions) : BigInt(g.permissions ?? 0);
    } catch {}
    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      canManage: Boolean(g.owner) || (perms & ADMIN) !== 0n
    };
  });
}

const payloadCache = new Map();
const PAYLOAD_TTL = 5_000;

function getCachedPayload(guildId) {
  const entry = payloadCache.get(guildId);
  if (entry && Date.now() - entry.ts < PAYLOAD_TTL) return entry.data;
  return null;
}

function invalidatePayload(guildId) {
  payloadCache.delete(guildId);
}

async function guildPayload(client, guild) {
  const cached = getCachedPayload(guild.id);
  if (cached) return cached;

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

  const payload = {
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
        panelChannelId: t.panelChannelId,
        buttonColor: t.buttonColor ?? "Primary"
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
      return { channelId: c.channelId, emojis: { ...c.emojis }, rewardRoleId: c.rewardRoleId ?? null, rewardEvery: c.rewardEvery ?? null, best: c.best ?? 0 };
    })(),
    leveling: (() => {
      const l = getLeveling(guild.id);
      return {
        enabled: l.enabled,
        annChannelId: l.annChannelId,
        removeLower: l.removeLower,
        roles: Object.entries(l.roles ?? {}).map(([level, roleId]) => ({ level: Number(level), roleId })),
        userCount: Object.keys(l.users ?? {}).length
      };
    })(),
    roleMenus: Object.values(getRoleMenus(guild.id)).map((m) => ({
      id: m.id,
      channelId: m.channelId,
      messageId: m.messageId,
      title: m.title,
      mode: m.mode,
      roles: m.roles
    })),
    surveys: Object.values(getSurveys(guild.id)).map((s) => ({
      id: s.id,
      question: s.question,
      description: s.description,
      channelId: s.channelId,
      responseChannelId: s.responseChannelId,
      messageId: s.messageId,
      buttonLabel: s.buttonLabel,
      buttonEmoji: s.buttonEmoji,
      color: s.color,
      responseCount: Object.keys(s.responses).length,
      responses: Object.entries(s.responses).map(([userId, r]) => ({
        userId,
        displayName: r.displayName,
        username: r.username,
        answer: r.answer,
        at: r.at
      }))
    })),
    sticky: (() => {
      const all = getStickyAll(guild.id);
      return Object.entries(all).map(([channelId, s]) => ({
        channelId,
        channelName: guild.channels.cache.get(channelId)?.name ?? "(deleted)",
        content: s.content,
        authorTag: s.authorTag,
        interval: s.interval,
        messageId: s.messageId
      }));
    })(),
    automod: (() => {
      const a = getAutomodConfig(guild.id);
      return {
        enabled: a.enabled,
        logChannelId: a.logChannelId,
        wordFilter: { ...a.wordFilter },
        spamDetection: { ...a.spamDetection },
        massMention: { ...a.massMention },
        inviteBlocking: { ...a.inviteBlocking },
        caseCount: (a.cases ?? []).length
      };
    })(),
    reactionRoles: (() => {
      const rrs = getReactionRoles(guild.id);
      return Object.entries(rrs).map(([messageId, rr]) => ({
        messageId,
        channelId: rr.channelId,
        title: rr.title,
        description: rr.description,
        mode: rr.mode,
        color: rr.color,
        mappingCount: Object.keys(rr.mappings ?? {}).length,
        mappings: Object.entries(rr.mappings ?? {}).map(([emoji, m]) => ({
          emoji,
          roleId: m.roleId,
          roleName: guild.roles.cache.get(m.roleId)?.name ?? "(deleted)",
          label: m.label
        }))
      }));
    })(),
    lockdowns: (() => {
      const lockdowns = getData().lockdowns ?? {};
      return Object.entries(lockdowns)
        .filter(([, l]) => l.locked)
        .map(([channelId, l]) => ({
          channelId,
          lockedBy: l.lockedBy,
          lockedByName: guild.members.cache.get(l.lockedBy)?.user?.tag ?? l.lockedBy,
          lockedAt: l.lockedAt
        }));
    })(),
    polls: (() => {
      const polls = getPolls(guild.id);
      return Object.values(polls).map((p) => ({
        id: p.id,
        question: p.question,
        options: p.options,
        totalVotes: Object.keys(p.votes).length,
        ended: p.ended,
        channelId: p.channelId,
        messageId: p.messageId,
        authorId: p.authorId,
        createdAt: p.createdAt
      }));
    })(),
    reminders: getReminders(guild.id).map((r) => ({
      id: r.id,
      target: r.target,
      channelId: r.channelId,
      message: r.message,
      at: r.at,
      repeatMs: r.repeatMs,
      createdAt: r.createdAt
    })),
    panelRoleId: getPanelConfig(guild.id).roleId,
    availableCommands: [...client.commands.keys()].sort(),
    customEmojis,
    channels,
    categories,
    roles
  };

  payloadCache.set(guild.id, { data: payload, ts: Date.now() });
  return payload;
}

export function startPanel(client) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Request logging for diagnosing hangs behind proxies/routers: logs every
  // incoming request with method, path and a completion marker.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      if (ms >= 500) {
        console.log(`[panel] SLOW ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
      } else {
        console.log(`[panel] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
      }
    });
    next();
  });

  // Decorate every guild payload served to this request with the viewer's
  // manage permission (Discord OAuth users can only edit servers where they
  // have the "Manage Server" permission; password logins are full admins).
  app.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === "object" && body.payload && body.payload.id) {
        body.payload = { ...body.payload, canManage: canManage(req, body.payload.id) };
      }
      return json(body);
    };
    next();
  });

  const AUTH_COOKIE = "ys_panel";

  const getAuth = (req) => {
    if (oauthConfig().enabled) {
      const session = getSession(req);
      if (!session || session.v !== SESSION_VERSION) return null;
      return { kind: "discord", session };
    }
    if (req.cookies?.[AUTH_COOKIE] === authPassword()) return { kind: "password" };
    return null;
  };

  const canManage = (req, guildId) => {
    const auth = getAuth(req);
    if (!auth) return false;
    if (auth.kind === "password") return true;
    return memberAccess(auth.session, guildId)?.canManage ?? false;
  };

  const memberAccess = (session, guildId) => session.guilds.find((g) => g.id === guildId) ?? null;

  const requireAuth = async (req, res, next) => {
    const auth = getAuth(req);
    if (!auth) return res.status(401).json({ error: "unauthorized" });
    if (auth.kind === "discord") {
      const ok = await ensureSession(auth.session);
      if (!ok) {
        deleteSession(req);
        res.clearCookie(SESSION_COOKIE);
        return res.status(401).json({ error: "session expired — sign in again" });
      }
    }
    return next();
  };

  const requireSuperuser = (req, res, next) => {
    if (!isSuperuser(getAuth(req)))
      return res.status(403).json({ error: "This action requires the panel admin password or an admin Discord account." });
    return next();
  };

  app.post("/api/login", (req, res) => {
    if (oauthConfig().enabled)
      return res.status(403).json({ error: "Password sign-in is disabled because Discord OAuth is configured." });
    const { password } = req.body ?? {};
    if (crypto.createHash("sha256").update(String(password)).digest("hex") !== authPassword()) {
      return res.status(401).json({ error: "wrong password" });
    }
    res.clearCookie(SESSION_COOKIE);
    res.cookie(AUTH_COOKIE, authPassword(), {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    deleteSession(req);
    res.clearCookie(AUTH_COOKIE);
    res.clearCookie(SESSION_COOKIE);
    return res.json({ ok: true });
  });

  /* --- Discord OAuth --- */

  app.get("/api/oauth/config", (req, res) => {
    const cfg = oauthConfig();
    return res.json({ enabled: cfg.enabled });
  });

  app.get("/api/oauth/start", (req, res) => {
    const cfg = oauthConfig();
    if (!cfg.enabled) return res.status(400).json({ error: "Discord OAuth is not configured" });
    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = encodeURIComponent(oauthRedirect(req));
    res.cookie("ys_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000 });
    return res.redirect(
      `https://discord.com/api/oauth2/authorize?client_id=${cfg.clientId}` +
        `&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds&state=${state}`
    );
  });

  app.get(OAUTH_CALLBACK_PATH, async (req, res) => {
    const cfg = oauthConfig();
    if (!cfg.enabled) return res.status(400).json({ error: "Discord OAuth is not configured" });
    const { code, state } = req.query;
    if (!code || !state || state !== req.cookies?.ys_oauth_state) {
      return res.redirect("/?oauth=error");
    }
    res.clearCookie("ys_oauth_state");
    const token = await exchangeCode(code, oauthRedirect(req));
    if (!token) {
      console.error("[panel] Discord OAuth token exchange failed");
      return res.redirect("/?oauth=error");
    }
    const me = await discordRequest("/users/@me", { token: token.access_token });
    const gs = await discordRequest("/users/@me/guilds", { token: token.access_token });
    if (!me.ok || !gs.ok) {
      console.error("[panel] Discord OAuth profile fetch failed");
      return res.redirect("/?oauth=error");
    }
    const u = me.data;
    const sessionId = newSession({
      v: SESSION_VERSION,
      kind: "discord",
      userId: u.id,
      name: u.global_name ?? u.username,
      avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null,
      guilds: parseMemberGuilds(gs.data),
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpires: Date.now() + (token.expires_in ?? 0) * 1000
    });
    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    return res.redirect("/");
  });

  app.get("/api/status", requireAuth, async (req, res) => {
    const auth = getAuth(req);
    const base = {
      frontendRev: FRONTEND_REV,
      superuser: isSuperuser(auth),
      oauthEnabled: oauthConfig().enabled,
      user: auth?.kind === "discord"
        ? { id: auth.session.userId, name: auth.session.name, avatar: auth.session.avatar, kind: "discord" }
        : auth?.kind === "password" ? { name: "Administrator", kind: "password" } : null
    };
    // Report the bot online state from the ready flag, not client.user: on some
    // discord.js versions client.user can be unset even while the gateway is up.
    const online = typeof client.isReady === "function" ? client.isReady() : Boolean(client.user);
    if (!online) return res.json({ ...base, online: false });
    const guilds = client.guilds.cache;
    return res.json({
      ...base,
      online: true,
      tag: client.user?.tag ?? client.user?.username ?? "",
      id: client.user?.id ?? "",
      ping: Math.round(client.ws.ping || 0),
      uptime: Math.floor(process.uptime()),
      guildCount: guilds.size,
      totalMembers: guilds.reduce((n, g) => n + g.memberCount, 0),
      inviteUrl: `https://discord.com/oauth2/authorize?client_id=${PANEL_CLIENT_ID}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`
    });
  });

  app.get("/api/guilds", requireAuth, async (req, res) => {
    const auth = getAuth(req);
    // Discord session: only servers the user is in, the bot is in, AND that the
    // user can manage. Read-only servers are hidden so users only manage what
    // they have access to.
    const access =
      auth.kind === "discord" ? new Map(auth.session.guilds.map((g) => [g.id, g])) : null;
    const out = [];
    for (const guild of client.guilds.cache.values()) {
      if (!access) {
        out.push({ ...(await guildPayload(client, guild)), canManage: true });
        continue;
      }
      const acc = access.get(guild.id);
      if (!acc?.canManage) continue; // skip non-member or read-only servers
      const payload = await guildPayload(client, guild);
      out.push({ ...payload, canManage: true });
    }
    return res.json(out.sort((a, b) => a.name.localeCompare(b.name)));
  });

  app.get("/api/guilds/:id", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const auth = getAuth(req);
    if (auth.kind === "discord") {
      const acc = memberAccess(auth.session, guild.id);
      if (!acc?.canManage) return res.status(404).json({ error: "guild not found" });
    }
    return res.json({ ...(await guildPayload(client, guild)), canManage: canManage(req, guild.id) });
  });

  // Gate every per-guild action endpoint: Discord-authenticated users must be a
  // member AND have the "Manage Server" permission on the target server.
  const requireGuildManage = async (req, res, next) => {
    const auth = getAuth(req);
    if (!auth) return res.status(401).json({ error: "unauthorized" });
    if (auth.kind === "password") return next();
    const acc = memberAccess(auth.session, req.params.id);
    if (!acc?.canManage)
      return res.status(404).json({ error: "guild not found" });
    return next();
  };
  app.use("/api/guilds/:id", requireGuildManage);

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

  app.post("/api/commands/register", requireAuth, requireSuperuser, async (req, res) => {
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
      panelChannelId: chan(body.panelChannelId),
      buttonColor: ["Primary", "Secondary", "Success", "Danger"].includes(body.buttonColor)
        ? body.buttonColor
        : "Primary"
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
    const durationMs = parseDuration(String(body.duration ?? ""));
    if (!durationMs)
      return res
        .status(400)
        .json({ error: "Couldn't parse the duration. Use a format like 30s, 5m, 2h, 1d, or 1h30m." });
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
      endsAt: Date.now() + durationMs,
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

  app.post("/api/guilds/:id/counting/reward", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const roleId = body.roleId;
    if (roleId && !guild.roles.cache.has(roleId)) return res.status(400).json({ error: "Role not found." });
    const every = Number(body.every);
    if (every < 1 || !Number.isFinite(every)) return res.status(400).json({ error: "Interval must be at least 1." });

    setCountingReward(guild.id, roleId || null, every);
    return res.json({ ok: true, note: "Counting reward saved.", payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/leveling/save", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const l = getLeveling(guild.id);
    const body = req.body ?? {};
    l.enabled = Boolean(body.enabled ?? l.enabled);
    l.removeLower = Boolean(body.removeLower ?? l.removeLower);
    const annChannelId = body.annChannelId;
    if (annChannelId !== undefined && annChannelId !== null && annChannelId !== "") {
      if (!guild.channels.cache.has(annChannelId)) return res.status(400).json({ error: "Channel not found." });
      l.annChannelId = annChannelId;
    } else {
      l.annChannelId = null;
    }
    commitLeveling(guild.id);
    return res.json({ ok: true, note: "Leveling settings saved.", payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/leveling/set-role", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const l = getLeveling(guild.id);
    const body = req.body ?? {};
    const roleId = body.roleId;
    const level = Number(body.level);
    if (!guild.roles.cache.has(roleId)) return res.status(400).json({ error: "Role not found." });
    if (!Number.isInteger(level) || level < 1) return res.status(400).json({ error: "Level must be a positive integer." });

    l.roles[level] = roleId;
    commitLeveling(guild.id);
    return res.json({ ok: true, note: `Reward role set for level ${level}.`, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/leveling/remove-role", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const l = getLeveling(guild.id);
    const level = Number(req.body?.level);
    if (!Number.isInteger(level) || level < 1) return res.status(400).json({ error: "Level must be a positive integer." });
    delete l.roles[level];
    commitLeveling(guild.id);
    return res.json({ ok: true, note: `Reward role removed for level ${level}.`, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/rolemenus/create", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const channelId = body.channelId;
    if (!channelId || !guild.channels.cache.has(channelId)) return res.status(400).json({ error: "A valid channel is required." });
    const color = String(body.color ?? "#5865f2").trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: "Invalid hex color." });

    const config = createRoleMenu(guild.id, {
      id: body.id || undefined,
      title: body.title,
      description: body.description,
      color,
      mode: body.mode,
      channelId
    });

    const ch = guild.channels.cache.get(channelId);
    let messageId = null;
    if (config.roles.length) {
      const sent = await ch.send(buildMenuPayload(guild, config)).catch(() => null);
      if (sent) messageId = sent.id;
    }
    config.messageId = messageId;
    saveKey("roleMenus");
    return res.json({ ok: true, note: messageId ? "Role menu posted." : "Role menu created — add roles to post it.", payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/rolemenus/add-role", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const roleId = body.roleId;
    if (!guild.roles.cache.has(roleId)) return res.status(400).json({ error: "Role not found." });

    const config = getRoleMenus(guild.id)[body.id];
    if (!config) return res.status(400).json({ error: "Role menu not found." });
    const result = addRoleToMenu(guild.id, config.id, roleId, String(body.label ?? "").trim());
    if (!result.ok) return res.status(400).json({ error: result.error });

    const updated = getRoleMenus(guild.id)[config.id];
    if (config.channelId && config.messageId) {
      const ch = guild.channels.cache.get(config.channelId);
      if (ch) {
        const msg = await ch.messages.fetch(config.messageId).catch(() => null);
        if (msg) await msg.edit(buildMenuPayload(guild, updated)).catch(() => {});
      }
    } else if (config.channelId) {
      const ch = guild.channels.cache.get(config.channelId);
      const sent = await ch?.send(buildMenuPayload(guild, updated)).catch(() => null);
      if (sent) {
        updated.messageId = sent.id;
        saveKey("roleMenus");
      }
    }
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/rolemenus/remove-role", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const config = getRoleMenus(guild.id)[req.body?.id];
    if (!config) return res.status(400).json({ error: "Role menu not found." });
    if (!guild.roles.cache.has(req.body?.roleId)) return res.status(400).json({ error: "Role not found." });
    const result = removeRoleFromMenu(guild.id, config.id, req.body.roleId);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const updated = getRoleMenus(guild.id)[config.id];
    if (config.channelId && config.messageId) {
      const ch = guild.channels.cache.get(config.channelId);
      if (ch) {
        const msg = await ch.messages.fetch(config.messageId).catch(() => null);
        if (msg) await msg.edit(buildMenuPayload(guild, updated)).catch(() => {});
      }
    }
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/rolemenus/delete", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const config = getRoleMenus(guild.id)[req.body?.id];
    if (!config) return res.status(400).json({ error: "Role menu not found." });
    if (config.channelId && config.messageId) {
      const ch = guild.channels.cache.get(config.channelId);
      if (ch) {
        const msg = await ch.messages.fetch(config.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    }
    deleteRoleMenu(guild.id, config.id);
    return res.json({ ok: true, note: "Role menu deleted.", payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/surveys/create", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const question = String(body.question ?? "").trim();
    if (!question) return res.status(400).json({ error: "Question cannot be empty." });

    const color = String(body.color ?? "#5865f2").trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: "Invalid hex color." });
    }

    const channelId = body.channelId && guild.channels.cache.has(body.channelId) ? body.channelId : null;
    const responseChannelId = body.responseChannelId && guild.channels.cache.has(body.responseChannelId)
      ? body.responseChannelId
      : null;

    const survey = createSurvey(guild.id, {
      question,
      description: String(body.description ?? "").trim(),
      channelId,
      responseChannelId,
      buttonLabel: String(body.buttonLabel ?? "Take Survey").slice(0, 80) || "Take Survey",
      buttonEmoji: String(body.buttonEmoji ?? "📋").slice(0, 32) || "📋",
      color: color.startsWith("#") ? color : `#${color}`
    });

    if (channelId) {
      const ch = guild.channels.cache.get(channelId);
      if (ch && ch.isTextBased()) {
        try {
          const msg = await ch.send(buildSurveyMessage(guild, survey));
          survey.messageId = msg.id;
          const { save: sv } = await import("../utils/db.js");
          sv();
        } catch {}
      }
    }

    return res.json({ ok: true, savedId: survey.id, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/surveys/save", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const id = Number(body.id);
    const survey = getSurvey(guild.id, id);
    if (!survey) return res.status(400).json({ error: "Survey not found." });

    const channelId = body.channelId && guild.channels.cache.has(body.channelId) ? body.channelId : survey.channelId;
    const responseChannelId = body.responseChannelId && guild.channels.cache.has(body.responseChannelId)
      ? body.responseChannelId
      : survey.responseChannelId;

    updateSurvey(guild.id, id, {
      question: body.question !== undefined ? String(body.question).trim() || survey.question : survey.question,
      description: body.description !== undefined ? String(body.description).trim() : survey.description,
      channelId,
      responseChannelId,
      buttonLabel: body.buttonLabel !== undefined ? String(body.buttonLabel).slice(0, 80) || survey.buttonLabel : survey.buttonLabel,
      buttonEmoji: body.buttonEmoji !== undefined ? String(body.buttonEmoji).slice(0, 32) || survey.buttonEmoji : survey.buttonEmoji,
      color: body.color !== undefined
        ? (String(body.color).startsWith("#") ? String(body.color) : `#${String(body.color)}`)
        : survey.color
    });

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/surveys/delete", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const id = Number(req.body?.id);
    const removed = deleteSurvey(guild.id, id);
    if (!removed) return res.status(400).json({ error: "Survey not found." });

    if (removed.messageId && removed.channelId) {
      const ch = guild.channels.cache.get(removed.channelId);
      const old = ch ? await ch.messages.fetch(removed.messageId).catch(() => null) : null;
      if (old) await old.delete().catch(() => {});
    }

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/surveys/post", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const id = Number(req.body?.id);
    const survey = getSurvey(guild.id, id);
    if (!survey) return res.status(400).json({ error: "Survey not found." });

    const channelId = req.body?.channelId && guild.channels.cache.has(req.body.channelId)
      ? req.body.channelId
      : survey.channelId;
    if (!channelId) {
      return res.status(400).json({ error: "Pick a channel to post to." });
    }

    const ch = guild.channels.cache.get(channelId);
    if (!ch || !ch.isTextBased()) {
      return res.status(400).json({ error: "That's not a valid text channel." });
    }

    try {
      if (survey.messageId && survey.channelId) {
        const oldCh = guild.channels.cache.get(survey.channelId);
        const old = oldCh ? await oldCh.messages.fetch(survey.messageId).catch(() => null) : null;
        if (old) await old.delete().catch(() => {});
      }

      const msg = await ch.send(buildSurveyMessage(guild, survey));
      survey.messageId = msg.id;
      survey.channelId = channelId;
      const { save: sv } = await import("../utils/db.js");
      sv();
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/automod/toggle", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getAutomodConfig: gac } = await import("../utils/automod.js");
    const { saveKey } = await import("../utils/db.js");
    const cfg = gac(guild.id);
    cfg.enabled = !cfg.enabled;
    saveKey("automod");
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/automod/feature", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getAutomodConfig: gac } = await import("../utils/automod.js");
    const { saveKey } = await import("../utils/db.js");
    const cfg = gac(guild.id);
    const body = req.body ?? {};
    const feature = body.feature;
    if (!["wordFilter", "spamDetection", "massMention", "inviteBlocking"].includes(feature))
      return res.status(400).json({ error: "Invalid feature." });
    cfg[feature].enabled = body.enabled ?? !cfg[feature].enabled;
    saveKey("automod");
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/automod/config", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getAutomodConfig: gac } = await import("../utils/automod.js");
    const { saveKey } = await import("../utils/db.js");
    const cfg = gac(guild.id);
    const body = req.body ?? {};
    const feature = body.feature;
    if (!["wordFilter", "spamDetection", "massMention", "inviteBlocking"].includes(feature))
      return res.status(400).json({ error: "Invalid feature." });
    if (body.action) cfg[feature].action = body.action;
    if (body.muteDuration !== undefined) cfg[feature].muteDuration = Number(body.muteDuration);
    if (body.messagesPerWindow !== undefined) cfg[feature].messagesPerWindow = Number(body.messagesPerWindow);
    if (body.windowSeconds !== undefined) cfg[feature].windowSeconds = Number(body.windowSeconds);
    if (body.threshold !== undefined) cfg[feature].threshold = Number(body.threshold);
    if (body.logChannelId !== undefined) cfg.logChannelId = body.logChannelId || null;
    saveKey("automod");
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/automod/words/add", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getAutomodConfig: gac } = await import("../utils/automod.js");
    const { saveKey } = await import("../utils/db.js");
    const cfg = gac(guild.id);
    const word = String(req.body?.word ?? "").trim().toLowerCase();
    if (!word) return res.status(400).json({ error: "Word cannot be empty." });
    if (cfg.wordFilter.words.includes(word)) return res.status(400).json({ error: "Word already in list." });
    if (cfg.wordFilter.words.length >= 200) return res.status(400).json({ error: "Max 200 words." });
    cfg.wordFilter.words.push(word);
    saveKey("automod");
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/automod/words/remove", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getAutomodConfig: gac } = await import("../utils/automod.js");
    const { saveKey } = await import("../utils/db.js");
    const cfg = gac(guild.id);
    const word = String(req.body?.word ?? "").trim().toLowerCase();
    const idx = cfg.wordFilter.words.indexOf(word);
    if (idx === -1) return res.status(400).json({ error: "Word not found." });
    cfg.wordFilter.words.splice(idx, 1);
    saveKey("automod");
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/automod/words/clear", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getAutomodConfig: gac } = await import("../utils/automod.js");
    const { saveKey } = await import("../utils/db.js");
    const cfg = gac(guild.id);
    cfg.wordFilter.words = [];
    saveKey("automod");
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/automod/cases/clear", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getAutomodConfig: gac } = await import("../utils/automod.js");
    const { saveKey } = await import("../utils/db.js");
    const cfg = gac(guild.id);
    cfg.cases = [];
    cfg.caseCounter = 0;
    saveKey("automod");
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/reactionroles/add-mapping", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getReactionRoles, addMapping, buildReactionRoleMessage } = await import("../utils/reactionRoles.js");
    const rrs = getReactionRoles(guild.id);
    const body = req.body ?? {};
    const lastKey = Object.keys(rrs).pop();
    if (!lastKey) return res.status(400).json({ error: "No reaction role message exists." });
    const rr = rrs[lastKey];
    const emoji = String(body.emoji ?? "").trim();
    const roleId = body.roleId;
    if (!emoji || !roleId) return res.status(400).json({ error: "Emoji and role required." });
    if (!guild.roles.cache.has(roleId)) return res.status(400).json({ error: "Role not found." });
    addMapping(guild.id, lastKey, emoji, roleId, String(body.label ?? "").trim());
    const updated = getReactionRoles(guild.id)[lastKey];
    if (rr.channelId && rr.messageId) {
      const ch = guild.channels.cache.get(rr.channelId);
      if (ch) {
        const msg = await ch.messages.fetch(rr.messageId).catch(() => null);
        if (msg) await msg.edit(buildReactionRoleMessage(guild, updated)).catch(() => {});
      }
    }
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/reactionroles/remove-mapping", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getReactionRoles, removeMapping, buildReactionRoleMessage } = await import("../utils/reactionRoles.js");
    const rrs = getReactionRoles(guild.id);
    const lastKey = Object.keys(rrs).pop();
    if (!lastKey) return res.status(400).json({ error: "No reaction role message exists." });
    const rr = rrs[lastKey];
    const emoji = String(req.body?.emoji ?? "").trim();
    if (!emoji) return res.status(400).json({ error: "Emoji required." });
    removeMapping(guild.id, lastKey, emoji);
    const updated = getReactionRoles(guild.id)[lastKey];
    if (rr.channelId && rr.messageId) {
      const ch = guild.channels.cache.get(rr.channelId);
      if (ch) {
        const msg = await ch.messages.fetch(rr.messageId).catch(() => null);
        if (msg) await msg.edit(buildReactionRoleMessage(guild, updated)).catch(() => {});
      }
    }
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/reactionroles/delete", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });
    const { getReactionRoles, deleteReactionRole } = await import("../utils/reactionRoles.js");
    const rrs = getReactionRoles(guild.id);
    const lastKey = Object.keys(rrs).pop();
    if (!lastKey) return res.status(400).json({ error: "No reaction role message exists." });
    const rr = rrs[lastKey];
    if (rr.channelId && rr.messageId) {
      const ch = guild.channels.cache.get(rr.channelId);
      if (ch) {
        const msg = await ch.messages.fetch(rr.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    }
    deleteReactionRole(guild.id, lastKey);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/sticky/set", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const body = req.body ?? {};
    const channelId = body.channelId;
    if (!channelId || !guild.channels.cache.has(channelId))
      return res.status(400).json({ error: "Pick a valid channel." });

    const content = String(body.content ?? "").trim();
    if (!content) return res.status(400).json({ error: "Content cannot be empty." });

    const interval = Number(body.interval);
    if (!Number.isFinite(interval) || interval < 1 || interval > 1440)
      return res.status(400).json({ error: "Interval must be 1–1440 minutes." });

    setSticky(guild.id, channelId, {
      content,
      authorTag: "Dashboard",
      authorId: "dashboard",
      interval
    });

    await repostSticky(client, guild.id, channelId);
    startTimer(client, guild.id, channelId);

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/sticky/remove", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const channelId = req.body?.channelId;
    const removed = removeSticky(guild.id, channelId);
    if (!removed) return res.status(400).json({ error: "No sticky in that channel." });

    if (removed.messageId) {
      const ch = guild.channels.cache.get(channelId);
      const old = ch ? await ch.messages.fetch(removed.messageId).catch(() => null) : null;
      if (old) await old.delete().catch(() => {});
    }

    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/lockdown/lock", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const channelId = req.body?.channelId;
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased())
      return res.status(400).json({ error: "Pick a valid text channel." });
    if (isLocked(channelId))
      return res.status(400).json({ error: "Channel is already locked." });

    try {
      await lockChannel(channel, "dashboard");
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/lockdown/unlock", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const channelId = req.body?.channelId;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.status(400).json({ error: "Channel not found." });
    if (!isLocked(channelId))
      return res.status(400).json({ error: "Channel is not locked." });

    try {
      await unlockChannel(channel);
      return res.json({ ok: true, payload: await guildPayload(client, guild) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/guilds/:id/lockdown/unlock-all", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const lockdowns = getAllLockdowns();
    let count = 0;
    for (const l of lockdowns) {
      const ch = guild.channels.cache.get(l.channelId);
      if (ch) {
        try {
          await unlockChannel(ch);
          count++;
        } catch {}
      } else {
        cleanup(l.channelId);
      }
    }
    return res.json({ ok: true, unlocked: count, payload: await guildPayload(client, guild) });
  });

  app.post("/api/guilds/:id/panel/role", requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "guild not found" });

    const roleId = req.body?.roleId || null;
    if (roleId && !guild.roles.cache.has(roleId))
      return res.status(400).json({ error: "Role not found." });

    setPanelRole(guild.id, roleId);
    return res.json({ ok: true, payload: await guildPayload(client, guild) });
  });

  app.post("/api/update/check", requireAuth, requireSuperuser, async (req, res) => {
    const result = await checkForUpdates(client);
    return res.json(result);
  });

  // Serve the panel UI. No-store + revision tags on the asset URLs so browsers
  // never run stale JS/CSS after a bot update (a stale app.js is a common cause
  // of "the popup didn't appear" reports).
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/", (req, res) => {
    const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
    res.set("Content-Type", "text/html; charset=utf-8").send(
      html
        .replace('href="/style.css"', `href="/style.css?v=${FRONTEND_REV}"`)
        .replace('src="/app.js"', `src="/app.js?v=${FRONTEND_REV}"`)
    );
  });
  app.use(express.static(PUBLIC));

  // Wispbyte and similar panels expose your server at a public address:port and
  // provide that port via environment variables (or you set it in Startup > Env
  // vars). Prefer an explicit PANEL_PORT, then the platform-provided PORT.
  const port = Number(
    process.env.PANEL_PORT ||
      process.env.PORT ||
      process.env.WISPB_DEFAULT_PORT ||
      3000
  );
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
    // Self-check: verify the HTTP server actually responds on the bound port.
    // On managed hosts (Wispbyte etc.) the public URL 503s when the process is
    // NOT serving on the port the proxy forwards to. This local probe tells us
    // whether the app is serving or whether it's a proxy/routing issue.
    setTimeout(async () => {
      try {
        const probe = await fetch(`http://127.0.0.1:${port}/`);
        console.log(`[panel] self-check OK: 127.0.0.1:${port} -> HTTP ${probe.status}`);
      } catch (err) {
        console.error(`[panel] self-check FAILED: nothing responding on 127.0.0.1:${port}: ${err.message}`);
      }
    }, 1500);
  });
  return server;
}