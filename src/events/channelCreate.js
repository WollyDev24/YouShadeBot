import { trackChannelCreate, executeAntiRaid } from "../utils/antiraid.js";

export default {
  name: "channelCreate",
  async execute(client, channel) {
    if (!channel || !channel.guild) return;
    if (!channel.isTextBased?.()) return;

    const result = trackChannelCreate(channel.guild.id);
    if (result.raid) {
      await executeAntiRaid(client, channel.guild, { type: "channel", count: result.count }).catch((err) =>
        console.error("[antiraid] channel burst handling failed:", err.message)
      );
    }
  }
};