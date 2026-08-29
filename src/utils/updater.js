import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getData, saveKey } from "./db.js";

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK_INTERVAL = 60 * 60 * 1000;

let busy = false;

export function getLogChannel(guildId) {
  return getData().logs[guildId] ?? null;
}

export function setLogChannel(guildId, channelId) {
  if (!channelId) {
    delete getData().logs[guildId];
  } else {
    getData().logs[guildId] = String(channelId);
  }
  saveKey("logs");
}

async function notifyLogChannels(client, message) {
  const data = getData();
  for (const guildId of Object.keys(data.logs ?? {})) {
    const channelId = data.logs[guildId];
    if (!channelId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased()) await channel.send(message);
    } catch (err) {
      console.error(`[updater] couldn't notify channel ${channelId}:`, err.message);
    }
  }
}

async function git(...args) {
  return (await run("git", args, { cwd: ROOT })).stdout.trim();
}

export async function checkForUpdates(client) {
  if (busy) return { status: "busy" };
  busy = true;
  try {
    const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
    if ((await git("status", "--porcelain", "--untracked-files=no")).length > 0) {
      return { status: "dirty" };
    }

    await git("fetch", "origin", branch);
    const local = await git("rev-parse", "HEAD");
    const remote = await git("rev-parse", `origin/${branch}`);
    if (local === remote) {
      return { status: "up-to-date", sha: local.slice(0, 7) };
    }

    const changelog = await git("log", "--oneline", `${local}..${remote}`);
    const base = await git("merge-base", local, remote).catch(() => null);
    if (base !== local) {
      await notifyLogChannels(
        client,
        `Auto-update skipped: local history diverged from origin/${branch}. Manual intervention needed.`
      );
      return { status: "diverged" };
    }

    const count = changelog.split("\n").length;
    await notifyLogChannels(
      client,
      `Found **${count}** new commit(s), pulling and restarting:\n\`\`\`\n${changelog}\n\`\`\``
    );

    await git("pull", "--ff-only", "origin", branch);

    const changed = await git("diff", "--name-only", local, remote);
    if (changed.includes("package.json") || changed.includes("package-lock.json")) {
      await notifyLogChannels(client, "Dependencies changed — running `npm ci`…");
      await run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: ROOT });
    }

    spawn(
      "bash",
      ["-c", `sleep 3; cd '${ROOT}' && setsid nohup npm start >> bot.log 2>&1`],
      { detached: true, stdio: "ignore" }
    ).unref();
    setTimeout(() => process.exit(0), 3000);

    return { status: "updating", commits: count };
  } catch (err) {
    console.error("[updater] failed:", err.message);
    try {
      await notifyLogChannels(client, `Auto-update failed: \`${err.message}\``);
    } catch {}
    return { status: "error", error: err.message };
  } finally {
    busy = false;
  }
}

export function startAutoUpdate(client) {
  console.log("[updater] hourly update checks enabled");
  setInterval(() => {
    checkForUpdates(client).then((r) => {
      if (r.status === "updating") console.log("[updater] updating and restarting…");
    });
  }, CHECK_INTERVAL);
}
