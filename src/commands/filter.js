import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "../lib/discord.js";
import { getRules, addRule, removeRule, clearRules } from "../utils/autores.js";

export default {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Auto-respond when a message contains a trigger word")
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add an auto-response rule")
        .addStringOption((o) =>
          o.setName("trigger").setDescription("Word or phrase to listen for").setRequired(true).setMaxLength(100)
        )
        .addStringOption((o) =>
          o.setName("response").setDescription("What the bot should reply").setRequired(true).setMaxLength(1000)
        )
        .addStringOption((o) =>
          o
            .setName("match")
            .setDescription("How the trigger is matched")
            .addChoices(
              { name: "contains — anywhere in the message", value: "contains" },
              { name: "exact — the whole message", value: "exact" }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a rule by its ID (see /filter list)")
        .addIntegerOption((o) => o.setName("id").setDescription("Rule ID").setRequired(true))
    )
    .addSubcommand((s) => s.setName("list").setDescription("Show all auto-response rules"))
    .addSubcommand((s) =>
      s.setName("clear").setDescription("Delete all auto-response rules")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "add") {
      if (getRules(guild.id).length >= 25) {
        return interaction.reply({
          content: "Limit reached — 25 auto-response rules per server.",
          flags: MessageFlags.Ephemeral
        });
      }
      const rule = addRule(guild.id, {
        trigger: interaction.options.getString("trigger"),
        response: interaction.options.getString("response"),
        match: interaction.options.getString("match") ?? "contains"
      });
      return interaction.reply({
        content:
          `Rule **#${rule.id}** added — I'll reply whenever a message ` +
          (rule.match === "exact" ? `is exactly` : `contains`) +
          ` \`${rule.trigger}\`. Placeholders: \`{user}\` \`{username}\` \`{server}\``,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "remove") {
      const removed = removeRule(guild.id, interaction.options.getInteger("id"));
      if (!removed) {
        return interaction.reply({
          content: "No rule with that ID — check `/filter list`.",
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.reply({
        content: `Removed rule **#${removed.id}** (\`${removed.trigger}\`).`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === "clear") {
      const count = clearRules(guild.id);
      return interaction.reply({
        content: count ? `Deleted ${count} rule(s).` : "There are no rules to delete.",
        flags: MessageFlags.Ephemeral
      });
    }

    const rules = getRules(guild.id);
    if (!rules.length) {
      return interaction.reply({
        content: "No auto-response rules yet. Add one with `/filter add`.",
        flags: MessageFlags.Ephemeral
      });
    }
    const lines = rules.map(
      (r) => `**#${r.id}** \`${r.trigger}\` → ${r.response.slice(0, 80)}${r.response.length > 80 ? "…" : ""} (${r.match})`
    );
    return interaction.reply({
      content: `**Auto-response rules**\n${lines.join("\n")}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
