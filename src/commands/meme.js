import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

const SUBREDDITS = ["memes", "dankmemes", "me_irl", "funny"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function fetchMeme(subreddit) {
  const url = `https://meme-api.com/gimme/${encodeURIComponent(subreddit)}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "YouShadeBot/1.1 (https://github.com/WollyDev24/YouShadeBot)"
    }
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);

  const data = await res.json();
  if (!data.url) throw new Error("No meme found");

  return {
    title: data.title ?? "No title",
    imageUrl: data.url,
    author: data.author ?? "unknown",
    subreddit: data.subreddit ? `r/${data.subreddit}` : `r/${subreddit}`,
    upvotes: data.ups ?? 0,
    link: data.postLink ?? "#"
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName("meme")
    .setDescription("Get a random meme from Reddit")
    .addStringOption((o) =>
      o
        .setName("subreddit")
        .setDescription("Subreddit to fetch from (default: random)")
        .setMaxLength(50)
    ),

  async execute(client, interaction) {
    const subInput = interaction.options.getString("subreddit");
    const subreddit = subInput ? subInput.replace(/^r\//, "") : pick(SUBREDDITS);

    await interaction.deferReply();

    try {
      const meme = await fetchMeme(subreddit);

      const embed = new EmbedBuilder()
        .setTitle(meme.title.length > 256 ? meme.title.slice(0, 253) + "..." : meme.title)
        .setImage(meme.imageUrl)
        .setColor(0xff4500)
        .setFooter({ text: `${meme.subreddit} · 👍 ${meme.upvotes.toLocaleString()} · u/${meme.author}` })
        .setURL(meme.link);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({
        content: `\u274C Couldn't fetch a meme from r/${subreddit}: ${err.message}`
      });
    }
  }
};
