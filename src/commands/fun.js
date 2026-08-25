import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

const MARRY_YES = [
  "It's a match! {a} and {b} are now married!",
  "Congratulations {a} and {b}! The wedding is in 3 days.",
  "{a} proposed to {b} and they said YES!",
  "Love is in the air! {a} and {b} tied the knot!",
  "{b} couldn't resist {a}'s charm. They're married!"
];

const MARRY_NO = [
  "{b} said no... Better luck next time, {a}.",
  "{b} left on read. {a} will recover... eventually.",
  "{b} rejected {a}! Ouch.",
  "{a} got friend-zoned hard.",
  "{b} said no and laughed. {a} is devastated."
];

const MARRY_MUTUAL = [
  "Both {a} and {b} said yes! The perfect couple!",
  "It was mutual! {a} and {b} are soulmates!",
  "Both {a} and {b} wanted to marry each other!",
  "Love was in the air the whole time! {a} and {b} marry!"
];

const KISS = [
  "{a} gave {b} a sweet kiss on the cheek!",
  "{a} kissed {b} on the forehead. Adorable!",
  "{a} and {b} shared a quick smooch.",
  "{a} planted a kiss on {b}'s hand like a true gentleman.",
  "{a} kissed {b} and time stood still for a moment.",
  "{a} gave {b} a surprise kiss! {b} was not expecting that.",
  "A gentle kiss between {a} and {b}. How romantic!"
];

const SLAP = [
  "{a} slapped {b} across the face!",
  "{a} backhanded {b} with authority!",
  "Ouch! {a} just slapped {b} into next week!",
  "{a} gave {b} a smack! That's gonna leave a mark.",
  "{a} slapped {b} so hard their WiFi disconnected.",
  "{b} got slapped by {a}. No one saw that coming.",
  "{a} slapped {b}! Everyone in the room went silent."
];

const FIGHT = [
  "{a} and {b} threw hands. {w} won — {bystander} barely dodged the chaos.",
  "An epic battle! {a} and {b} clashed. {w} came out on top, {bystander} watched from the sidelines.",
  "{a} vs {b} — {w} delivered the final blow. {bystander} was the ref.",
  "Street fight! {w} destroyed {loser} while {bystander} sold tickets.",
  "{a} challenged {b} to a duel. {w} won decisively. {bystander} was the judge.",
  "It's a brawl! {w} knocked out {loser}. {bystander} called the medics.",
  "{w} absolutely wrecked {loser} in a fight. {bystander} captured it all on video."
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function rng(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function actionEmbed(color, description) {
  return new EmbedBuilder().setColor(color).setDescription(description);
}

export default {
  data: new SlashCommandBuilder()
    .setName("fun")
    .setDescription("Silly interaction commands")
    .addSubcommand((s) =>
      s
        .setName("marry")
        .setDescription("Propose to another user!")
        .addUserOption((o) => o.setName("user").setDescription("Who are you proposing to?").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("kiss")
        .setDescription("Kiss another user!")
        .addUserOption((o) => o.setName("user").setDescription("Who to kiss").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("slap")
        .setDescription("Slap another user!")
        .addUserOption((o) => o.setName("user").setDescription("Who to slap").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("fight")
        .setDescription("Fight another user!")
        .addUserOption((o) => o.setName("user").setDescription("Who to fight").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("hug")
        .setDescription("Hug another user!")
        .addUserOption((o) => o.setName("user").setDescription("Who to hug").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("pat")
        .setDescription("Pat another user on the head!")
        .addUserOption((o) => o.setName("user").setDescription("Who to pat").setRequired(true))
    ),

  async execute(client, interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser("user");
    const author = interaction.user;

    if (target.id === author.id) {
      return interaction.reply({
        embeds: [actionEmbed(0xfee75c, `You can't ${sub} yourself! That's just sad...`)]
      });
    }

    if (target.bot) {
      return interaction.reply({
        embeds: [actionEmbed(0xed4245, `You can't ${sub} a bot! Beep boop.`)]
      });
    }

    const a = `**${author.username}**`;
    const b = `**${target.username}**`;

    switch (sub) {
      case "marry": {
        const roll = Math.random();
        let text;
        let color;
        if (roll < 0.33) {
          text = pick(MARRY_YES).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
          color = 0x57f287;
        } else if (roll < 0.66) {
          text = pick(MARRY_MUTUAL).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
          color = 0x57f287;
        } else {
          text = pick(MARRY_NO).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
          color = 0xed4245;
        }
        return interaction.reply({ embeds: [actionEmbed(color, text)] });
      }

      case "kiss": {
        const text = pick(KISS).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
        return interaction.reply({ embeds: [actionEmbed(0xeb459e, text)] });
      }

      case "slap": {
        const text = pick(SLAP).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
        return interaction.reply({ embeds: [actionEmbed(0xed4245, text)] });
      }

      case "fight": {
        const members = interaction.guild.members.cache;
        const onlineMembers = [...members.values()].filter(
          (m) => !m.user.bot && m.user.id !== author.id && m.user.id !== target.id && m.presence?.status !== "offline"
        );
        const bystander = onlineMembers.length
          ? `**${onlineMembers[Math.floor(Math.random() * onlineMembers.length)].user.username}**`
          : "nobody";

        const aRoll = rng(1, 100);
        const bRoll = rng(1, 100);
        const aName = author.username;
        const bName = target.username;

        let text;
        let color;
        if (aRoll === bRoll) {
          text = `It's a tie! ${a} and ${b} both dealt ${aRoll} damage. ${bystander} declared it a draw.`;
          color = 0xfee75c;
        } else if (aRoll > bRoll) {
          text = pick(FIGHT)
            .replace(/\{a\}/g, a)
            .replace(/\{b\}/g, b)
            .replace(/\{w\}/g, a)
            .replace(/\{loser\}/g, b)
            .replace(/\{bystander\}/g, bystander);
          color = 0x57f287;
        } else {
          text = pick(FIGHT)
            .replace(/\{a\}/g, a)
            .replace(/\{b\}/g, b)
            .replace(/\{w\}/g, b)
            .replace(/\{loser\}/g, a)
            .replace(/\{bystander\}/g, bystander);
          color = 0xed4245;
        }
        return interaction.reply({ embeds: [actionEmbed(color, text)] });
      }

      case "hug": {
        const hugTexts = [
          `${a} gave ${b} a warm, cozy hug!`,
          `${a} hugged ${b} so tight they couldn't breathe.`,
          `${a} wrapped ${b} in the biggest hug ever!`,
          `${a} gave ${b} a gentle hug. Everything is okay now.`,
          `${b} was hugged by ${a}. Day made.`,
          `${a} surprise-hugged ${b}! No escape!`,
          `A group hug? No, just ${a} hugging ${b} very enthusiastically.`
        ];
        return interaction.reply({ embeds: [actionEmbed(0x57f287, pick(hugTexts))] });
      }

      case "pat": {
        const patTexts = [
          `${a} patted ${b} on the head. Good ${b}.`,
          `${a} gave ${b} some head pats. ${b} is now happy.`,
          `${a} patted ${b}. Tail wagging intensifies.`,
          `${a} patted ${b} on the head gently. So precious.`,
          `${b} received head pats from ${a}. Mission accomplished.`,
          `${a} patted ${b} so much they started purring.`,
          `${a} gave ${b} exactly 3 pats. That's the perfect number.`
        ];
        return interaction.reply({ embeds: [actionEmbed(0xfee75c, pick(patTexts))] });
      }
    }
  }
};
