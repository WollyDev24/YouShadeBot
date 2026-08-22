import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "../lib/discord.js";
import { routeButton } from "../utils/tickets.js";
import { getGiveaway, toggleEntry } from "../utils/giveaways.js";
import { getData } from "../utils/db.js";

function friendlyError(err) {
  if (err.code === 10062) return "This command timed out — try again.";
  if (err.code === 50013) return "I'm missing permissions to do that.";
  if (err.code === 50035 || err.rawError?.message?.includes("Invalid Form Body"))
    return "Invalid input — check the arguments.";
  if (err.message?.includes("Missing Permission"))
    return "I'm missing permissions to do that.";
  return "Something went wrong while running that command.";
}

async function safeEphemeral(interaction, msg) {
  const opts = { content: msg, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred) await interaction.editReply(opts);
    else if (interaction.replied) await interaction.followUp(opts);
    else await interaction.reply(opts);
  } catch {}
}

export default {
  name: "interactionCreate",
  async execute(client, interaction) {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      const disabled = getData().commands?.[interaction.guildId]?.disabled ?? [];
      if (disabled.includes(interaction.commandName)) {
        return interaction.reply({
          content: `\`/${interaction.commandName}\` is disabled on this server.`,
          flags: MessageFlags.Ephemeral
        });
      }

      try {
        await cmd.execute(client, interaction);
      } catch (err) {
        console.error(`[error] /${interaction.commandName}:`, err);
        await safeEphemeral(interaction, friendlyError(err));
      }
      return;
    }

    if (interaction.isButton() && interaction.customId?.startsWith("yst_")) {
      try {
        await routeButton(interaction);
      } catch (err) {
        console.error("[error] ticket button:", err);
        await safeEphemeral(interaction, "Something went wrong with that button.");
      }
      return;
    }

    if (interaction.isButton() && interaction.customId?.startsWith("gw_join:")) {
      const [, guildId, idStr] = interaction.customId.split(":");
      const gw = getGiveaway(guildId, Number(idStr));
      if (!gw || gw.ended) {
        return safeEphemeral(interaction, "This giveaway has ended.");
      }
      const result = toggleEntry(guildId, gw.id, interaction.user.id);
      if (!result) return safeEphemeral(interaction, "This giveaway has ended.");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`gw_join:${guildId}:${gw.id}`)
          .setLabel(`Join (${result.count})`)
          .setStyle(ButtonStyle.Primary)
      );
      try {
        await interaction.update({ components: [row] });
        await interaction.followUp({
          content: result.joined ? "You're in — good luck!" : "You left the giveaway.",
          flags: MessageFlags.Ephemeral
        });
      } catch (err) {
        console.error("[error] giveaway button:", err);
        await safeEphemeral(interaction, "Couldn't update your entry — try again.");
      }
    }
  }
};