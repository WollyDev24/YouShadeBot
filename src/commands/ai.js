import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder
} from "../lib/discord.js";
import {
  getAiConfig,
  setAiEnabled,
  setAiChannel,
  addAiChannel,
  removeAiChannel,
  setAiModel,
  requestQuota,
  getUsage,
  DEFAULT_MODEL,
  BASE_LIMIT,
  BOOST_LIMIT
} from "../utils/aichat.js";

function quotaLabel(member) {
  const q = requestQuota(member);
  return Number.isFinite(q) ? String(q) : "unlimited";
}

export default {
  data: new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Manage the AI chat assistant (Gemini)")
    .addSubcommand((s) =>
      s
        .setName("setup")
        .setDescription("Enable the AI and set it to one channel")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel where the bot answers mentions/replies")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a channel to the AI whitelist")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to whitelist")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a channel from the AI whitelist")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to remove")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) => s.setName("enable").setDescription("Enable the AI in its whitelisted channels"))
    .addSubcommand((s) => s.setName("disable").setDescription("Disable the AI (keeps the whitelist)"))
    .addSubcommand((s) =>
      s
        .setName("model")
        .setDescription("Set or view the Gemini model")
        .addStringOption((o) =>
          o.setName("model").setDescription(`Model name (default: ${DEFAULT_MODEL})`).setMaxLength(60)
        )
    )
    .addSubcommand((s) => s.setName("status").setDescription("Show AI status and whitelist"))
    .addSubcommand((s) => s.setName("usage").setDescription("Show how many AI requests you have left today"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const cfg = getAiConfig(guild.id);

    if (sub === "setup") {
      const channel = interaction.options.getChannel("channel");
      setAiChannel(guild.id, channel.id);
      setAiEnabled(guild.id, true);
      return interaction.reply({
        content: `Monolith AI enabled in ${channel}. Mention the bot or reply to one of its messages there to chat.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "add") {
      const channel = interaction.options.getChannel("channel");
      addAiChannel(guild.id, channel.id);
      return interaction.reply({
        content: `${channel} added to the AI whitelist. ${cfg.enabled ? "" : "The AI is still disabled — use \`/ai enable\`."}`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "remove") {
      const channel = interaction.options.getChannel("channel");
      const had = cfg.channels.includes(channel.id);
      removeAiChannel(guild.id, channel.id);
      return interaction.reply({
        content: had
          ? `${channel} removed from the AI whitelist.`
          : `${channel} wasn't on the AI whitelist.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "enable") {
      if (!cfg.channels.length) {
        return interaction.reply({
          content: "Add a channel first with `/ai setup` or `/ai add`.",
          flags: MessageFlags.Ephemeral
        });
      }
      setAiEnabled(guild.id, true);
      return interaction.reply({
        content: "Monolith AI **enabled**.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "disable") {
      setAiEnabled(guild.id, false);
      return interaction.reply({
        content: "Monolith AI **disabled**. Use `/ai enable` to turn it back on.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "model") {
      const model = interaction.options.getString("model");
      if (model) {
        setAiModel(guild.id, model);
        return interaction.reply({
          content: `Gemini model set to \`${getAiConfig(guild.id).model}\`.`,
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.reply({
        content: `Current Gemini model: \`${cfg.model}\``,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "usage") {
      const member = interaction.member;
      const used = getUsage(guild.id, interaction.user.id);
      const quota = requestQuota(member);
      const left = Number.isFinite(quota) ? Math.max(0, quota - used) : "\u221E";
      return interaction.reply({
        content: `Daily AI requests — used: **${used}**, quota: **${quotaLabel(member)}**, left: **${left}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const channels = cfg.channels.map((id) => `<#${id}>`);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("AI Chat Assistant")
      .addFields(
        { name: "Status", value: cfg.enabled ? "Enabled" : "Disabled", inline: true },
        { name: "Model", value: `\`${cfg.model}\``, inline: true },
        {
          name: "Whitelisted channels",
          value: channels.length ? channels.join(", ") : "none",
          inline: false
        },
        {
          name: "Request limits",
          value: `**${BASE_LIMIT}**/day per user · **${BOOST_LIMIT}**/day for boosters · **unlimited** for admins`,
          inline: false
        }
      );
    return interaction.reply({ embeds: [embed] });
  }
};