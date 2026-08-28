import { isTriggerChannel, isTempChannel, createTempChannel, getOwner, scheduleDelete, cancelDelete } from "../utils/temp.js";

export default {
  name: "voiceStateUpdate",
  async execute(client, oldState, newState) {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;
    const member = newState.member ?? oldState.member;
    const guildId = guild.id;
    const joinedId = newState.channelId;
    const leftId = oldState.channelId;

    if (joinedId && joinedId !== leftId) {
      cancelDelete(joinedId);

      const trigger = isTriggerChannel(guildId, joinedId);
      const isTemp = isTempChannel(guildId, joinedId);
      console.log(`[temp] voiceStateUpdate: joined ${joinedId}, trigger=${trigger}, isTemp=${isTemp}, temp data:`, JSON.stringify(getData().temp[guildId]?.trigger));

      if (trigger && !isTemp) {
        try {
          await createTempChannel(guild, member, newState.channel);
        } catch (err) {
          console.error("[temp] create failed:", err);
        }
        return;
      }
    }

    if (leftId && leftId !== joinedId && isTempChannel(guildId, leftId)) {
      const channel = guild.channels.cache.get(leftId);
      if (channel && channel.members.size === 0) {
        scheduleDelete(client, guildId, leftId, 60_000);
        const ownerId = getOwner(guildId, leftId);
        const owner = guild.members.cache.get(ownerId);
        if (owner) {
          channel
            .send(`This channel will be deleted in 60 seconds unless someone joins.\nCome back quick, ${owner.displayName}!`)
            .catch(() => {});
        }
      }
    }

    if (joinedId && joinedId !== leftId) {
      cancelDelete(joinedId);
    }
  }
};