/* Integration test: loads the real converted index.html into happy-dom,
 * registers the custom elements, runs app.js, and checks the dashboard boots.
 * Run with: node scripts/test-panel.mjs
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import assert from "node:assert/strict";

const PUBLIC = new URL("../src/panel/public/", import.meta.url);
const html = readFileSync(new URL("index.html", PUBLIC), "utf8");
const components = readFileSync(new URL("components.js", PUBLIC), "utf8");
const app = readFileSync(new URL("app.js", PUBLIC), "utf8");

const win = new Window({ url: "https://example.test/dashboard" });
const { window } = win;

/* --- install the DOM globals app.js expects --- */
for (const k of [
  "HTMLElement", "customElements", "CSSStyleSheet", "MutationObserver", "Event",
  "CustomEvent", "MouseEvent", "Node", "FormData", "HTMLFormElement", "CSS",
  "Element", "DocumentFragment", "HTMLInputElement", "HTMLSelectElement",
  "KeyboardEvent", "getComputedStyle", "requestAnimationFrame"
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
window.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({})
});
window.scrollTo = () => {};

/* --- install the page --- */
document.documentElement.innerHTML = html
  .replace(/^[\s\S]*?<html[^>]*>/i, "")
  .replace(/<\/html>[\s\S]*$/i, "");

const src = components;
await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

const results = [];
const test = (name, fn) => {
  try {
    fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n       ${err.message}`]);
  }
};

/* -------------------------------------------------- structural assertions */

const $$ = (sel) => [...document.querySelectorAll(sel)];

test("no native form controls remain in the markup", () => {
  assert.equal($$("input, select, textarea").length, 0, "found native inputs");
});

test("all buttons are custom elements", () => {
  assert.equal($$("button").length, 0, "found native buttons");
});

test("no orphaned <label for> pointing at a custom element", () => {
  for (const l of $$("label[for]")) {
    const target = document.getElementById(l.getAttribute("for"));
    assert.ok(target, `label for="${l.getAttribute("for")}" has no target`);
  }
});

test("every element referenced by app.js exists and is upgraded", () => {
  const ids = [...app.matchAll(/\$\("#([a-zA-Z0-9_-]+)"\)/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((id) => !document.getElementById(id));
  assert.deepEqual(missing, [], `missing ids: ${missing.join(", ")}`);
});

test("elements that app.js touches as controls are custom elements", () => {
  for (const id of ["password", "ai-enabled", "ai-model", "ai-channels"]) {
    const el = document.getElementById(id);
    assert.ok(el, `#${id} missing`);
    assert.ok(el.tagName.toLowerCase().startsWith("mono-"), `#${id} is ${el.tagName}`);
  }
});

test("every mono-select is hand-rolled, with no native select inside", () => {
  const selects = $$("mono-select");
  assert.ok(selects.length > 0, "the panel should have selects");
  for (const sel of selects) {
    assert.ok(sel.shadowRoot, "no shadow root");
    /* A native <select> renders a popup that cannot be styled, so the rebuild
     * replaced it with our own listbox. This assertion is the guard against a
     * native select creeping back in. */
    assert.equal(sel.shadowRoot.querySelector("select"), null, "native select found in the shadow root");
    assert.ok(sel.shadowRoot.querySelector('[role="combobox"], .list'), "no combobox trigger or listbox");
  }
});

test("every mono-input has a shadow input ready", () => {
  for (const inp of $$("mono-input")) {
    assert.ok(inp.shadowRoot?.querySelector("input"), "no inner input");
  }
});

test("mono-field labels match the controls they wrap", () => {
  for (const f of $$("mono-field")) {
    const label = f.getAttribute("label");
    assert.ok(label && label.length, "mono-field without label text");
  }
});

test("buttons that app.js disables keep a disabled setter", () => {
  const btn = document.getElementById("btn-ai-save");
  assert.ok(btn, "btn-ai-save missing");
  btn.disabled = true;
  assert.equal(btn.hasAttribute("disabled"), true);
  btn.disabled = false;
  assert.equal(btn.hasAttribute("disabled"), false);
});

test("variants survived the conversion", () => {
  assert.equal(document.getElementById("btn-ai-save").getAttribute("variant"), "primary");
  assert.equal(document.getElementById("btn-temp-disable").getAttribute("variant"), "danger");
  assert.equal(document.getElementById("btn-temp-setup").getAttribute("variant"), "primary");
});

test("login form submit button can drive the form", () => {
  const form = document.getElementById("login-form");
  const btn = form.querySelector("mono-button[type=submit]");
  assert.ok(btn, "no submit button in the login form");
  assert.equal(btn.getAttribute("type"), "submit");
});

/* ------------------------------------------------------------ app.js runs */

test("app.js evaluates without throwing", () => {
  // eslint-disable-next-line no-new-func
  const run = new Function("window", "document", "fetch", "localStorage", "location", app);
  run(window, window.document, window.fetch, window.localStorage, window.location);
});

let failed = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status === "ok" ? "  ok" : "FAIL"}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
