import { SlashCommandBuilder, EmbedBuilder } from "../lib/discord.js";

const SUBREDDITS = ["memes", "dankmemes", "me_irl", "funny"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function fetchMeme(subreddit) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=50&raw_json=1`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "YouShadeBot/1.0 (https://github.com/WollyDev24/YouShadeBot)"
    }
  });

  if (!res.ok) throw new Error(`Reddit returned ${res.status}`);

  const json = await res.json();
  const posts = json?.data?.children ?? [];

  const imagePosts = posts.filter((p) => {
    const d = p.data;
    if (d.stickied || d.is_self || d.over_18 || d.spoiler) return false;
    const url = d.url_overridden_by_dest ?? d.url ?? "";
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(url) || d.post_hint === "image";
  });

  if (!imagePosts.length) throw new Error("No image posts found");

  const post = pick(imagePosts).data;
  const imageUrl = post.url_overridden_by_dest ?? post.url;

  return {
    title: post.title,
    imageUrl,
    author: post.author,
    subreddit: post.subreddit_name_prefixed,
    upvotes: post.ups,
    link: `https://reddit.com${post.permalink}`
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
