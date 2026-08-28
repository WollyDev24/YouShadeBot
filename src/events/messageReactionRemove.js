import { handleStarChange } from "../utils/starboard.js";
import { handleReactionRemove } from "../utils/reactionRoles.js";

export default {
  name: "messageReactionRemove",
  async execute(client, reaction, user) {
    await handleStarChange(reaction);
    await handleReactionRemove(reaction, user);
  }
};
