#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");

const KEYS = ["TOKEN", "CLIENT_ID", "GUILD_ID", "PANEL_PASSWORD", "PANEL_HOST", "PANEL_PORT"];

function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function readExisting() {
  try {
    return parseEnv(fs.readFileSync(ENV_FILE, "utf8"));
  } catch {
    return {};
  }
}

function looksLikeToken(token) {
  const parts = String(token).split(".");
  return (
    parts.length === 3 &&
    parts[0].length >= 16 &&
    parts[1].length >= 4 &&
    parts[2].length >= 10
  );
}

function clientIdFromToken(token) {
  try {
    const id = Buffer.from(String(token).split(".")[0], "base64url").toString("utf8");
    return /^\d{15,25}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function mask(secret) {
  if (!secret) return "(not set)";
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}${"*".repeat(Math.max(secret.length - 8, 4))}${secret.slice(-4)}`;
}

class OutOfInput extends Error {}

async function main() {
  const isTTY = Boolean(process.stdin.isTTY);
  let rl = null;
  let pipedLines = null;
  let pipedIdx = 0;

  if (isTTY) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  } else {
    pipedLines = fs.readFileSync(0, "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
  }

  const ask = async (prompt) => {
    if (rl) return rl.question(prompt);
    if (pipedIdx >= pipedLines.length) throw new OutOfInput();
    const answer = pipedLines[pipedIdx++];
    process.stdout.write(`${prompt}${answer}\n`);
    return answer;
  };

  const existing = readExisting();
  const values = {};

  console.log("\nYouShade Bot setup");
  console.log("==================");
  if (fs.existsSync(ENV_FILE)) {
    console.log(`Found existing ${ENV_FILE} — press Enter to keep any value.\n`);
  } else {
    console.log(`No .env found — creating ${ENV_FILE}\n`);
  }

  try {
    let token;
    while (true) {
      const hint = existing.TOKEN ? ` (current ${mask(existing.TOKEN)})` : "";
      const answer = (await ask(`Discord bot token${hint}: `)).trim() || existing.TOKEN;
      if (!answer) {
        console.log("  A token is required. Get one at https://discord.com/developers/applications\n");
        continue;
      }
      if (!looksLikeToken(answer)) {
        console.log("  That doesn't look like a bot token (expected three dot-separated parts).\n");
        continue;
      }
      token = answer;
      break;
    }
    values.TOKEN = token;

    const detected = clientIdFromToken(token);
    const clientHint = detected ? `Enter = auto-detected ${detected}` : "";
    while (true) {
      const prev = existing.CLIENT_ID && existing.CLIENT_ID !== detected ? ` (current ${existing.CLIENT_ID})` : "";
      const answer = (await ask(`Application ID ${clientHint}${prev}: `)).trim();
      const chosen = answer || detected || existing.CLIENT_ID;
      if (!chosen || !/^\d{15,25}$/.test(chosen)) {
        console.log("  Application IDs are numeric (17-20 digits).\n");
        continue;
      }
      values.CLIENT_ID = chosen;
      break;
    }

    while (true) {
      const answer =
        (await ask(`Guild ID for instant command registration (blank = global): `)).trim() ||
        existing.GUILD_ID ||
        "";
      if (answer && !/^\d{15,25}$/.test(answer)) {
        console.log("  Guild IDs are numeric (17-20 digits). Enable Developer Mode in Discord, right-click your server > Copy Server ID.\n");
        continue;
      }
      values.GUILD_ID = answer;
      break;
    }

    while (true) {
      const prev = existing.PANEL_PASSWORD ? ` (current ${mask(existing.PANEL_PASSWORD)})` : " (Enter = admin)";
      const answer = (await ask(`Panel password${prev}, or 'r' for random: `)).trim();
      if (answer.toLowerCase() === "r") {
        values.PANEL_PASSWORD = crypto.randomBytes(12).toString("base64url");
        break;
      }
      if (answer) {
        values.PANEL_PASSWORD = answer;
        break;
      }
      if (existing.PANEL_PASSWORD) {
        values.PANEL_PASSWORD = existing.PANEL_PASSWORD;
        break;
      }
      values.PANEL_PASSWORD = "admin";
      break;
    }

    while (true) {
      values.PANEL_HOST =
        (await ask(`Panel host (Enter = 0.0.0.0 = reachable on your local network): `)).trim() ||
        existing.PANEL_HOST ||
        "0.0.0.0";
      break;
    }

    while (true) {
      const answer =
        (await ask(`Panel port (Enter = ${existing.PANEL_PORT || "3000"}): `)).trim() ||
        existing.PANEL_PORT ||
        "3000";
      if (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > 65535) {
        console.log("  Ports are numbers between 1 and 65535.\n");
        continue;
      }
      values.PANEL_PORT = answer;
      break;
    }
  } catch (err) {
    if (err instanceof OutOfInput || err.name === "AbortError" || err.code === "ENOENT") {
      console.log("\nSetup cancelled — not enough input provided.");
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    if (rl) rl.close();
  }

  const lines = [
    "# YouShade Bot configuration (generated by npm run setup)",
    "",
    `TOKEN=${values.TOKEN}`,
    `CLIENT_ID=${values.CLIENT_ID}`
  ];
  if (values.GUILD_ID) lines.push(`GUILD_ID=${values.GUILD_ID}`);
  else lines.push("# GUILD_ID= leave unset to register commands globally (may take up to 1h to appear)");
  lines.push(
    `PANEL_PASSWORD=${values.PANEL_PASSWORD}`,
    `PANEL_HOST=${values.PANEL_HOST}`,
    `PANEL_PORT=${values.PANEL_PORT}`,
    ""
  );

  fs.writeFileSync(ENV_FILE, lines.join("\n"), { mode: 0o600 });

  console.log("\nWrote .env:");
  console.log(`  TOKEN          ${mask(values.TOKEN)}`);
  console.log(`  CLIENT_ID      ${values.CLIENT_ID}`);
  console.log(`  GUILD_ID       ${values.GUILD_ID || "(global registration)"}`);
  console.log(`  PANEL_PASSWORD ${mask(values.PANEL_PASSWORD)}`);
  console.log(`  PANEL_HOST     ${values.PANEL_HOST}`);
  console.log(`  PANEL_PORT     ${values.PANEL_PORT}`);
  console.log(`\nDashboard will be at http://${values.PANEL_HOST}:${values.PANEL_PORT}`);
  if (values.PANEL_HOST === "0.0.0.0" || values.PANEL_HOST === "::") {
    for (const ni of Object.values(os.networkInterfaces()).flat()) {
      if (ni?.family === "IPv4" && !ni.internal) {
        console.log(`From other devices on your network: http://${ni.address}:${values.PANEL_PORT}`);
      }
    }
  }
  console.log("Start the bot with: npm start");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exitCode = 1;
});
