import { handleStarChange } from "../utils/starboard.js";
import { handleReactionRemove } from "../utils/reactionRoles.js";
import { getActivePollByMessage, removeVote } from "../utils/polls.js";

export default {
  name: "messageReactionRemove",
  async execute(client, reaction, user) {
    await handleStarChange(reaction);
    await handleReactionRemove(reaction, user);

    if (user.bot) return;
    if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
    if (!reaction?.message) return;

    const pollData = getActivePollByMessage(reaction.message.id);
    if (!pollData) return;

    const removed = removeVote(pollData.guildId, pollData.pollId, user.id);
    if (removed === null) return;

    try {
      const { buildPollEmbed, getPoll } = await import("../utils/polls.js");
      const poll = getPoll(pollData.guildId, pollData.pollId);
      if (poll) {
        await reaction.message.edit({ embeds: [buildPollEmbed(poll)] });
      }
    } catch {}
  }
};
