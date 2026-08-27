import { getTickets } from "../utils/tickets.js";
import { saveKey } from "../utils/db.js";

export default {
  name: "channelDelete",
  async execute(client, channel) {
    if (!channel.guild) return;
    const cfg = getTickets(channel.guild.id);
    let dirty = false;

    if (cfg.open[channel.id]) {
      delete cfg.open[channel.id];
      dirty = true;
    }

    if (cfg.combinedChannelId === channel.id && cfg.combinedMessageId) {
      cfg.combinedMessageId = null;
      cfg.combinedChannelId = null;
      dirty = true;
    }

    for (const type of Object.values(cfg.types)) {
      if (type.panelChannelId === channel.id && type.panelMessageId) {
        type.panelMessageId = null;
        dirty = true;
      }
    }

    if (dirty) saveKey("tickets");
  }
};