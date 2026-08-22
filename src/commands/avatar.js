import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Get a user's avatar")
    .addUserOption((o) => o.setName("user").setDescription("User (defaults to you)")),

  async execute(client, interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const avatar = user.displayAvatarURL({ size: 1024, extension: "png" });

    const embed = new EmbedBuilder()
      .setTitle(`${user.tag}'s avatar`)
      .setImage(avatar)
      .setColor(0x5865f2);

    return interaction.reply({ embeds: [embed] });
  }
};