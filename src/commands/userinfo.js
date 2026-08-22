import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show info about a member")
    .addUserOption((o) => o.setName("user").setDescription("User (defaults to you)")),

  async execute(client, interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "ID", value: user.id, inline: true },
        { name: "Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        {
          name: "Joined",
          value: target ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>` : "Unknown",
          inline: true
        },
        {
          name: "Roles",
          value: target ? (target.roles.cache.map((r) => r.toString()).slice(0, 5).join(" ") || "None") : "Unknown"
        }
      );

    return interaction.reply({ embeds: [embed] });
  }
};