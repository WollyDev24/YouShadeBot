import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "store.json");

const DEFAULTS = {
  temp: {},
  stats: {},
  counting: {},
  tickets: {},
  welcome: {},
  announcements: {},
  commands: {},
  autores: {}
};

let store;

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(FILE, "utf-8");
    store = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    store = structuredClone(DEFAULTS);
  }
}

export function getData() {
  if (!store) load();
  return store;
}

export function save() {
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}
