import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

export default {
  data: new SlashCommandBuilder().setName("help").setDescription("List all commands"),

  async execute(client, interaction) {
    const commands = [...client.commands.values()];
    const groups = {};
    for (const c of commands) {
      const sub = c.data.options?.find((o) => ["Subcommand", "SubcommandGroup"].includes(o.constructor.name));
      const cat = sub ? `${c.data.name} (${sub.name})` : c.data.name;
      (groups[c.data.name] ??= []).push(`\`/${cat}\` — ${sub ? sub.description : c.data.description}`);
    }

    const embed = new EmbedBuilder()
      .setTitle("YouShadeBot Commands")
      .setColor(0x5865f2)
      .setDescription("General-purpose Discord management bot.")
      .addFields(
        ...Object.entries(groups).map(([name, lines]) => ({
          name,
          value: lines.join("\n")
        }))
      )
      .setFooter({ text: "Management made easy" });

    return interaction.reply({ embeds: [embed] });
  }
};