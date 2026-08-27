import { statsConfig, refreshStats } from "../utils/stats.js";
import { getData } from "../utils/db.js";
import { runDue } from "../utils/announcements.js";
import { runDue as runDueGiveaways } from "../utils/giveaways.js";
import { startAutoUpdate } from "../utils/updater.js";
import { startPanel } from "../panel/server.js";
import { restoreAllTimers } from "../utils/sticky.js";

export default {
  name: "clientReady",
  once: true,
  execute(client) {
    console.log(`[ready] logged in as ${client.user.tag}`);
    client.user.setActivity("/help", { type: "WATCHING" });

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
    }, 30_000);

    startAutoUpdate(client);
  }
};
