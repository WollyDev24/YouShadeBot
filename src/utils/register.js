import { REST, Routes } from "../lib/discord.js";

const CONCURRENCY = 5;

async function clearScope(rest, route) {
  await rest.put(route, { body: [] });
}

async function mapLimited(items, limit, fn) {
  const queue = [...items];
  async function worker() {
    while (queue.length) await fn(queue.shift());
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function registerCommands(client) {
  const commands = [...client.commands.values()].map((c) => c.data.toJSON());
  if (!commands.length) return;

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const appId = process.env.CLIENT_ID;
  const guildMode = Boolean(process.env.GUILD_ID);

  try {
    if (guildMode) {
      // Debug mode: a stale global command set would double up inside the
      // target guild, so wipe it first.
      await clearScope(rest, Routes.applicationCommands(appId));
    } else {
      // Production (global) mode: purge any leftover guild-scoped commands
      // (e.g. copies stuck to an old GUILD_ID / debug guild) so nothing is
      // registered twice in a server.
      const guilds = client.guilds?.cache?.size
        ? [...client.guilds.cache.values()]
        : [];
      await mapLimited(guilds, CONCURRENCY, (g) =>
        clearScope(rest, Routes.applicationGuildCommands(appId, g.id))
      );
    }

    const route = guildMode
      ? Routes.applicationGuildCommands(appId, process.env.GUILD_ID)
      : Routes.applicationCommands(appId);
    await rest.put(route, { body: commands });
    console.log(`[commands] registered ${commands.length} ${guildMode ? "guild" : "global"} command(s)`);
  } catch (err) {
    console.error("[commands] registration failed:", err);
  }
}