import { handleStarChange } from "../utils/starboard.js";

export default {
  name: "messageReactionAdd",
  async execute(client, reaction, user) {
    await handleStarChange(reaction);
  }
};
