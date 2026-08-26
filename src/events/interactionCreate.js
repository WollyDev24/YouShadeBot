import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "../lib/discord.js";
import { routeButton } from "../utils/tickets.js";
import { getGiveaway, toggleEntry, renderMessage } from "../utils/giveaways.js";
import { getData } from "../utils/db.js";
import {
  hasPanelAccess,
  mainMenu,
  tempView, toggleTemp,
  statsView, toggleStats,
  welcomeView, welcomeModal, handleWelcomeSubmit,
  starboardView, starboardModal, handleStarSubmit,
  countingView, countingModal, handleCountSubmit, toggleCounting,
  autorolesView, autorolesModal, handleArSubmit,
  loggingView, loggingModal, handleLogSubmit,
  commandsView, commandsModal, handleCmdsSubmit
} from "../utils/panel.js";

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

    if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId?.startsWith("pn_")) {
      if (!hasPanelAccess(interaction.member)) {
        return interaction.reply({ content: "\u274C You don't have access to the panel.", flags: MessageFlags.Ephemeral });
      }
      try {
        await handlePanelInteraction(interaction);
      } catch (err) {
        console.error("[error] panel interaction:", err);
        await safeEphemeral(interaction, friendlyError(err));
      }
      return;
    }
  }
};

async function handlePanelInteraction(interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;

  const UPDATE = { flags: MessageFlags.Ephemeral };

  if (id === "pn_main") return interaction.update({ ...mainMenu(), ...UPDATE });

  const views = {
    pn_temp: () => tempView(guild),
    pn_stats: () => statsView(guild),
    pn_welcome: () => welcomeView(guild),
    pn_starboard: () => starboardView(guild),
    pn_counting: () => countingView(guild),
    pn_autoroles: () => autorolesView(guild),
    pn_logging: () => loggingView(guild),
    pn_commands: () => commandsView(guild)
  };

  if (views[id]) return interaction.update({ ...views[id](), ...UPDATE });

  const toggles = {
    pn_temp_toggle: () => toggleTemp(guild),
    pn_stats_toggle: () => toggleStats(guild),
    pn_welcome_toggle: async () => {
      const { getWelcome } = await import("../utils/welcome.js");
      const cfg = getWelcome(guild.id);
      cfg.enabled = !cfg.enabled;
      const { commitWelcome } = await import("../utils/welcome.js");
      commitWelcome(guild.id);
      return welcomeView(guild);
    },
    pn_star_toggle: async () => {
      const { getStarboardConfig, setStarboard } = await import("../utils/starboard.js");
      const cfg = getStarboardConfig(guild.id);
      if (cfg.enabled) {
        const { disableStarboard } = await import("../utils/starboard.js");
        disableStarboard(guild.id);
      } else {
        setStarboard(guild.id, { enabled: true, channelId: cfg.channelId });
      }
      return starboardView(guild);
    },
    pn_count_toggle: () => toggleCounting(guild),
    pn_ar_toggle: async () => {
      const { getAutoRoles, disableAutoRoles } = await import("../utils/autoroles.js");
      const cfg = getAutoRoles(guild.id);
      if (cfg.humanRoleId || cfg.botRoleId) disableAutoRoles(guild.id);
      return autorolesView(guild);
    },
    pn_log_clear: async () => {
      const { setLogChannel } = await import("../utils/updater.js");
      setLogChannel(guild.id, null);
      return loggingView(guild);
    }
  };

  if (toggles[id]) return interaction.update({ ...await toggles[id](), ...UPDATE });

  if (id === "pn_welcome_modal") return interaction.showModal(welcomeModal());
  if (id === "pn_star_modal") return interaction.showModal(starboardModal());
  if (id === "pn_count_modal") return interaction.showModal(countingModal(guild));
  if (id === "pn_ar_modal") return interaction.showModal(autorolesModal());
  if (id === "pn_log_modal") return interaction.showModal(loggingModal());
  if (id === "pn_cmds_modal") return interaction.showModal(commandsModal(guild));

  if (interaction.isModalSubmit()) {
    const values = {};
    for (const [key, comp] of interaction.fields.fields) {
      values[key] = comp.value;
    }

    const modals = {
      pn_welcome_modal_submit: () => handleWelcomeSubmit(interaction, values),
      pn_star_modal_submit: () => handleStarSubmit(interaction, values),
      pn_count_modal_submit: () => handleCountSubmit(interaction, values),
      pn_ar_modal_submit: () => handleArSubmit(interaction, values),
      pn_log_modal_submit: () => handleLogSubmit(interaction, values),
      pn_cmds_modal_submit: () => handleCmdsSubmit(interaction, values)
    };

    if (modals[id]) {
      const result = await modals[id]();
      if (result.flags) return interaction.reply(result);
      return interaction.update({ ...result, ...UPDATE });
    }
  }
}

function customIdIsJoin(customId) {
  return customId.startsWith("gw_join:");
}
function customIdIsLeave(customId) {
  return customId.startsWith("gw_leave:");
}
function customIdIsKeep(customId) {
  return customId.startsWith("gw_keep:");
}