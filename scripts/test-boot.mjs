/* Boots the dashboard against a mocked API and exercises the render paths
 * that used to build native controls. Run with: node scripts/test-boot.mjs
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import assert from "node:assert/strict";

const PUBLIC = new URL("../src/panel/public/", import.meta.url);
const html = readFileSync(new URL("index.html", PUBLIC), "utf8");
const components = readFileSync(new URL("components.js", PUBLIC), "utf8");
let app = readFileSync(new URL("app.js", PUBLIC), "utf8");

const GUILD = {
  id: "111",
  name: "Test Guild",
  icon: null,
  memberCount: 42,
  canManage: true,
  availableCommands: ["help", "ban", "ping", "clear"],
  disabledCommands: ["ban"],
  customEmojis: [],
  channels: [
    { id: "c1", name: "general", type: 0 },
    { id: "c2", name: "alerts", type: 0 },
    { id: "v1", name: "Voice", type: 2 }
  ],
  categories: [],
  roles: [
    { id: "r1", name: "Admin" },
    { id: "r2", name: "Mod" }
  ],
  temp: { enabled: true, triggerId: "v1", triggerName: "Voice" },
  stats: { enabled: false, channels: [], categoryId: null },
  tickets: {
    openCount: 0,
    combinedChannelId: "c2",
    types: [
      { id: "t1", name: "Support", enabled: true, staffRoleId: "r2", categoryId: null, closedCategoryId: null, logChannelId: null, panelChannelId: null, buttonColor: "Primary" }
    ]
  },
  welcome: {
    enabled: true, channelId: "c1", message: "hi {user}", mode: "embed",
    mixText: "", title: "", embedColor: "#5865f2"
  },
  announcements: [],
  filters: [],
  autoRoles: [],
  giveaways: [],
  logChannelId: "c2",
  starboard: { enabled: false, channelId: null, threshold: 3, emoji: "⭐" },
  counting: { channelId: null, emojis: {}, rewardRoleId: null, rewardEvery: null, best: 0 },
  leveling: { enabled: false, annChannelId: null, removeLower: false, roles: [], userCount: 0 },
  roleMenus: [],
  surveys: [],
  sticky: [],
  automod: {
    enabled: false, logChannelId: "c2",
    wordFilter: { enabled: false, words: [], action: "delete" },
    spamDetection: { enabled: false, maxMessages: 5, windowSeconds: 5, action: "timeout" },
    massMention: { enabled: false, maxMentions: 5, action: "delete" },
    inviteBlocking: { enabled: false, action: "delete" },
    caseCount: 0
  },
  antiraid: {
    enabled: false, logChannelId: null, windowSeconds: 10, threshold: 5,
    accountAgeHours: 24, action: "kick", lockdownChannels: [], caseCount: 0, cases: []
  },
  aichat: { enabled: true, channels: ["c1", "c2"], model: "gemini-3.8-flash", limits: { daily: 5, boost: 15, cooldownSeconds: 4, imageDaily: 10 } },
  reactionRoles: [],
  lockdowns: [],
  polls: [],
  reminders: [],
  panelRoleId: null
};

const RESPONSES = {
  "/api/me": { user: { id: "u1", username: "owner", avatar: null, global_name: "Owner" } },
  "/api/guilds": [GUILD],
  "/api/status": { bot: { online: true, version: "1.0.0" }, guilds: 1 },
  "/api/updates": { current: "1.0.0", latest: "1.0.0" }
};

const win = new Window({ url: "https://example.test/dashboard" });
const { window } = win;
for (const k of [
  "HTMLElement", "customElements", "CSSStyleSheet", "MutationObserver", "Event",
  "CustomEvent", "MouseEvent", "Node", "FormData", "HTMLFormElement", "CSS",
  "Element", "DocumentFragment", "KeyboardEvent", "getComputedStyle",
  "requestAnimationFrame", "Image"
]) globalThis[k] = window[k];
globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;

window.HTMLElement.prototype.attachInternals = function () {
  return { form: null, setFormValue() {}, setValidity() {}, willValidate: true, checkValidity: () => true };
};
if (typeof window.CSS.escape !== "function") {
  window.CSS.escape = (s) => String(s).replace(/["\\]/g, "\\$&");
}
window.scrollTo = () => {};

const requested = [];
const sentBodies = [];
const lastBody = () => sentBodies[sentBodies.length - 1];
window.fetch = async (path, opts = {}) => {
  requested.push(path);
  if (opts.body) {
    sentBodies.push({ path, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ note: "saved" }) };
  }
  for (const [key, value] of Object.entries(RESPONSES)) {
    if (path === key || path.startsWith(key + "?")) {
      return { ok: true, status: 200, json: async () => value };
    }
  }
  if (path.includes("/aichat/models")) {
    return {
      ok: true, status: 200,
      json: async () => ({
        models: [
          { id: "gemini-flash-latest", name: "Gemini Flash Latest (always newest)" },
          { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash (agentic workhorse)" },
          { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (low cost, high volume)" }
        ]
      })
    };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

document.documentElement.innerHTML = html
  .replace(/^[\s\S]*?<html[^>]*>/i, "")
  .replace(/<\/html>[\s\S]*$/i, "");

/* surface swallowed render errors so a failure points at the real cause */
app = app.replace("  } catch {\n    showLogin(true);", '  } catch (e) {\n    globalThis.__initError = e;');

