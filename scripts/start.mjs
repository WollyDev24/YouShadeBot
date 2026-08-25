#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PID_FILE = path.join(__dirname, "..", "bot.pid");

function killOld() {
  if (!fs.existsSync(PID_FILE)) return;
  const oldPid = fs.readFileSync(PID_FILE, "utf-8").trim();
  if (!oldPid) return;
  try {
    process.kill(Number(oldPid), "SIGTERM");
    console.log(`[start] killed old process (pid ${oldPid})`);
    fs.unlinkSync(PID_FILE);
  } catch {
    // process already dead or not ours — ignore
  }
}

function savePid() {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

// --- main ---
killOld();

const child = spawn("node", ["src/index.js"], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  detached: false
});

savePid();

child.on("exit", (code) => {
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGTERM");
});
process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});
