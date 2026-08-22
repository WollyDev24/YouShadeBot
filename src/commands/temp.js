import { SlashCommandBuilder, ChannelType, PermissionsBitField, MessageFlags } from "../lib/discord.js";
import { getGuildTemp, getOwner, isTempChannel, save } from "../utils/temp.js";
import { getData } from "../utils/db.js";

export default {
  data: new SlashCommandBuilder()
    .setName("temp")
    .setDescription("Manage temporary voice channels")
    .addSubcommand((s) =>
      s
        .setName("setup")
        .setDescription("Set the voice channel users join to get their own temporary channel")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("The trigger voice channel")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("disable")
        .setDescription("Disable temporary channels for this server")
    )
    .addSubcommand((s) =>
      s
        .setName("name")
        .setDescription("Rename your temporary channel")
        .addStringOption((o) =>
          o.setName("name").setDescription("New channel name (max 30 chars)").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("limit")
        .setDescription("Set the user limit for your channel (0 = no limit)")
        .addIntegerOption((o) =>
          o.setName("limit").setDescription("Max users").setMinValue(0).setMaxValue(99).setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName("lock").setDescription("Lock your channel so no one else can join")
    )
    .addSubcommand((s) =>
      s.setName("unlock").setDescription("Unlock your channel")
    )
    .addSubcommand((s) =>
      s.setName("claim").setDescription("Claim an abandoned temporary channel you are in")
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Delete your temporary channel")
    )
    .addSubcommand((s) =>
      s.setName("info").setDescription("Show temporary channel settings for this server")
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const member = interaction.member;
    const temp = getGuildTemp(guild.id);

    if (["setup", "disable"].includes(sub)) {
      if (
        !member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
        member.id !== guild.ownerId
      ) {
        return interaction.reply({
          content: "You need the **Manage Channels** permission to do that.",
          flags: MessageFlags.Ephemeral
        });
      }
    }

    switch (sub) {
      case "setup": {
        const channel = interaction.options.getChannel("channel");
        temp.trigger = channel.id;
        getData().temp[guild.id] = temp;
        save();
        return interaction.reply({
          content: `Temporary channels are now enabled. Anyone joining ${channel} will get their own channel!`,
          flags: MessageFlags.Ephemeral
        });
      }

      case "disable": {
        getData().temp[guild.id] = { trigger: null, channels: {} };
        save();
        return interaction.reply({ content: "Temporary channels disabled for this server.", flags: MessageFlags.Ephemeral });
      }

      case "info": {
        const trigger = temp.trigger ? `<#${temp.trigger}>` : "none";
        return interaction.reply({
          content: `**Temporary channel settings**\nTrigger channel: ${trigger}\nActive temp channels: ${Object.keys(temp.channels).length}`
        });
      }
    }

    const voice = member.voice;
    const ch = voice.channel;
    if (!ch || !isTempChannel(guild.id, ch.id)) {
      return interaction.reply({
        content: "You must be inside your temporary voice channel to use this.",
        flags: MessageFlags.Ephemeral
      });
    }

    const ownerId = getOwner(guild.id, ch.id);
    const isOwner = ownerId === member.id;

    switch (sub) {
      case "name": {
        if (!isOwner)
          return interaction.reply({ content: "Only the channel owner can do that.", flags: MessageFlags.Ephemeral });
        const rawName = interaction.options.getString("name");
        const clean = rawName.replace(/[^\p{L}\p{N} _!\-]/gu, "").slice(0, 30);
        await ch.setName(`\u{1F3AC} ${clean}`);
        return interaction.reply({ content: `Channel renamed to **${clean}**.`, flags: MessageFlags.Ephemeral });
      }

      case "limit": {
        if (!isOwner)
          return interaction.reply({ content: "Only the channel owner can do that.", flags: MessageFlags.Ephemeral });
        const limit = interaction.options.getInteger("limit");
        await ch.setUserLimit(limit);
        return interaction.reply({ content: limit === 0 ? "User limit removed." : `User limit set to **${limit}**.`, flags: MessageFlags.Ephemeral });
      }

      case "lock": {
        if (!isOwner)
          return interaction.reply({ content: "Only the channel owner can do that.", flags: MessageFlags.Ephemeral });
        await ch.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: false });
        return interaction.reply({ content: "Channel locked. Only you can be joined by friends.", flags: MessageFlags.Ephemeral });
      }

      case "unlock": {
        if (!isOwner)
          return interaction.reply({ content: "Only the channel owner can do that.", flags: MessageFlags.Ephemeral });
        await ch.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: true });
        return interaction.reply({ content: "Channel unlocked.", flags: MessageFlags.Ephemeral });
      }

      case "claim": {
        if (isOwner)
          return interaction.reply({ content: "You already own this channel.", flags: MessageFlags.Ephemeral });
        const owner = guild.members.cache.get(ownerId);
        if (owner && owner.voice?.channelId === ch.id) {
          return interaction.reply({
            content: "The owner is still in the channel, you can't claim it.",
            flags: MessageFlags.Ephemeral
          });
        }
        temp.channels[ch.id] = member.id;
        getData().temp[guild.id] = temp;
        save();
        return interaction.reply({ content: `You are now the owner of **${ch.name}**.`, flags: MessageFlags.Ephemeral });
      }

      case "remove": {
        if (!isOwner)
          return interaction.reply({ content: "Only the channel owner can do that.", flags: MessageFlags.Ephemeral });
        delete temp.channels[ch.id];
        getData().temp[guild.id] = temp;
        save();
        await ch.delete("Owner removed temporary channel");
        return interaction.reply({ content: "Temporary channel deleted.", flags: MessageFlags.Ephemeral });
      }
    }
  }
};