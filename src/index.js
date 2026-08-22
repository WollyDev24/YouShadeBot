import "dotenv/config";
import { Client, Collection, GatewayIntentBits } from "./lib/discord.js";
import { loadCommands, loadEvents } from "./utils/handlers.js";
import { registerCommands } from "./utils/register.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

client.commands = new Collection();
client.config = {
  tempCategoryName: "Temporary Channels"
};

const TOKEN = process.env.TOKEN;
if (!TOKEN || TOKEN === "your-bot-token-here") {
  console.error("Missing TOKEN. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

await loadCommands(client);
await loadEvents(client);
await registerCommands(client);

client.login(TOKEN);
