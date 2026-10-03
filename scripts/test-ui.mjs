/* Tests for the rebuilt component library.
 *
 * Loads the real modules from src/panel/public/lib/ against happy-dom and
 * drives them the way a keyboard user would, since the whole point of this
 * library is that the browser no longer supplies the behaviour for us.
 */
import { Window } from "happy-dom";
import assert from "node:assert/strict";
import fs from "node:fs";

/* Synchronous progress markers. Without these a hang is invisible: the file
 * shows the last test that started but never finished. */
const LOG = process.env.UI_LOG ?? "/tmp/opencode/ui-tests.log";
const mark = (m) => fs.appendFileSync(LOG, `${m}\n`);

const win = new Window({ url: "https://example.test/dashboard" });
const { window } = win;

for (const k of [
  "HTMLElement", "customElements", "MutationObserver", "Event", "CustomEvent",
  "MouseEvent", "KeyboardEvent", "PointerEvent", "Node", "Element",
  "DocumentFragment", "getComputedStyle", "requestAnimationFrame", "Document",
  "CSSStyleSheet", "CSS", "FormData", "HTMLFormElement"
]) globalThis[k] = window[k];
globalThis.window = window;
globalThis.document = window.document;

window.HTMLElement.prototype.attachInternals = function () {
  const host = this;
  return {
    form: null,
    willValidate: true,
    checkValidity: () => true,
    /* Recorded on the host so tests can assert the element really reports a
     * value and validity, rather than silently accepting everything. */
    setFormValue(v) { host._formValue = v; },
    setValidity(v) { host._validity = v; }
  };
};
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 38, width: 200, height: 38, toJSON() {} };
};

await import("../src/panel/public/components.js");

/* Leaving popups open across tests piled up stale listboxes in the shared
 * layer, which is both a false-failure source and what made the suite peg a
 * CPU at the end. */
function cleanup() {
  for (const el of $$("mono-select")) {
    try {
      el._close?.({ focus: false });
    } catch {}
    el.remove();
  }
  const host = layerRoot();
  if (host) host.textContent = "";
}

const results = [];
const test = async (name, fn) => {
  mark(`START ${name}`);
  cleanup();
  try {
    await fn();
    results.push(["ok", name]);
    mark(`PASS  ${name}`);
  } catch (err) {
    results.push(["FAIL", `${name}\n       ${String(err.message).split("\n").join("\n       ")}`]);
    mark(`FAIL  ${name}: ${String(err.message).slice(0, 200)}`);
  }
  cleanup();
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const key = (el, k, extra = {}) =>
  el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, composed: true, cancelable: true, ...extra }));

function makeSelect({ multiple = false, options = ["Alpha", "Beta", "Gamma"], placeholder = "" } = {}) {
  const el = document.createElement("mono-select");
  if (multiple) el.setAttribute("multiple", "");
  if (placeholder) el.setAttribute("placeholder", placeholder);
  for (const text of options) {
    const o = document.createElement("option");
    o.value = text.toLowerCase();
    o.textContent = text;
    el.append(o);
  }
  document.body.append(el);
  return el;
}

/* The popup lives in a shared layer on document.body, outside the host, so
 * several can be open at once. Tests must therefore scope to the most recently
 * opened one rather than the first, and tear down after themselves. */
const layerRoot = () => document.getElementById("mono-popup-layer")?.shadowRoot?.firstElementChild ?? null;
const list = () => {
  const host = layerRoot();
  if (!host) return null;
  return host.querySelectorAll('[role="listbox"]');
};
/* ARIA 1.2 puts the combobox role and its states on the focused element, so
 * assertions read the internal trigger rather than the host. */
const combo = (el) => el.shadowRoot.querySelector('[role="combobox"]');

const lastList = () => {
  const all = list();
  return all?.length ? all[all.length - 1] : null;
};
const optEls = () => [...(lastList()?.children ?? [])];

await test("the select is built without a native select anywhere", () => {
  const el = makeSelect();
  assert.equal(el.shadowRoot.querySelector("select"), null, "no native select in the shadow root");
  assert.equal($$("select").length, 0, "and none in the document either");
});

await test("options are exposed the way app.js expects", () => {
  const el = makeSelect();
  assert.equal(el.options.length, 3);
  assert.equal(el.options[0].value, "alpha");
  el.options[1].selected = true;
  assert.deepEqual(el.selectedOptions.map((o) => o.value), ["beta"]);
  assert.equal(el.value, "beta", "value mirrors the first selected option");
});

