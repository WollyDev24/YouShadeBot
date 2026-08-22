import { statsConfig, refreshStats } from "../utils/stats.js";
import { getData } from "../utils/db.js";
import { runDue } from "../utils/announcements.js";
import { startPanel } from "../panel/server.js";

export default {
  name: "clientReady",
  once: true,
  execute(client) {
    console.log(`[ready] logged in as ${client.user.tag}`);
    client.user.setActivity("/help", { type: "WATCHING" });

    startPanel(client);

    setInterval(async () => {
      const data = getData();
      for (const guildId of Object.keys(data.stats || {})) {
        const cfg = statsConfig(guildId);
        if (!cfg.enabled) continue;
        const guild = client.guilds.cache.get(guildId);
        if (guild) await refreshStats(guild);
      }
    }, 5 * 60_000);

    setInterval(() => {
      runDue(client).catch((err) => console.error("[announcements] scheduler:", err));
    }, 30_000);
  }
};
