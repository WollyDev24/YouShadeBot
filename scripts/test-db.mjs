#!/usr/bin/env node
/* Tests for the persistence layer.
 *
 * src/utils/db.js opens its SQLite file on import and caches it in a module
 * level singleton, so anything checking what actually survived a restart has to
 * run in a fresh process. Each check here therefore runs a short child against
 * a throwaway data directory.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* Runs `body` in a child process with its own data directory, so every check
 * starts from a clean store and the real one is never reachable. Returns both
 * streams: some checks assert on what db.js logged. */
function runInChild(dir, body) {
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", body], {
    cwd: REPO,
    env: { ...process.env, MONOLITH_DATA_DIR: dir },
    encoding: "utf8"
  });
  if (res.status !== 0) {
    throw new Error(`child exited ${res.status}\n${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  }
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/* Reads the raw key/value rows, the way SQLite holds them, so a test can see
 * what survived regardless of what db.js does when loading it. */
const readKv = (dir) => {
  const { stdout } = runInChild(
    dir,
    `import Database from "better-sqlite3";
     const d = new Database(${JSON.stringify(path.join(dir, "store.db"))}, { readonly: true });
     let out = "{}";
     try {
       const rows = d.prepare("SELECT key, value FROM kv").all();
       out = JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, r.value])));
     } catch {}
     console.log(out);
     d.close();`
  );
  const parsed = JSON.parse(stdout.trim().split("\n").at(-1));
  const out = {};
  for (const [key, raw] of Object.entries(parsed)) {
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = undefined;
    }
  }
  return out;
};

/* Reads what db.js itself sees after loading the store. */
const readLoaded = (dir) => {
  const { stdout } = runInChild(
    dir,
    `const { getData } = await import("./src/utils/db.js");
     console.log(JSON.stringify(getData()));`
  );
  return JSON.parse(stdout.trim().split("\n").at(-1));
};

test("a fresh store exposes every declared default", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    const { stdout } = runInChild(
      dir,
      `const { getData } = await import("./src/utils/db.js");
       console.log(JSON.stringify(Object.keys(getData()).sort()));`
    );
    const keys = JSON.parse(stdout.trim().split("\n").at(-1));
    for (const expected of ["aichat", "aimemory", "aiconv", "antiraid", "tickets", "leveling"]) {
      assert.ok(keys.includes(expected), `missing default store "${expected}"`);
    }
    assert.ok(keys.includes("aiconv"), "conversation memory store should be declared");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a written value survives a restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    runInChild(
      dir,
      `const { getData, saveKey, flush } = await import("./src/utils/db.js");
       getData().aichat["guild-1"] = { enabled: true, model: "gemini-3.6-flash" };
       saveKey("aichat");
       flush();`
    );
    const kv = readKv(dir);
    assert.deepEqual(kv.aichat["guild-1"], { enabled: true, model: "gemini-3.6-flash" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting one guild entry inside a store is persisted", () => {
  /* Guards the nested case: dropping a key from a store object that still has
   * other keys. This one always worked, because the surviving object still
   * stringifies. The regression is the whole-store case below. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    runInChild(
      dir,
      `const { getData, saveKey, flush } = await import("./src/utils/db.js");
       getData().aiconv["chan-1"] = { summary: ["alice: do not resurrect me"], updatedAt: "2026-01-01T00:00:00.000Z" };
       saveKey("aiconv");
       flush();`
    );
    assert.equal(readKv(dir).aiconv["chan-1"].summary.length, 1, "setup should have persisted");

    runInChild(
      dir,
      `const { getData, saveKey, flush } = await import("./src/utils/db.js");
       delete getData().aiconv["chan-1"];
       saveKey("aiconv");
       flush();`
    );

    const kv = readKv(dir);
    assert.equal(
      kv.aiconv?.["chan-1"],
      undefined,
      "the deleted entry came back from SQLite, the stale row survived the flush"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dropping a whole store restores its default shape instead of corrupting it", () => {
  /* The actual regression. flushNow did JSON.stringify(store[key]) and skipped
   * the write when that came back undefined, which is exactly what happens once
   * the last key of a store is deleted. SQLite kept the old row, so the data
   * came back on the next boot and the delete looked like it had worked. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    runInChild(
      dir,
      `const { getData, saveKey, flush } = await import("./src/utils/db.js");
       getData().aimemory = { "guild-9": { "a": { value: "x" } } };
       saveKey("aimemory");
       flush();`
    );
    assert.ok(readKv(dir).aimemory["guild-9"], "setup should have persisted");

    runInChild(
      dir,
      `const { getData, saveKey, flush } = await import("./src/utils/db.js");
       delete getData().aimemory;
       saveKey("aimemory");
       flush();`
    );

    const kv = readKv(dir);
    assert.deepEqual(kv.aimemory, {}, "should fall back to the declared default, not stay deleted or stale");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveKey refuses an undeclared key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    const { stderr } = runInChild(
      dir,
      `const { getData, saveKey, flush } = await import("./src/utils/db.js");
       getData().totallyMadeUp = { junk: true };
       saveKey("totallyMadeUp");
       flush();`
    );
    const keys = readKv(dir);
    assert.equal(keys.totallyMadeUp, undefined, "an undeclared key must not be written to SQLite");
    assert.match(stderr, /undeclared key/, "a typo'd key should be reported loudly");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("save persists every store at once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    runInChild(
      dir,
      `const { getData, save, flush } = await import("./src/utils/db.js");
       const d = getData();
       d.antiraid["g"] = { enabled: false };
       d.aimemory["g"] = { k: { value: "v" } };
       d.aiconv["c"] = { summary: ["bob: hello"] };
       save();
       flush();`
    );
    const kv = readKv(dir);
    assert.ok(kv.antiraid.g, "antiraid should be saved");
    assert.ok(kv.aimemory.g, "aimemory should be saved");
    assert.equal(kv.aiconv.c.summary[0], "bob: hello", "aiconv should be saved");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable row is skipped without taking the store down", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    runInChild(
      dir,
      `import Database from "better-sqlite3";
       const d = new Database(${JSON.stringify(path.join(dir, "store.db"))});
       d.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
       d.prepare("INSERT OR REPLACE INTO kv VALUES (?, ?)").run("aichat", "{not json");
       d.prepare("INSERT OR REPLACE INTO kv VALUES (?, ?)").run("aiconv", JSON.stringify({ c: { summary: ["x"] } }));
       d.close();`
    );
    const loaded = readLoaded(dir);
    assert.deepEqual(loaded.aiconv, { c: { summary: ["x"] } }, "valid rows still load");
    assert.deepEqual(loaded.aichat, {}, "the corrupt row should have been skipped, not crash the load");
    assert.deepEqual(loaded.tickets, {}, "and the remaining defaults should still be present");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the test data directory is isolated from the live store", () => {
  const live = path.join(REPO, "src", "data", "store.db");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-db-"));
  try {
    runInChild(
      dir,
      `const { getData, saveKey, flush } = await import("./src/utils/db.js");
       getData().antiraid["leak-check"] = { enabled: true };
       saveKey("antiraid");
       flush();`
    );
    const kv = readKv(dir);
    assert.ok(kv.antiraid["leak-check"], "the write should land in the temp dir");
    assert.ok(fs.existsSync(live), "the live store should be left in place");
    assert.equal(
      readKv(path.dirname(live)).antiraid?.["leak-check"],
      undefined,
      "nothing may leak into the live store"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const results = [];
for (const [name, fn] of tests) {
  try {
    await fn();
    results.push(`  ok  ${name}`);
  } catch (err) {
    results.push(`FAIL  ${name}\n      ${String(err.message).split("\n").join("\n      ")}`);
  }
}

const failures = results.filter((r) => r.startsWith("FAIL")).length;
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} passed`);
if (failures) process.exit(1);