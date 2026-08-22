import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

export default {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check the bot's latency"),

  async execute(client, interaction) {
    const sent = await interaction.reply({ content: "Pinging...", fetchReply: true });
    const ws = client.ws.ping;
    const rtt = sent.createdTimestamp - interaction.createdTimestamp;

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Pong!")
      .addFields(
        { name: "WebSocket", value: `${Math.round(ws)}ms`, inline: true },
        { name: "Roundtrip", value: `${rtt}ms`, inline: true }
      );

    return interaction.editReply({ content: null, embeds: [embed] });
  }
};