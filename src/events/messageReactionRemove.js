import { handleStarChange } from "../utils/starboard.js";

export default {
  name: "messageReactionRemove",
  async execute(client, reaction, user) {
    await handleStarChange(reaction);
  }
};
