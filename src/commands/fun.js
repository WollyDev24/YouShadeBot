import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function rng(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const GIFS = {
  marry_yes: [
    "https://media.tenor.com/nQxYKfNKM-0AAAAM/wedding-rings.gif",
    "https://media.tenor.com/pMbGhfCTUj8AAAAM/rings-wedding.gif",
    "https://media.tenor.com/iXvHMqhMB-8AAAAM/get-married-wedding.gif"
  ],
  marry_no: [
    "https://media.tenor.com/WKiKE7yB1bYAAAAM/sad-walking-away.gif",
    "https://media.tenor.com/M3aWmJWEy-YAAAAM/no-nope.gif",
    "https://media.tenor.com/JCpovA2J6LsAAAAM/oh-no-really.gif"
  ],
  marry_mutual: [
    "https://media.tenor.com/nQxYKfNKM-0AAAAM/wedding-rings.gif",
    "https://media.tenor.com/MHn3Zk0Wq-0AAAAM/love-hearts.gif",
    "https://media.tenor.com/6F-7gD-s0nQAAAAM/engagement-proposal.gif"
  ],
  kiss: [
    "https://media.tenor.com/5yaGwqxM0T0AAAAM/kiss-love.gif",
    "https://media.tenor.com/1KJPpWmMKcgAAAAM/kissing-kiss.gif",
    "https://media.tenor.com/5yaGwqxM0T0AAAAM/kiss.gif",
    "https://media.tenor.com/Mj1kzbH1hn0AAAAM/kiss-heart.gif"
  ],
  slap: [
    "https://media.tenor.com/M5HgEhrtsGcAAAAM/slap.gif",
    "https://media.tenor.com/VIXxELDOnmsAAAAM/slap-in-the-face.gif",
    "https://media.tenor.com/e8kMYZqLnhgAAAAM/slap-hit.gif"
  ],
  fight: [
    "https://media.tenor.com/Vt4bQ5M7gLwAAAAM/fight-brawl.gif",
    "https://media.tenor.com/jFHuMEUjWmsAAAAM/fight-punch.gif",
    "https://media.tenor.com/uPlfVNDnb2kAAAAM/fight-punching.gif"
  ],
  hug: [
    "https://media.tenor.com/JF0c9j9x8qgAAAAM/hug-cuddle.gif",
    "https://media.tenor.com/rAY1pG4cUx0AAAAM/hug-hugging.gif",
    "https://media.tenor.com/qNjUF80_Vq4AAAAM/hug-cute.gif"
  ],
  pat: [
    "https://media.tenor.com/QFe_LzgV4N0AAAAM/pat-pat-pat.gif",
    "https://media.tenor.com/9wC4YEeI8-0AAAAM/pat-head-pat.gif",
    "https://media.tenor.com/fggXFMOIyYcAAAAM/pat-pet.gif"
  ]
};

function gif(category) {
  return pick(GIFS[category]);
}

function reply(interaction, color, description, gifCategory) {
  const embed = new EmbedBuilder().setColor(color).setDescription(description).setImage(gif(gifCategory));
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

        if (roll < 0.33) return reply(interaction, 0x57f287, fmt(pick(MARRY_YES)), "marry_yes");
        if (roll < 0.66) return reply(interaction, 0x57f287, fmt(pick(MARRY_MUTUAL)), "marry_mutual");
        return reply(interaction, 0xed4245, fmt(pick(MARRY_NO)), "marry_no");
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
        return reply(interaction, 0xeb459e, text, "kiss");
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
        return reply(interaction, 0xed4245, text, "slap");
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
          return reply(interaction, 0xfee75c, `It's a tie! ${a} and ${b} both dealt ${aRoll} damage. ${bystander} declared it a draw.`, "fight");
        }

        const winner = aRoll > bRoll ? a : b;
        const loser = aRoll > bRoll ? b : a;
        const color = aRoll > bRoll ? 0x57f287 : 0xed4245;
        const text = fmt(pick(FIGHT).replace(/\{w\}/g, winner).replace(/\{loser\}/g, loser));
        return reply(interaction, color, text, "fight");
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
        return reply(interaction, 0x57f287, text, "hug");
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
        return reply(interaction, 0xfee75c, text, "pat");
      }
    }
  }
};