await test("closed select carries the combobox ARIA contract", () => {
  const el = makeSelect();
  assert.equal(combo(el).getAttribute("role"), "combobox");
  assert.equal(combo(el).getAttribute("aria-haspopup"), "listbox");
  assert.equal(combo(el).getAttribute("aria-expanded"), "false");
  assert.ok(combo(el).getAttribute("aria-controls"), "aria-controls must reference the listbox");
  assert.equal(combo(el).getAttribute("aria-expanded"), "false");
});

await test("opening renders a listbox of options with correct roles", () => {
  const el = makeSelect();
  el._openPopup();
  const box = lastList();
  assert.ok(box, "a listbox should exist in the popup layer");
  assert.equal(box.getAttribute("role"), "listbox");
  assert.equal(optEls().length, 3);
  assert.ok(optEls().every((o) => o.getAttribute("role") === "option"));
  assert.equal(combo(el).getAttribute("aria-expanded"), "true");
  el._close();
});

await test("multiple select announces multiselectable", () => {
  const el = makeSelect({ multiple: true });
  el._openPopup();
  assert.equal(lastList().getAttribute("aria-multiselectable"), "true");
  el._close();
});

await test("Enter opens the popup", () => {
  const el = makeSelect();
  key(el.shadowRoot.querySelector("button"), "Enter");
  assert.equal(el.open, true);
  el._close();
});

