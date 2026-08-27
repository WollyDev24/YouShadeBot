import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from "../lib/discord.js";
import { lockChannel, unlockChannel, isLocked, getStatus, getAllLockdowns } from "../utils/lockdown.js";

export default {
  data: new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Lock or unlock a channel")
    .addSubcommand((s) =>
      s
        .setName("lock")
        .setDescription("Lock a channel — removes Send Messages from @everyone")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to lock (default: this channel)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("unlock")
        .setDescription("Unlock a channel — restores Send Messages for @everyone")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to unlock (default: this channel)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("status")
        .setDescription("Check if a channel is locked")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to check (default: this channel)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("List all currently locked channels in this server")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "list") {
      const lockdowns = getAllLockdowns();
      if (!lockdowns.length) {
        return interaction.reply({ content: "No channels are currently locked.", flags: MessageFlags.Ephemeral });
      }
      const lines = lockdowns.map((l) => {
        const ch = guild.channels.cache.get(l.channelId);
        const chName = ch ? `#${ch.name}` : "(deleted)";
        const mod = guild.members.cache.get(l.lockedBy);
        const modTag = mod ? mod.user.tag : l.lockedBy;
        const age = Math.floor((Date.now() - l.lockedAt) / 60000);
        return `> ${chName} — locked by ${modTag} ${age}m ago`;
      });
      return interaction.reply({ content: `**Locked channels**\n${lines.join("\n")}`, flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel("channel") ?? interaction.channel;

    if (sub === "lock") {
      if (isLocked(channel.id)) {
        return interaction.reply({ content: `\u274C <#${channel.id}> is already locked.`, flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        await lockChannel(channel, interaction.user.id);
        await interaction.editReply(`\u2705 <#${channel.id}> has been **locked**. Members can no longer send messages.`);
      } catch (err) {
        console.error("[lockdown] lock error:", err);
        await interaction.editReply("\u274C Failed to lock the channel — check my permissions.");
      }
      return;
    }

    if (sub === "unlock") {
      if (!isLocked(channel.id)) {
        return interaction.reply({ content: `\u274C <#${channel.id}> is not locked.`, flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        await unlockChannel(channel);
        await interaction.editReply(`\u2705 <#${channel.id}> has been **unlocked**. Members can send messages again.`);
      } catch (err) {
        console.error("[lockdown] unlock error:", err);
        await interaction.editReply("\u274C Failed to unlock the channel — check my permissions.");
      }
      return;
    }

    if (sub === "status") {
      const status = getStatus(channel.id);
      if (!status) {
        return interaction.reply({ content: `\u2705 <#${channel.id}> is **not locked**.`, flags: MessageFlags.Ephemeral });
      }
      const mod = guild.members.cache.get(status.lockedBy);
      const modTag = mod ? mod.user.tag : status.lockedBy;
      const age = Math.floor((Date.now() - status.lockedAt) / 60000);
      return interaction.reply({
        content: `\u274C <#${channel.id}> is **locked** by ${modTag} — ${age} minute(s) ago.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
