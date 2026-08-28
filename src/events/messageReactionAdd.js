import { handleStarChange } from "../utils/starboard.js";
import { handleReactionAdd } from "../utils/reactionRoles.js";

export default {
  name: "messageReactionAdd",
  async execute(client, reaction, user) {
    await handleStarChange(reaction);
    await handleReactionAdd(reaction, user);
  }
};
