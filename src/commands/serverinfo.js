import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

export default {
  data: new SlashCommandBuilder().setName("serverinfo").setDescription("Show info about this server"),

  async execute(client, interaction) {
    const g = interaction.guild;
    const owner = await g.fetchOwner().catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(g.name)
      .setThumbnail(g.iconURL())
      .addFields(
        { name: "Owner", value: owner?.user.tag ?? "Unknown", inline: true },
        { name: "Members", value: String(g.memberCount), inline: true },
        { name: "Channels", value: String(g.channels.cache.size), inline: true },
        { name: "Roles", value: String(g.roles.cache.size), inline: true },
        { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        { name: "Boosts", value: `${g.premiumSubscriptionCount ?? 0}`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }
};