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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_LOGIN_ATTEMPTS = 5;
for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
  try {
    await client.login(TOKEN);
    break;
  } catch (err) {
    if (/invalid token/i.test(err.message)) {
      console.error("[login] token is invalid — check .env");
      process.exit(1);
    }
    console.error(`[login] attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} failed: ${err.message}`);
    if (attempt === MAX_LOGIN_ATTEMPTS) process.exit(1);
    await sleep(5000 * attempt);
  }
}
