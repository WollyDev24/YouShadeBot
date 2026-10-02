import { statsConfig, refreshStats } from "../utils/stats.js";
import { getData } from "../utils/db.js";
import { runDue } from "../utils/announcements.js";
import { runDue as runDueGiveaways } from "../utils/giveaways.js";
import { runDue as runDueReminders } from "../utils/reminders.js";
import { startAutoUpdate, notifyLogChannels } from "../utils/updater.js";
import { startPanel } from "../panel/server.js";
import { restoreAllTimers } from "../utils/sticky.js";

/* The AI features fail silently when their configuration is missing: no API
 * key means every message is ignored, and no OWNER_ID means every memory write
 * is refused while the command handlers keep working. Both look like "the bot
 * just ignores me", so say so once at startup instead. */
export function reportAiConfig(guildIds) {
  const enabled = guildIds.some((id) => getData().aichat?.[id]?.enabled);
  if (!enabled) return;

  if (!process.env.GEMINI_API_KEY) {
    console.warn("[ready] AI chat is enabled for at least one server but GEMINI_API_KEY is not set; AI replies are disabled.");
    return;
  }
  if (!process.env.OWNER_ID) {
    console.warn("[ready] OWNER_ID is not set; the AI can read memories but every memory write it attempts will be refused.");
  } else if (!/^\d+$/.test(process.env.OWNER_ID.trim())) {
    console.warn(`[ready] OWNER_ID does not look like a Discord user ID; the AI will refuse all memory writes.`);
  }
}

export default {
  name: "clientReady",
  once: true,
  execute(client) {
    console.log(`[ready] logged in as ${client.user.tag}`);
    client.user.setActivity("/help", { type: "WATCHING" });

    const commandCount = client.commands?.size ?? 0;
    notifyLogChannels(client, `\u{1F7E2} **Bot started** — registered **${commandCount}** commands.`).catch(() => {});

    try {
      reportAiConfig([...client.guilds.cache.keys()]);
    } catch (err) {
      console.error("[ready] AI config check failed:", err.message);
    }

    startPanel(client);
    restoreAllTimers(client);

    setInterval(async () => {
      const data = getData();
      const guildIds = Object.keys(data.stats || {});
      await Promise.allSettled(
        guildIds.map(async (guildId) => {
          const cfg = statsConfig(guildId);
          if (!cfg.enabled) return;
          const guild = client.guilds.cache.get(guildId);
          if (guild) await refreshStats(guild);
        })
      );
    }, 5 * 60_000);

    setInterval(() => {
      runDue(client).catch((err) => console.error("[announcements] scheduler:", err));
      runDueGiveaways(client).catch((err) => console.error("[giveaways] scheduler:", err));
      runDueReminders(client).catch((err) => console.error("[reminders] scheduler:", err));
    }, 30_000);

    startAutoUpdate(client);
  }
};
