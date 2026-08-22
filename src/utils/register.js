import { REST, Routes } from "../lib/discord.js";

export async function registerCommands(client) {
  const commands = [...client.commands.values()].map((c) => c.data.toJSON());
  if (!commands.length) return;

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);

  try {
    await rest.put(route, { body: commands });
    console.log(`[commands] registered ${commands.length} global/guild command(s)`);
  } catch (err) {
    console.error("[commands] registration failed:", err);
  }
}
