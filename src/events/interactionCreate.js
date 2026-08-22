import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "../lib/discord.js";
import { routeButton } from "../utils/tickets.js";
import { getGiveaway, toggleEntry, renderMessage } from "../utils/giveaways.js";
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

    if (interaction.isButton() && interaction.customId?.startsWith("gw_")) {
      const [, guildId, idStr] = interaction.customId.split(":");
      const gw = getGiveaway(guildId, Number(idStr));
      if (!gw) return safeEphemeral(interaction, "This giveaway no longer exists.");
      if (customIdIsJoin(interaction.customId)) {
        if (gw.ended) return safeEphemeral(interaction, "This giveaway has ended.");

        const alreadyIn = gw.entries.includes(interaction.user.id);
        if (!alreadyIn) {
          toggleEntry(guildId, gw.id, interaction.user.id);
          try {
            await interaction.update(renderMessage(guildId, gw));
            await interaction.followUp({
              content: "You're in — good luck!",
              flags: MessageFlags.Ephemeral
            });
          } catch (err) {
            console.error("[error] giveaway button:", err);
            await safeEphemeral(interaction, "Couldn't update your entry — try again.");
          }
        } else {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`gw_leave:${guildId}:${gw.id}`)
              .setLabel("Yes, leave")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`gw_keep:${guildId}:${gw.id}`)
              .setLabel("Keep my entry")
              .setStyle(ButtonStyle.Secondary)
          );
          return interaction.reply({
            content: `You're already in **${gw.title}**. Want to leave?`,
            components: [row],
            flags: MessageFlags.Ephemeral
          });
        }
        return;
      }

      if (customIdIsLeave(interaction.customId)) {
        if (gw.ended) {
          return interaction.update({ content: "This giveaway has already ended.", components: [] });
        }
        toggleEntry(guildId, gw.id, interaction.user.id);
        try {
          const channel = interaction.guild?.channels.cache.get(gw.channelId);
          const msg = channel && gw.messageId ? await channel.messages.fetch(gw.messageId).catch(() => null) : null;
          if (msg) await msg.edit(renderMessage(guildId, gw));
        } catch (err) {
          console.error("[error] giveaway leave refresh:", err);
        }
        return interaction.update({ content: "You left the giveaway.", components: [] });
      }

      if (customIdIsKeep(interaction.customId)) {
        return interaction.update({ content: "You're still in — good luck!", components: [] });
      }
      return;
    }
  }
};

function customIdIsJoin(customId) {
  return customId.startsWith("gw_join:");
}
function customIdIsLeave(customId) {
  return customId.startsWith("gw_leave:");
}
function customIdIsKeep(customId) {
  return customId.startsWith("gw_keep:");
}