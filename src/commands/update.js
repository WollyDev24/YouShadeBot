import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import { checkForUpdates } from "../utils/updater.js";

export default {
  data: new SlashCommandBuilder()
    .setName("update")
    .setDescription("Check for new commits and update + restart the bot if available")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await checkForUpdates(client);

    switch (result.status) {
      case "up-to-date":
        return interaction.editReply(`Already on the latest commit (\`${result.sha}\`).`);
      case "updating":
        return interaction.editReply(
          `Found **${result.commits}** new commit(s) — pulling, installing dependencies if needed and restarting. Back in a few seconds!`
        );
      case "dirty":
        return result.modified?.length
          ? interaction.editReply(
              `Skipped: local changes in: \`${result.modified.join("`, `")}\`.\nOn the server run \`git restore ${result.modified
                .map((f) => f)
                .join(" ")}\` and try again.`
            )
          : interaction.editReply(
              "Skipped: the working tree has local changes. Commit or stash them first."
            );
      case "diverged":
        return interaction.editReply(
          "Skipped: local history has diverged from origin — needs a manual `git pull`."
        );
      case "busy":
        return interaction.editReply("An update check is already running.");
      case "error":
        return interaction.editReply(`Update failed: \`${result.error}\``);
      default:
        return interaction.editReply("Update check returned an unknown result.");
    }
  }
};
