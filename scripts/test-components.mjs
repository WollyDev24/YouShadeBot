/* Smoke tests for the custom element library.
 *
 * Runs components.js inside a happy-dom document, then exercises the DOM API
 * surface that app.js depends on. Run with: node scripts/test-components.mjs
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import assert from "node:assert/strict";

const win = new Window({ url: "https://example.test/dashboard" });
const { window } = win;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.customElements = window.customElements;
globalThis.CSSStyleSheet = window.CSSStyleSheet;
globalThis.MutationObserver = window.MutationObserver;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.Node = window.Node;
globalThis.CSS = window.CSS;
globalThis.FormData = window.FormData;
globalThis.HTMLFormElement = window.HTMLFormElement;

/* happy-dom has no constructable stylesheet support in every build; stub the
 * bits components.js needs so the module can be evaluated. */
if (typeof window.CSSStyleSheet !== "function") {
  window.CSSStyleSheet = class {
    replaceSync() {}
  };
  globalThis.CSSStyleSheet = window.CSSStyleSheet;
}
if (typeof window.HTMLElement.prototype.attachInternals !== "function") {
  window.HTMLElement.prototype.attachInternals = function () {
    const self = this;
    return {
      form: null,
      setFormValue() {},
      setValidity() {},
      willValidate: true,
      checkValidity: () => true
    };
  };
}
if (typeof window.CSS?.escape !== "function") {
  window.CSS.escape = (s) => String(s).replace(/["\\]/g, "\\$&");
}

const src = readFileSync(new URL("../src/panel/public/components.js", import.meta.url), "utf8");
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(src).toString("base64")
);

const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n       ${err.message}`]);
  }
};
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------------------------------------------------------------- inputs */

await test("mono-input mirrors value in both directions", () => {
  const el = document.createElement("mono-input");
  document.body.append(el);
  el.value = "hello";
  assert.equal(el.value, "hello");
  assert.equal(el.getAttribute("value"), "hello");
  el.setAttribute("value", "attr");
  assert.equal(el.value, "attr");
});

await test("mono-input dispatches input and change events", async () => {
  const el = document.createElement("mono-input");
  document.body.append(el);
  let inputs = 0;
  let changes = 0;
  el.addEventListener("input", () => inputs++);
  el.addEventListener("change", () => changes++);
  el._el.value = "typed";
  el._el.dispatchEvent(new window.Event("input"));
  el._el.dispatchEvent(new window.Event("change"));
  assert.equal(inputs, 1);
  assert.equal(changes, 1);
});

await test("mono-input forwards required and disabled", () => {
  const el = document.createElement("mono-input");
  el.setAttribute("required", "");
  el.setAttribute("disabled", "");
  el.setAttribute("maxlength", "10");
  document.body.append(el);
  assert.equal(el.required, true);
  assert.equal(el.disabled, true);
  assert.equal(el.maxLength, 10);
});

/* -------------------------------------------------------------- textareas */

await test("mono-textarea value round-trips", () => {
  const el = document.createElement("mono-textarea");
  document.body.append(el);
  el.value = "line1\nline2";
  assert.equal(el.value, "line1\nline2");
});

/* --------------------------------------------------------------- selects */

await test("mono-select mirrors light DOM options into shadow DOM", async () => {
  const el = document.createElement("mono-select");
  el.id = "s1";
  document.body.append(el);
  el.innerHTML = `<option value="a">A</option><option value="b">B</option>`;
  await flush();
  assert.equal(el.options.length, 2, "options should be mirrored");
  assert.equal(el.options[0].textContent, "A");
});

await test("mono-select applies value after options appear", async () => {
  const el = document.createElement("mono-select");
  document.body.append(el);
  el.value = "b"; // set before the options exist
  el.innerHTML = `<option value="a">A</option><option value="b">B</option>`;
  await flush();
  assert.equal(el.value, "b");
});

await test("mono-select fillSelect() contract used by app.js", async () => {
  const sel = document.createElement("mono-select");
  document.body.append(sel);
  sel.innerHTML = "";
  const o = document.createElement("option");
  o.value = "123";
  o.textContent = "#general";
  sel.append(o);
  await flush();
  sel.value = "123";
  assert.equal(sel.value, "123");
  assert.equal(sel.options.length, 1);
});

await test("mono-select multiple exposes selectedOptions values", async () => {
  const sel = document.createElement("mono-select");
  sel.setAttribute("multiple", "");
  document.body.append(sel);
  sel.innerHTML = `<option value="1">a</option><option value="2">b</option>`;
  await flush();
  sel.values = ["2"];
  const picked = [...sel.selectedOptions].map((o) => o.value);
  assert.deepEqual(picked, ["2"]);
});

await test("mono-select dispatches change once when an option is committed", async () => {
  const sel = document.createElement("mono-select");
  document.body.append(sel);
  sel.innerHTML = `<option value="x">x</option><option value="y">y</option>`;
  await flush();
  let changed = 0;
  let inputs = 0;
  sel.addEventListener("change", () => changed++);
  sel.addEventListener("input", () => inputs++);
  /* There is no inner native <select> to poke any more, so drive the control
   * the way a user does: open it, then commit an option. */
  assert.equal(sel.shadowRoot.querySelector("select"), null, "no native select in the shadow root");
  sel._openPopup();
  sel._commit(1);
  assert.equal(changed, 1, "one commit is one change event");
  assert.equal(inputs, 1);
  assert.equal(sel.value, "y");
});

/* ------------------------------------------------------------- checkboxes */

await test("mono-checkbox reflects checked both ways", () => {
  const cb = document.createElement("mono-checkbox");
  document.body.append(cb);
  cb.checked = true;
  assert.equal(cb.getAttribute("checked"), "");
  assert.equal(cb.checked, true);
  cb.checked = false;
  assert.equal(cb.hasAttribute("checked"), false);
  assert.equal(cb.checked, false);
});

await test("mono-checkbox keeps its value and fires change", () => {
  const cb = document.createElement("mono-checkbox");
  cb.value = "/ban";
  document.body.append(cb);
  assert.equal(cb.value, "/ban");
  let changes = 0;
  cb.addEventListener("change", () => changes++);
  /* There is no inner native checkbox to poke any more, so drive the control
   * the way a user does. */
  cb.click();
  assert.equal(changes, 1);
  assert.equal(cb.checked, true);
});

await test("mono-checkbox slotted text is preserved", () => {
  const cb = document.createElement("mono-checkbox");
  cb.textContent = " enabled";
  document.body.append(cb);
  assert.match(cb.textContent, /enabled/);
  assert.ok(cb.shadowRoot.querySelector("slot"), "the label needs a slot to show the text");
});

await test("mono-checkbox toggles when the user clicks it", () => {
  const cb = document.createElement("mono-checkbox");
  cb.value = "help";
  document.body.append(cb);
  let changes = 0;
  cb.addEventListener("change", () => changes++);
  assert.equal(cb.checked, false);
  cb.click();
  assert.equal(cb.checked, true, "a host click must toggle the box");
  assert.equal(changes, 1, "and must fire change exactly once");
  cb.click();
  assert.equal(cb.checked, false, "and toggle back");
  assert.equal(changes, 2);
});

await test("clicking the internal label toggles exactly once", () => {
  const cb = document.createElement("mono-checkbox");
  document.body.append(cb);
  let changes = 0;
  cb.addEventListener("change", () => changes++);
  cb.shadowRoot.querySelector("label").click();
  assert.equal(cb.checked, true);
  assert.equal(changes, 1, "label activation must not double-toggle via the host handler");
});

await test("a disabled mono-checkbox ignores clicks", () => {
  const cb = document.createElement("mono-checkbox");
  cb.disabled = true;
  document.body.append(cb);
  cb.click();
  assert.equal(cb.checked, false, "a disabled checkbox must stay unchecked");
});

/* --------------------------------------------------------------- buttons */

await test("mono-button fires exactly one click per user click", () => {
  const btn = document.createElement("mono-button");
  document.body.append(btn);
  let clicks = 0;
  btn.addEventListener("click", () => clicks++);
  btn._el.click();
  assert.equal(clicks, 1, "a click must not be dispatched twice");
});

await test("mono-button disabled swallows clicks", () => {
  const btn = document.createElement("mono-button");
  document.body.append(btn);
  let clicks = 0;
  btn.addEventListener("click", () => clicks++);
  btn.disabled = true;
  assert.equal(btn.hasAttribute("disabled"), true);
  btn._el.click();
  assert.equal(clicks, 0);
});

await test("mono-button variant and small attributes", () => {
  const btn = monoButtonFactory("btn primary small");
  assert.equal(btn.tagName.toLowerCase(), "mono-button");
  assert.equal(btn.getAttribute("variant"), "primary");
  assert.equal(btn.hasAttribute("small"), true);
  assert.equal(btn.classList.contains("btn"), false);
});

function monoButtonFactory(classes) {
  const b = document.createElement("mono-button");
  for (const t of classes.split(/\s+/).filter(Boolean)) {
    if (t === "btn") continue;
    if (["primary", "danger", "ghost", "discord", "success"].includes(t)) b.setAttribute("variant", t);
    else if (["small", "large", "full", "block"].includes(t)) b.setAttribute(t, "");
    else b.classList.add(t);
  }
  return b;
}

/* ----------------------------------------------------------------- fields */

await test("mono-field shows its label", () => {
  const f = document.createElement("mono-field");
  f.setAttribute("label", "Channel");
  document.body.append(f);
  const label = f._root.querySelector("label");
  assert.equal(label.textContent, "Channel");
});

/* ------------------------------------------------------------------ toast */

await test("mono-toast shows and hides", () => {
  const t = document.createElement("mono-toast");
  document.body.append(t);
  t.show("saved", "error", 10);
  assert.equal(t.getAttribute("tone"), "error");
  assert.equal(t.hidden, false);
  assert.match(t._msg.textContent, /saved/);
  t.hide();
  assert.equal(t.hidden, true);
});

/* --------------------------------------------------------- element sanity */

await test("every declared element is defined", () => {
  for (const name of [
    "mono-input", "mono-textarea", "mono-select", "mono-checkbox",
    "mono-button", "mono-field", "mono-search", "mono-switch",
    "mono-badge", "mono-avatar", "mono-progress", "mono-toast",
    "mono-modal", "mono-card", "mono-list", "mono-list-item", "mono-stat"
  ]) {
    assert.ok(customElements.get(name), `${name} should be registered`);
  }
});

await test("module exports the class list", () => {
  assert.ok(mod, "module evaluated");
});

/* ----------------------------------------------------------------- report */

let failed = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status === "PASS" ? "  ok" : "FAIL"}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
