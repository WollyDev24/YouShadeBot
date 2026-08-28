import { handleStarChange } from "../utils/starboard.js";
import { handleReactionAdd } from "../utils/reactionRoles.js";
import { getActivePollByMessage, addVote } from "../utils/polls.js";

const EMOJI_TO_INDEX = {
  "1️⃣": 0, "2️⃣": 1, "3️⃣": 2, "4️⃣": 3, "5️⃣": 4,
  "6️⃣": 5, "7️⃣": 6, "8️⃣": 7, "9️⃣": 8, "🔟": 9
};

export default {
  name: "messageReactionAdd",
  async execute(client, reaction, user) {
    await handleStarChange(reaction);
    await handleReactionAdd(reaction, user);

    if (user.bot) return;
    if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
    if (!reaction?.message) return;

    const pollData = getActivePollByMessage(reaction.message.id);
    if (!pollData) return;

    const optionIndex = EMOJI_TO_INDEX[reaction.emoji.name];
    if (optionIndex === undefined) return;

    const result = addVote(pollData.guildId, pollData.pollId, user.id, optionIndex);
    if (!result) return;

    try {
      const { buildPollEmbed, getPoll } = await import("../utils/polls.js");
      const poll = getPoll(pollData.guildId, pollData.pollId);
      if (poll) {
        await reaction.message.edit({ embeds: [buildPollEmbed(poll)] });
      }
    } catch {}
  }
};