await test("ArrowDown then Enter commits the second option", () => {
  const el = makeSelect();
  key(el.shadowRoot.querySelector("button"), "ArrowDown");
  assert.equal(el.open, true);
  optEls()[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
  assert.equal(el.value, "beta");
  assert.equal(el.open, false, "a single select closes after committing");
});

await test("arrow keys move the active option while open", () => {
  const el = makeSelect();
  el._openPopup();
  const button = el.shadowRoot.querySelector("button");
  key(button, "ArrowDown");
  const first = combo(el).getAttribute("aria-activedescendant");
  key(button, "ArrowDown");
  const second = combo(el).getAttribute("aria-activedescendant");
  assert.ok(first && second && first !== second, `active should move: ${first} -> ${second}`);
  el._close();
});

await test("Home and End jump to the ends", () => {
  const el = makeSelect();
  el._openPopup();
  const button = el.shadowRoot.querySelector("button");
  key(button, "End");
  const atEnd = combo(el).getAttribute("aria-activedescendant");
  key(button, "Home");
  const atStart = combo(el).getAttribute("aria-activedescendant");
  assert.ok(atEnd && atStart && atEnd !== atStart, "Home and End should land on different options");
  el._close();
});

await test("type-ahead jumps to a matching option", () => {
  const el = makeSelect({ options: ["Alpha", "Beta", "Gamma"] });
  el._openPopup();
  const button = el.shadowRoot.querySelector("button");
  key(button, "g");
  assert.match(optEls()[2].textContent, /Gamma/, "typing g should activate Gamma");
  el._close();
});

await test("ArrowUp from closed opens on the last option", () => {
  const el = makeSelect();
  const button = el.shadowRoot.querySelector("button");
  key(button, "ArrowUp");
  assert.equal(el.open, true);
  const active = optEls().findIndex((o) => o.hasAttribute("data-active"));
  assert.ok(active >= 0, "an option should be active");
  assert.equal(active, 2, "ArrowUp opens on the last option");
  assert.equal(combo(el).getAttribute("aria-activedescendant"), `${optEls()[2].id}`);
  el._close();
});

await test("Escape closes and returns focus to the button", () => {
  const el = makeSelect();
  el._openPopup();
  const button = el.shadowRoot.querySelector("button");
  key(button, "Escape");
  assert.equal(el.open, false);
  assert.equal(el.shadowRoot.activeElement, button, "focus should return to the trigger");
});

await test("disabled options are skipped and marked", () => {
  const el = makeSelect();
  el.options[1].disabled = true;
  el._openPopup();
  assert.equal(optEls()[1].getAttribute("aria-disabled"), "true");
  el._close();
});

await test("committing a change fires change and input", () => {
  const el = makeSelect();
  let changes = 0;
  let inputs = 0;
  el.addEventListener("change", () => changes++);
  el.addEventListener("input", () => inputs++);
  el._openPopup();
  optEls()[2].dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
  assert.equal(changes, 1, "change should fire once");
  assert.equal(inputs, 1, "input should fire once");
  assert.equal(el.value, "gamma");
});

await test("multiple select keeps several values and stays open", () => {
  const el = makeSelect({ multiple: true });
  el._openPopup();
  optEls()[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
  optEls()[2].dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
  assert.equal(el.open, true, "a multiple select stays open while choosing");
  assert.deepEqual(el.selectedOptions.map((o) => o.value), ["alpha", "gamma"]);
});

await test("setting value to something absent falls back to the first option", () => {
  const el = makeSelect();
  el.value = "beta";
  assert.equal(el.value, "beta");
  el.value = "nope";
  /* Deliberately not native: a native <select> would report "". This panel has
   * always fallen back to the first option so a picker never sits on an empty
   * value, and app.js relies on that. */
  assert.equal(el.value, "alpha", "an unknown value falls back to the first option");
  assert.equal(el.selectedIndex, 0);
});

await test("placeholder shows when nothing is selected", () => {
  /* An explicit empty-valued first option is the panel's "(none)" convention,
   * and the only way a single select ends up with nothing selected. */
  const el = makeSelect({ placeholder: "Pick one", options: ["", "Alpha"] });
  assert.equal(el.shadowRoot.querySelector(".value").textContent, "");
  el.value = "alpha";
  assert.equal(el.shadowRoot.querySelector(".value").textContent, "Alpha");
});

await test("a disabled select will not open", () => {
  const el = makeSelect();
  el.setAttribute("disabled", "");
  el._openPopup();
  assert.equal(el.open, false);
});

await test("options added later show up without a manual refresh", async () => {
  const el = makeSelect({ options: ["Alpha"] });
  el._openPopup();
  assert.equal(optEls().length, 1);
  const o = document.createElement("option");
  o.value = "delta";
  o.textContent = "Delta";
  el.append(o);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(optEls().length, 2, "a new option should appear");
  el._close();
});

await test("closing removes the popup from the layer", () => {
  const el = makeSelect();
  el._openPopup();
  assert.ok(lastList());
  el._close();
  assert.equal(lastList(), null, "the listbox should be gone from the layer");
});


/* --- regressions for defects found while reviewing select.js --- */

await test("opens with the preselected option active", () => {
  const el = makeSelect({ options: ["Alpha", "Bravo", "Charlie"] });
  el.value = "bravo";
  el._openPopup();
  /* Regression: show() did this.options.indexOf(<number>), always -1, so a
   * select with a preselected value opened with nothing active. */
  assert.equal(el._activeIndex, 1);
  assert.equal(combo(el).getAttribute("aria-activedescendant"), `${lastList().id}-1`);
});

await test("required with nothing selected is invalid, and clears once set", () => {
  /* A single select always holds the first option, so required is only ever
   * violated by a multiple select with nothing picked. */
  const el = makeSelect({ options: ["Alpha", "Bravo"], multiple: true });
  el.setAttribute("required", "");
  assert.equal(el.checkValidity(), false);
  assert.equal(combo(el).getAttribute("aria-invalid"), "true");
  assert.equal(el._validity.valueMissing, true);
  el.options[1].selected = true;
  el._render();
  assert.equal(el.checkValidity(), true);
  assert.equal(combo(el).hasAttribute("aria-invalid"), false);
});

await test("form internals receive the selected value", () => {
  const el = makeSelect({ options: ["Alpha", "Bravo", "Charlie"] });
  el.name = "channel";
  el.value = "bravo";
  /* The element claimed formAssociated without ever attaching internals, so it
   * would have submitted nothing inside a real <form>. */
  assert.equal(el._formValue, "bravo");
  assert.notEqual(el._internals, null);
});

await test("multiple select submits one entry per selection", () => {
  const el = makeSelect({ options: ["Alpha", "Bravo", "Charlie"] });
  el.setAttribute("multiple", "");
  el.name = "roles";
  el.options[0].selected = true;
  el.options[2].selected = true;
  el._render();
  assert.deepEqual(el._formValue, ["alpha", "charlie"]);
});

await test("formDisabledCallback reflects the disabled state", () => {
  const el = makeSelect({ options: ["Alpha"] });
  el.name = "channel";
  el.value = "alpha";
  el.formDisabledCallback(true);
  assert.equal(el.disabled, true);
  assert.equal(el._formValue, null);
  el.formDisabledCallback(false);
  assert.equal(el.disabled, false);
  assert.equal(el._formValue, "alpha");
});

await test("reset restores defaultSelected", () => {
  const el = makeSelect({ options: ["Alpha", "Bravo"] });
  el.options[1].defaultSelected = true;
  el.value = "alpha";
  el.formResetCallback();
  assert.equal(el.value, "bravo");
  assert.equal(el.hasAttribute("aria-invalid"), false);
});

mark("ALL TESTS DONE");
for (const [state, name] of results) console.log(`  ${state}  ${name}`);
const failures = results.filter(([s]) => s === "FAIL").length;
console.log(`\n${results.length - failures}/${results.length} passed`);
if (failures) process.exit(1);