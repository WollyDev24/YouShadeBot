import os from "node:os";
import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

function fmtGB(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check the bot's latency and host stats"),

  async execute(client, interaction) {
    const sent = await interaction.reply({ content: "Pinging...", fetchReply: true });
    const ws = client.ws.ping;
    const rtt = sent.createdTimestamp - interaction.createdTimestamp;

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Pong!")
      .addFields(
        { name: "WebSocket", value: `${Math.round(ws)}ms`, inline: true },
        { name: "Roundtrip", value: `${rtt}ms`, inline: true },
        { name: "Host", value: os.hostname(), inline: true },
        {
          name: "Platform",
          value: `${os.type()} ${os.release()} (${os.arch()})`,
          inline: true
        },
        {
          name: "RAM",
          value: `${fmtGB(os.freemem())} free of ${fmtGB(os.totalmem())}`,
          inline: true
        },
        {
          name: "CPU load",
          value: os.loadavg()[0].toFixed(2),
          inline: true
        },
        { name: "Bot uptime", value: fmtUptime(process.uptime()), inline: true },
        { name: "Host uptime", value: fmtUptime(os.uptime()), inline: true },
        { name: "Node", value: process.version, inline: true }
      );

    return interaction.editReply({ content: null, embeds: [embed] });
  }
};