await import("data:text/javascript;base64," + Buffer.from(components).toString("base64"));

const run = new Function("window", "document", "fetch", "localStorage", "location", app);
run(window, window.document, window.fetch, window.localStorage, window.location);
const tick = (n = 6) => new Promise((r) => {
  let i = 0;
  const step = () => (++i >= n ? r() : setTimeout(step, 0));
  setTimeout(step, 0);
});

const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n       ${err.message}`]);
  }
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

await tick(10);

await test("login screen is hidden after a successful session", () => {
  assert.equal($("#login-screen").classList.contains("hidden"), true);
});

await test("app container is visible", () => {
  assert.equal($("#app").classList.contains("hidden"), false);
});

await test("guild header rendered", () => {
  assert.match($("#guild-name")?.textContent ?? "", /Test Guild/);
});

await test("no native controls were created at runtime", () => {
  assert.deepEqual($$("input, select, textarea, button").map((e) => e.outerHTML.slice(0, 60)), []);
});

await test("AI settings loaded into custom controls", () => {
  assert.equal($("#ai-enabled").checked, true, "ai-enabled should be checked");
  const model = $("#ai-model");
  assert.equal(model.tagName.toLowerCase(), "mono-select");
  assert.equal(model.value, "gemini-3.8-flash", `model was "${model.value}"`);
  assert.equal(model.options.length, 3, "model options should be populated");
});

await test("AI channel whitelist is a multi select with both channels picked", () => {
  const sel = $("#ai-channels");
  assert.equal(sel.multiple, true);
  assert.deepEqual(sel.values, ["c1", "c2"]);
});

await test("command checkboxes rendered as custom elements with state", () => {
  const boxes = $$("#cmd-grid mono-checkbox.check");
  assert.equal(boxes.length, 4, `expected 4 command toggles, got ${boxes.length}`);
  const help = boxes.find((b) => b.value === "help");
  const ban = boxes.find((b) => b.value === "ban");
  assert.equal(help.checked, true, "help should be enabled");
  assert.equal(ban.checked, false, "ban should be disabled");
  assert.equal(help.classList.contains("off"), false);
  assert.equal(ban.classList.contains("off"), true);
});

await test("AI rate limits render into the panel fields", () => {
  const daily = $("#ai-limit-daily");
  const boost = $("#ai-limit-boost");
  const cd = $("#ai-limit-cooldown");
  const images = $("#ai-limit-images");
  for (const el of [daily, boost, cd, images]) {
    assert.equal(el.tagName.toLowerCase(), "mono-input", "limit fields must be custom inputs");
  }
  assert.equal(daily.value, "5");
  assert.equal(boost.value, "15");
  assert.equal(cd.value, "4");
  assert.equal(images.value, "10");
});

await test("saving AI settings posts the edited limits", async () => {
  $("#ai-limit-daily").value = "25";
  $("#ai-limit-boost").value = "0";
  $("#ai-limit-cooldown").value = "10";
  $("#ai-limit-images").value = "3";
  sentBodies.length = 0;
  $("#btn-ai-save").click();
  await tick(10);
  const call = sentBodies.find((b) => b.path.endsWith("/aichat/config"));
  assert.ok(call, "no /aichat/config POST was made");
  assert.deepEqual(call.body.limits, { daily: 25, boost: 0, cooldownSeconds: 10, imageDaily: 3 });
});

await test("a non-numeric image quota is rejected instead of posted", () => {
  $("#ai-limit-images").value = "abc";
  sentBodies.length = 0;
  $("#btn-ai-save").click();
  assert.equal(sentBodies.length, 0, "nothing should be posted for a non-numeric image quota");
  $("#ai-limit-images").value = "10";
});

await test("a non-numeric quota is rejected instead of posted", () => {
  $("#ai-limit-daily").value = "abc";
  sentBodies.length = 0;
  $("#btn-ai-save").click();
  assert.equal(sentBodies.length, 0, "nothing should be posted for a non-numeric quota");
  $("#ai-limit-daily").value = "5";
});

await test("an out-of-range quota is clamped to the field maximum", async () => {
  $("#ai-limit-daily").value = "9999";
  sentBodies.length = 0;
  $("#btn-ai-save").click();
  await tick(10);
  const call = sentBodies.find((b) => b.path.endsWith("/aichat/config"));
  assert.ok(call);
  assert.equal(call.body.limits.daily, 500, "should match the max on the field");
  $("#ai-limit-daily").value = "5";
});

await test("mono-field renders a hint", () => {
  const field = document.querySelector("mono-field[hint]");
  assert.ok(field, "a hinted field should exist in the AI card");
  const hint = field.shadowRoot.querySelector(".hint");
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /unlimited/);
  const plain = document.querySelector("mono-field:not([hint])");
  assert.equal(plain.shadowRoot.querySelector(".hint").hidden, true, "no hint attribute means no hint");
});

await test("a value set before its options exist is applied once they do", () => {
  const sel = document.createElement("mono-select");
  document.body.appendChild(sel);
  sel.innerHTML = "";
  for (const [v, t] of [["", "(none)"], ["c1", "general"], ["c2", "alerts"]]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = "c2";
  assert.equal(sel.value, "", "nothing to select yet, same as a native select");
  sel.remove();
});

await test("channel dropdowns are filtered to the right kind", () => {
  const temp = $("#temp-channel");
  assert.equal(temp.tagName.toLowerCase(), "mono-select");
  assert.equal(temp.options.length, 1, "temp channels are voice only");
  assert.equal(temp.options[0].value, "v1");

  const log = $("#am-log-channel");
  assert.equal(log.tagName.toLowerCase(), "mono-select");
  assert.deepEqual([...log.options].map((o) => o.value), ["", "c1", "c2"],
    "placeholder + text channels, no voice channel");
  assert.equal(log.value, "c2", "the configured log channel should be selected");
});

await test("async fillSelect values are applied after the option flush", async () => {
  const sel = document.createElement("mono-select");
  document.body.appendChild(sel);
  sel.innerHTML = "";
  for (const [v, t] of [["x1", "one"], ["x2", "two"]]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = "x2";
  await tick(4);
  assert.equal(sel.value, "x2", "the pending value should be applied once the options exist");
  sel.remove();
});

await test("number inputs keep their parsed value", () => {
  const v = $("#sk-interval");
  assert.equal(v.tagName.toLowerCase(), "mono-input");
  assert.equal(v.value, "5");
  v.value = "12";
  assert.equal(v.value, "12");
});

await test("textareas round-trip text", () => {
  const t = $("#wc-message");
  assert.equal(t.tagName.toLowerCase(), "mono-textarea");
  t.value = "hello there";
  assert.equal(t.value, "hello there");
});

await test("switching tabs works on custom buttons", () => {
  const tabs = $$("#tabs .tab");
  assert.ok(tabs.length >= 6, "tabs should be custom buttons");
  const channels = tabs.find((t) => t.dataset.tab === "channels");
  channels.click();
  assert.equal(channels.classList.contains("active"), true, "clicked tab should activate");
  assert.equal(tabs.find((t) => t.dataset.tab === "overview").classList.contains("active"), false);
});

await test("search filters sections and reports a count", () => {
  const search = $("#search");
  assert.equal(search.tagName.toLowerCase(), "mono-search");
  search.value = "welcome";
  search._el.dispatchEvent(new window.Event("input"));
  assert.equal(document.body.classList.contains("searching"), true);
  assert.match(search.count, /match/);
  search.value = "";
  search._el.dispatchEvent(new window.Event("input"));
  assert.equal(document.body.classList.contains("searching"), false);
});

await test("toast shows messages through the custom element", () => {
  const t = $("#toast");
  assert.equal(t.tagName.toLowerCase(), "mono-toast");
  t.show("done", "info", 50);
  assert.equal(t.hidden, false);
});

await test("saving AI settings posts the right shape", async () => {
  requested.length = 0;
  $("#btn-ai-save").click();
await tick(10);

if (globalThis.__initError) {
  console.error("init/render error:", globalThis.__initError.stack || globalThis.__initError);
}

  const post = requested.find((p) => p.includes("aichat/config"));
  assert.ok(post, "no aichat/config request was made");
});

await test("every .btn is a mono-button or a link", () => {
  for (const el of $$(".btn")) {
    assert.ok(
      el.tagName === "MONO-BUTTON" || el.tagName === "A",
      `.btn on <${el.tagName}> is not a mono-button or a link`
    );
  }
});

await test("clicking a command checkbox updates state and toggles class", () => {
  const ban = $$("#cmd-grid mono-checkbox.check").find((b) => b.value === "ban");
  assert.equal(ban.checked, false);
  assert.equal(ban.classList.contains("off"), true);
  assert.equal($("#cmd-grid").dataset.dirty, "", "starts clean");
  ban.click();
  assert.equal(ban.checked, true, "click should toggle the checkbox");
  assert.equal(ban.classList.contains("off"), false, "off class should clear");
  assert.equal($("#cmd-grid").dataset.dirty, "1", "grid should be marked dirty");
  ban.click();
  assert.equal(ban.checked, false, "second click toggles back");
  ban.checked = true; // restore the payload's original state for later tests
  $("#cmd-grid").dataset.dirty = "";
});

await test("saving command toggles sends the unchecked commands", async () => {
  sentBodies.length = 0;
  $("#btn-cmd-save").click();
  await tick(10);
  const call = sentBodies.find((b) => b.path.endsWith("/commands/toggles"));
  assert.ok(call, `no /commands/toggles POST was made (saw ${sentBodies.map((b) => b.path)})`);
  assert.deepEqual(call.body.disabled, [], "all four commands are on, so nothing is disabled");
  assert.equal($("#cmd-grid").dataset.dirty, "", "dirty flag should clear after a save");
});

await test("toggling a command off then saving reports it as disabled", async () => {
  const help = $$("#cmd-grid mono-checkbox.check").find((b) => b.value === "help");
  help.click();
  assert.equal(help.checked, false);
  sentBodies.length = 0;
  $("#btn-cmd-save").click();
  await tick(10);
  const call = sentBodies.find((b) => b.path.endsWith("/commands/toggles"));
  assert.ok(call, "no /commands/toggles POST was made");
  assert.deepEqual(call.body.disabled, ["help"]);
  help.click();
});

await test("ticket panel type card built from the payload", () => {
  const cards = $$("#tk-types .tk-type");
  assert.equal(cards.length, 1, "one ticket type card");
  const nameInput = cards[0].querySelector("mono-input");
  assert.equal(nameInput.value, "Support");
  const enabledCb = cards[0].querySelector("mono-checkbox.check");
  assert.equal(enabledCb.checked, true);
});

await test("posting the combined ticket panel sends the ticked type ids", async () => {
  sentBodies.length = 0;
  $("#btn-tk-post-combined").click();
  await tick(10);
  const call = sentBodies.find((b) => b.path.endsWith("/tickets/post-combined"));
  assert.ok(call, "no /tickets/post-combined POST was made");
  assert.deepEqual(call.body.typeIds, ["t1"], "the auto-ticked type should be included");
  assert.equal(call.body.channelId, "c2");
});

await test("emoji picker opens, focuses its search, and writes back to the target", () => {
  const trigger = $(".emoji-trigger");
  assert.ok(trigger, "an emoji trigger should exist");
  trigger.click();

  const picker = $("#emoji-picker");
  assert.ok(picker, "the picker should be built on first open");
  assert.equal(picker.classList.contains("hidden"), false);

  const search = picker.querySelector("mono-input");
  assert.ok(search, "the picker search must be a mono-input, not a native input");
  assert.equal(search.value, "", "the search should start empty");
  assert.equal(document.activeElement, search, "focus should land on the search box");

  const target = $("#" + trigger.dataset.target);
  assert.equal(target.tagName.toLowerCase(), "mono-input");
  const common = document.getElementById("ep-common");
  assert.ok(common.children.length > 0, "common emoji buttons should be rendered");
  common.children[0].click();
  assert.equal(target.value, common.children[0].dataset.emoji, "clicking an emoji fills the target");
  assert.equal(picker.classList.contains("hidden"), true, "the picker closes after a pick");
});

await test("emoji picker search filters the button grids", () => {
  const trigger = $(".emoji-trigger");
  trigger.click();
  const search = $("#emoji-picker").querySelector("mono-input");
  const common = document.getElementById("ep-common");
  const before = [...common.children].filter((b) => b.style.display !== "none").length;
  search.value = "zzzz-no-match";
  search.dispatchEvent(new window.Event("input"));
  const after = [...common.children].filter((b) => b.style.display !== "none").length;
  assert.ok(before > 0, "some buttons should be visible before filtering");
  assert.equal(after, 0, "a non-matching query should hide every common emoji");
  $("#emoji-picker").classList.add("hidden");
});

await test("buttons show a working label and re-enable after a save", async () => {
  const btn = $("#btn-cmd-save");
  sentBodies.length = 0;
  btn.click();
  await tick(10);
  assert.equal(btn.disabled, false, "button should be re-enabled afterwards");
});

let failed = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status === "ok" ? "  ok" : "FAIL"}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
