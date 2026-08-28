import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "store.db");
const OLD_FILE = path.join(DATA_DIR, "store.json");

const DEFAULTS = {
  temp: {},
  stats: {},
  counting: {},
  tickets: {},
  welcome: {},
  announcements: {},
  commands: {},
  autores: {},
  autoroles: {},
  giveaways: {},
  logs: {},
  starboard: {},
  panel: {},
  surveys: {},
  sticky: {},
  automod: {},
  reactionRoles: {},
  lockdowns: {},
  polls: {},
  reminders: {}
};

let store;
let db;
const dirty = new Set();
let flushTimer = null;
const FLUSH_DELAY = 100;

function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID
  `);

  const rows = db.prepare("SELECT key, value FROM kv").all();
  store = { ...structuredClone(DEFAULTS) };
  for (const row of rows) {
    try {
      store[row.key] = JSON.parse(row.value);
    } catch {}
  }

  if (Object.keys(rows).length === 0 && fs.existsSync(OLD_FILE)) {
    try {
      const raw = fs.readFileSync(OLD_FILE, "utf-8");
      const old = JSON.parse(raw);
      const insert = db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
      const migrate = db.transaction(() => {
        for (const [key, value] of Object.entries(old)) {
          if (key in DEFAULTS) {
            store[key] = value;
            insert.run(key, JSON.stringify(value));
          }
        }
      });
      migrate();
      fs.renameSync(OLD_FILE, OLD_FILE + ".bak");
      console.log("[db] migrated store.json → store.db");
    } catch {}
  }
}

export function getData() {
  if (!store) initDb();
  return store;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_DELAY);
}

function flushNow() {
  if (!dirty.size || !db) return;
  const keys = [...dirty].filter((k) => typeof k === "string" && k.length > 0);
  dirty.clear();
  const upsert = db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
  const batch = db.transaction(() => {
    for (const key of keys) {
      const raw = JSON.stringify(store[key]);
      if (typeof raw !== "string") continue;
      upsert.run(key, raw);
    }
  });
  batch();
}

export function save() {
  getData();
  for (const key of Object.keys(DEFAULTS)) {
    dirty.add(key);
  }
  scheduleFlush();
}

export function saveKey(key) {
  getData();
  if (typeof key !== "string" || !key) {
    console.error("[db] saveKey called with invalid key:", key, "\n", new Error().stack);
    return;
  }
  dirty.add(key);
  scheduleFlush();
}

export function flush() {
  flushNow();
}

process.on("exit", flush);
process.on("SIGINT", () => { flush(); process.exit(); });
process.on("SIGTERM", () => { flush(); process.exit(); });
