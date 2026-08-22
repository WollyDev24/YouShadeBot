import { getWelcome, sendWelcome, buildContext } from "../utils/welcome.js";

export default {
  name: "guildMemberAdd",
  async execute(client, member) {
    const guild = member.guild;
    if (!guild) return;

    const cfg = getWelcome(guild.id);
    if (!cfg.enabled || !cfg.channelId || !cfg.message) return;

    const channel = guild.channels.cache.get(cfg.channelId);
    if (!channel || channel.type !== 0) return;

    try {
      await sendWelcome(channel, cfg, buildContext(member));
    } catch (err) {
      console.error("[welcome] send failed:", err.message);
    }
  }
};