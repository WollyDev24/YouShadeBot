import { getWelcome, sendWelcome, buildContext } from "../utils/welcome.js";
import { applyAutoRoles } from "../utils/autoroles.js";
import { trackJoin, executeAntiRaid } from "../utils/antiraid.js";

export default {
  name: "guildMemberAdd",
  async execute(client, member) {
    const guild = member.guild;
    if (!guild) return;

    const result = trackJoin(guild.id, member);
    if (result.raid) {
      await executeAntiRaid(client, guild, { type: "join", count: result.count, users: result.users }).catch((err) =>
        console.error("[antiraid] join burst handling failed:", err.message)
      );
    }

    await applyAutoRoles(member);

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