import { MessageFlags } from "../lib/discord.js";
import { routeButton } from "../utils/tickets.js";
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
    }
  }
};