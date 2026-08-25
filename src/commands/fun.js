import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function rng(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const GIFS = {
  marry_yes: [
    "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    "https://media.giphy.com/media/3ohhwxmNcPvwyRqYKI/giphy.gif",
    "https://media.giphy.com/media/XkzDebnXFTbHO/giphy.gif"
  ],
  marry_no: [
    "https://media.giphy.com/media/3o7TKFmcX1aW4pv3FC/giphy.gif",
    "https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif",
    "https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif"
  ],
  marry_mutual: [
    "https://media.giphy.com/media/l0HlIsKwA9xQxvS00/giphy.gif",
    "https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif",
    "https://media.giphy.com/media/JUvSjMi1usMk0/giphy.gif"
  ],
  kiss: [
    "https://media.giphy.com/media/l0MYGb1LuZ3n7dRnO/giphy.gif",
    "https://media.giphy.com/media/AYaorNT5eOGBo/giphy.gif",
    "https://media.giphy.com/media/WaI2vVzIa3LGU/giphy.gif"
  ],
  slap: [
    "https://media.giphy.com/media/l0MYyBWacS04pDqic/giphy.gif",
    "https://media.giphy.com/media/11s7VY5aGTPtV6/giphy.gif",
    "https://media.giphy.com/media/l378bu8bJWzvXbKsE/giphy.gif"
  ],
  fight: [
    "https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif",
    "https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif",
    "https://media.giphy.com/media/l4FGI2HnlKMvKwfG0/giphy.gif"
  ],
  hug: [
    "https://media.giphy.com/media/l378bpHYLrBycrq1a/giphy.gif",
    "https://media.giphy.com/media/l0Hlx1b4KB0dRr20E/giphy.gif",
    "https://media.giphy.com/media/VbW9vSG9BxAei/giphy.gif"
  ],
  pat: [
    "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif",
    "https://media.giphy.com/media/l0MYGb1LuZ3n7dRnO/giphy.gif",
    "https://media.giphy.com/media/3ohhwxkT9dQi0M5FM4/giphy.gif"
  ]
};

async function reply(interaction, color, description, gifCategory) {
  const embed = new EmbedBuilder().setColor(color).setDescription(description);
  try {
    embed.setImage(pick(GIFS[gifCategory]));
  } catch {}
  return interaction.reply({ embeds: [embed] });
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
        embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`You can't ${sub} yourself! That's just sad...`)]
      });
    }

    if (target.bot) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(`You can't ${sub} a bot! Beep boop.`)]
      });
    }

    const a = `**${author.username}**`;
    const b = `**${target.username}**`;

    switch (sub) {
      case "marry": {
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

        const roll = Math.random();
        const fmt = (s) => s.replace(/\{a\}/g, a).replace(/\{b\}/g, b);

        if (roll < 0.33) return await reply(interaction, 0x57f287, fmt(pick(MARRY_YES)), "marry_yes");
        if (roll < 0.66) return await reply(interaction, 0x57f287, fmt(pick(MARRY_MUTUAL)), "marry_mutual");
        return await reply(interaction, 0xed4245, fmt(pick(MARRY_NO)), "marry_no");
      }

      case "kiss": {
        const text = pick([
          "{a} gave {b} a sweet kiss on the cheek!",
          "{a} kissed {b} on the forehead. Adorable!",
          "{a} and {b} shared a quick smooch.",
          "{a} planted a kiss on {b}'s hand like a true gentleman.",
          "{a} kissed {b} and time stood still for a moment.",
          "{a} gave {b} a surprise kiss! {b} was not expecting that.",
          "A gentle kiss between {a} and {b}. How romantic!"
        ]).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
        return await reply(interaction, 0xeb459e, text, "kiss");
      }

      case "slap": {
        const text = pick([
          "{a} slapped {b} across the face!",
          "{a} backhanded {b} with authority!",
          "Ouch! {a} just slapped {b} into next week!",
          "{a} gave {b} a smack! That's gonna leave a mark.",
          "{a} slapped {b} so hard their WiFi disconnected.",
          "{b} got slapped by {a}. No one saw that coming.",
          "{a} slapped {b}! Everyone in the room went silent."
        ]).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
        return await reply(interaction, 0xed4245, text, "slap");
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
        const fmt = (s) =>
          s.replace(/\{a\}/g, a).replace(/\{b\}/g, b).replace(/\{bystander\}/g, bystander);

        const FIGHT = [
          "{a} and {b} threw hands. {w} won — {bystander} barely dodged the chaos.",
          "An epic battle! {a} and {b} clashed. {w} came out on top, {bystander} watched from the sidelines.",
          "{a} vs {b} — {w} delivered the final blow. {bystander} was the ref.",
          "Street fight! {w} destroyed {loser} while {bystander} sold tickets.",
          "{a} challenged {b} to a duel. {w} won decisively. {bystander} was the judge.",
          "It's a brawl! {w} knocked out {loser}. {bystander} called the medics.",
          "{w} absolutely wrecked {loser} in a fight. {bystander} captured it all on video."
        ];

        if (aRoll === bRoll) {
          return await reply(interaction, 0xfee75c, `It's a tie! ${a} and ${b} both dealt ${aRoll} damage. ${bystander} declared it a draw.`, "fight");
        }

        const winner = aRoll > bRoll ? a : b;
        const loser = aRoll > bRoll ? b : a;
        const color = aRoll > bRoll ? 0x57f287 : 0xed4245;
        const text = fmt(pick(FIGHT).replace(/\{w\}/g, winner).replace(/\{loser\}/g, loser));
        return await reply(interaction, color, text, "fight");
      }

      case "hug": {
        const text = pick([
          `${a} gave ${b} a warm, cozy hug!`,
          `${a} hugged ${b} so tight they couldn't breathe.`,
          `${a} wrapped ${b} in the biggest hug ever!`,
          `${a} gave ${b} a gentle hug. Everything is okay now.`,
          `${b} was hugged by ${a}. Day made.`,
          `${a} surprise-hugged ${b}! No escape!`,
          `A group hug? No, just ${a} hugging ${b} very enthusiastically.`
        ]);
        return await reply(interaction, 0x57f287, text, "hug");
      }

      case "pat": {
        const text = pick([
          `${a} patted ${b} on the head. Good ${b}.`,
          `${a} gave ${b} some head pats. ${b} is now happy.`,
          `${a} patted ${b}. Tail wagging intensifies.`,
          `${a} patted ${b} on the head gently. So precious.`,
          `${b} received head pats from ${a}. Mission accomplished.`,
          `${a} patted ${b} so much they started purring.`,
          `${a} gave ${b} exactly 3 pats. That's the perfect number.`
        ]);
        return await reply(interaction, 0xfee75c, text, "pat");
      }
    }
  }
};
