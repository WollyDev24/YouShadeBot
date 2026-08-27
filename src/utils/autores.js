import { getData, saveKey } from "./db.js";

function cfg(guildId) {
  const data = getData();
  if (!data.autores[guildId]) data.autores[guildId] = { nextId: 1, rules: [] };
  return data.autores[guildId];
}

export function getRules(guildId) {
  const c = getData().autores[guildId];
  if (!c || typeof c !== "object") return [];
  return c.rules ?? [];
}

export function addRule(guildId, { trigger, response, match }) {
  const c = cfg(guildId);
  const rule = {
    id: c.nextId++,
    trigger: String(trigger).trim().slice(0, 100),
    response: String(response).trim().slice(0, 1000),
    match: match === "exact" ? "exact" : "contains"
  };
  c.rules.push(rule);
  saveKey("autores");
  return rule;
}

export function removeRule(guildId, id) {
  const rules = getRules(guildId);
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const [removed] = rules.splice(idx, 1);
  saveKey("autores");
  return removed;
}

export function clearRules(guildId) {
  const count = getRules(guildId).length;
  if (!count) return 0;
  cfg(guildId).rules = [];
  saveKey("autores");
  return count;
}

export function findMatch(guildId, content) {
  const text = String(content ?? "").trim().toLowerCase();
  if (!text) return null;
  for (const rule of getRules(guildId)) {
    const trigger = rule.trigger.toLowerCase();
    if (rule.match === "exact" ? text === trigger : text.includes(trigger)) {
      return rule;
    }
  }
  return null;
}

export function renderResponse(rule, message) {
  return String(rule.response)
    .replaceAll("{user}", `<@${message.author.id}>`)
    .replaceAll("{username}", message.member?.displayName ?? message.author.username)
    .replaceAll("{server}", message.guild.name ?? "");
}
