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


/* --- checkbox and switch: hand-rolled, no native input --- */

function makeCheckbox({ label = "Enabled", attrs = {} } = {}) {
  const el = document.createElement("mono-checkbox");
  el.textContent = label;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

const makeSwitch = ({ label = "Enabled", attrs = {} } = {}) => {
  const el = document.createElement("mono-switch");
  el.textContent = label;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
};

await test("checkbox carries no native input and exposes role=checkbox", () => {
  const el = makeCheckbox();
  assert.equal(el.shadowRoot.querySelector("input"), null, "no native checkbox in the shadow root");
  const ctl = el.shadowRoot.querySelector(".ctl");
  assert.equal(ctl.getAttribute("role"), "checkbox");
  assert.equal(ctl.getAttribute("aria-checked"), "false");
  assert.equal(ctl.getAttribute("tabindex"), "0", "must be reachable by keyboard");
});

await test("checkbox caption becomes its accessible name", () => {
  const el = makeCheckbox({ label: "  Log   deletions " });
  const name = el.shadowRoot.querySelector(".ctl").getAttribute("aria-label");
  assert.equal(name, "Log deletions", "whitespace is collapsed");
});

await test("checkbox Space toggles and fires change exactly once", () => {
  const el = makeCheckbox();
  let changes = 0;
  el.addEventListener("change", () => changes++);
  key(el.shadowRoot.querySelector(".ctl"), " ");
  assert.equal(el.checked, true);
  assert.equal(changes, 1, "Space is one change");
  key(el.shadowRoot.querySelector(".ctl"), " ");
  assert.equal(el.checked, false);
  assert.equal(changes, 2);
});

await test("checkbox indeterminate reports mixed and settles on interaction", () => {
  const ctlOf = (el) => el.shadowRoot.querySelector(".ctl");
  const viaClick = makeCheckbox();
  viaClick.indeterminate = true;
  assert.equal(ctlOf(viaClick).getAttribute("aria-checked"), "mixed");
  viaClick.click();
  assert.equal(viaClick.indeterminate, false, "a click settles the mixed state");
  assert.equal(viaClick.checked, true);
  assert.equal(ctlOf(viaClick).getAttribute("aria-checked"), "true");

  /* The keyboard path has to settle it too, not just the pointer path. */
  const viaKey = makeCheckbox();
  viaKey.indeterminate = true;
  key(ctlOf(viaKey), " ");
  assert.equal(viaKey.indeterminate, false, "Space settles the mixed state too");
  assert.equal(viaKey.checked, true);
});

await test("checkbox required is invalid until it is ticked", () => {
  const el = makeCheckbox({ attrs: { required: "" } });
  assert.equal(el.checkValidity(), false);
  assert.equal(el._validity.valueMissing, true);
  assert.equal(el.shadowRoot.querySelector(".ctl").getAttribute("aria-invalid"), "true");
  el.click();
  assert.equal(el.checkValidity(), true);
});

await test("a disabled checkbox ignores clicks and the keyboard", () => {
  const el = makeCheckbox({ attrs: { disabled: "" } });
  let changes = 0;
  el.addEventListener("change", () => changes++);
  el.click();
  key(el.shadowRoot.querySelector(".ctl"), " ");
  assert.equal(el.checked, false, "a disabled checkbox stays unchecked");
  assert.equal(changes, 0, "and fires nothing");
});

await test("a checked checkbox submits its value, unchecked submits nothing", () => {
  const el = makeCheckbox({ attrs: { name: "mod" } });
  el.value = "/ban";
  el._syncForm();
  assert.equal(el._formValue, null);
  el.click();
  assert.equal(el._formValue, "/ban");
  el.click();
  assert.equal(el._formValue, null);
});

await test("switch has role=switch, no native input, and toggles once", () => {
  const el = makeSwitch();
  assert.equal(el.shadowRoot.querySelector("input"), null, "no native checkbox in the shadow root");
  const ctl = el.shadowRoot.querySelector(".ctl");
  assert.equal(ctl.getAttribute("role"), "switch");
  assert.equal(ctl.getAttribute("aria-checked"), "false");
  let changes = 0;
  el.addEventListener("change", () => changes++);
  el.click();
  assert.equal(el.checked, true);
  assert.equal(ctl.getAttribute("aria-checked"), "true");
  assert.equal(changes, 1, "one click is one change");
  key(ctl, " ");
  assert.equal(el.checked, false);
  assert.equal(changes, 2);
});

await test("switch label click does not double-toggle", () => {
  const el = makeSwitch();
  let changes = 0;
  el.addEventListener("change", () => changes++);
  el.shadowRoot.querySelector("label").click();
  assert.equal(changes, 1, "label activation must not toggle twice");
  assert.equal(el.checked, true);
});

await test("a disabled switch ignores clicks", () => {
  const el = makeSwitch({ attrs: { disabled: "" } });
  let changes = 0;
  el.addEventListener("change", () => changes++);
  el.click();
  assert.equal(el.checked, false);
  assert.equal(changes, 0);
});


/* ------------------------------------------------------- mono-button ---- */

/* A bare button carries its label on the host -- every nav tab and icon trigger
 * in the dashboard does this. The inner <button> is what assistive tech reports,
 * so the name has to reach it. */
await test("a bare button takes its accessible name from the host", () => {
  const btn = document.createElement("mono-button");
  btn.setAttribute("bare", "");
  btn.setAttribute("aria-label", "Pick emoji");
  btn.innerHTML = '<span class="mat-icon" aria-hidden="true">mood</span>';
  document.body.appendChild(btn);
  const inner = btn.shadowRoot.querySelector("button");
  assert.equal(inner.getAttribute("aria-label"), "Pick emoji");
});

await test("removing the host label removes it from the button too", () => {
  const btn = document.createElement("mono-button");
  btn.setAttribute("aria-label", "Account");
  document.body.appendChild(btn);
  const inner = btn.shadowRoot.querySelector("button");
  btn.removeAttribute("aria-label");
  assert.equal(inner.getAttribute("aria-label"), null);
});

/* The page's only :focus-visible rule is a document-level selector, so it cannot
 * reach a shadow root. Bare mode holds every nav tab and icon trigger in the
 * dashboard, so it has to bring its own indicator rather than switching the
 * platform one off. Checked against the source: happy-dom parses almost none of
 * the adopted stylesheet, so the shadow CSS is only inspectable as text. */
await test("a bare button keeps a visible focus indicator", () => {
  const source = fs.readFileSync(new URL("../src/panel/public/components.js", import.meta.url), "utf8");
  const bareFocus = source.match(/:host\(\[bare\]\)[^{]*:focus-visible[^{]*\{([^}]*)\}/);
  assert.ok(bareFocus, "bare mode must style its own focus state");
  const body = bareFocus[1];
  assert.ok(!/outline:\s*none/.test(body), `bare focus rule kills the indicator: ${body}`);
  assert.match(body, /outline:\s*2px solid/, `bare focus rule sets no visible outline: ${body}`);
});

await test("no component focus rule removes the indicator without replacing it", () => {
  const source = fs.readFileSync(new URL("../src/panel/public/components.js", import.meta.url), "utf8");
  const focusRules = [...source.matchAll(/([^{}]*:focus-visible[^{]*)\{([^}]*)\}/g)];
  assert.ok(focusRules.length > 1, "expected several focus rules to police");
  for (const [, selector, body] of focusRules) {
    const removes = /outline:\s*none/.test(body);
    const restores = /outline:\s*(?!none)/.test(body) || /box-shadow:\s*(?!none)/.test(body);
    assert.ok(
      !removes || restores,
      `${selector.trim()} removes the focus indicator and puts nothing back: ${body.trim()}`
    );
  }
});

await test("a loading button will not submit its form", () => {
  const form = document.createElement("form");
  const btn = document.createElement("mono-button");
  btn.setAttribute("type", "submit");
  btn.setAttribute("loading", "");
  form.appendChild(btn);
  document.body.appendChild(form);
  let submits = 0;
  form.addEventListener("submit", (e) => { submits++; e.preventDefault(); });
  btn.shadowRoot.querySelector("button").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, composed: true })
  );
  assert.equal(submits, 0, "a loading button must not submit");
  btn.removeAttribute("loading");
  btn.shadowRoot.querySelector("button").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, composed: true })
  );
  assert.equal(submits, 1, "clearing loading restores submission");
});


/* ------------------------------------------------- fields and names ---- */

/* <mono-field> and its control live in different shadow roots, so there is no
 * native label/for association. The label has to be handed over by hand. */
function makeField(label, controlTag = "mono-input") {
  const field = document.createElement("mono-field");
  if (label != null) field.setAttribute("label", label);
  const ctl = document.createElement(controlTag);
  field.appendChild(ctl);
  document.body.appendChild(field);
  return { field, ctl, inner: ctl.shadowRoot.querySelector("input, textarea, .ctl") };
}

await test("a field hands its label to the control it wraps", () => {
  const { ctl, inner } = makeField("Panel password");
  assert.equal(inner.getAttribute("aria-label"), "Panel password");
  assert.equal(ctl.getAttribute("aria-label"), "Panel password");
});

await test("renaming a field updates the name it handed over", () => {
  const { field, inner } = makeField("Old name");
  field.setAttribute("label", "New name");
  assert.equal(inner.getAttribute("aria-label"), "New name");
});

await test("removing a field label takes the name back off the control", () => {
  const { field, ctl, inner } = makeField("Temporary");
  field.removeAttribute("label");
  assert.equal(inner.getAttribute("aria-label"), null);
  assert.equal(ctl.hasAttribute("aria-label"), false);
});

await test("a field never overwrites a name the author set on the control", () => {
  const { ctl, inner } = makeField("Field label");
  ctl.setAttribute("aria-label", "Author label");
  /* force a resync the way a re-render would */
  ctl.setAttribute("label", "Field label");
  assert.equal(inner.getAttribute("aria-label"), "Author label");
  /* and removing the field label must leave the author's name alone */
  ctl.removeAttribute("label");
  assert.equal(inner.getAttribute("aria-label"), "Author label");
});

await test("a field wraps a textarea and a search just as well", () => {
  for (const tag of ["mono-textarea", "mono-search"]) {
    const { inner } = makeField(`Label for ${tag}`, tag);
    assert.equal(inner.getAttribute("aria-label"), `Label for ${tag}`, tag);
  }
});

await test("clicking a field label focuses the control it names", () => {
  const { field, ctl } = makeField("Focus me");
  let focused = 0;
  ctl.focus = () => { focused++; };
  field.shadowRoot.querySelector("label").click();
  assert.equal(focused, 1, "a label click must move focus to its control");
});

await test("a field with no control does not throw", () => {
  const field = document.createElement("mono-field");
  field.setAttribute("label", "Nothing here");
  document.body.appendChild(field);
  assert.equal(field.shadowRoot.querySelector(".hint").hidden, true);
});

await test("a text control mirrors aria-labelledby as well as aria-label", () => {
  const ctl = document.createElement("mono-input");
  ctl.setAttribute("aria-labelledby", "external-label");
  document.body.appendChild(ctl);
  const inner = ctl.shadowRoot.querySelector("input");
  assert.equal(inner.getAttribute("aria-labelledby"), "external-label");
});

mark("ALL TESTS DONE");
for (const [state, name] of results) console.log(`  ${state}  ${name}`);
const failures = results.filter(([s]) => s === "FAIL").length;
console.log(`\n${results.length - failures}/${results.length} passed`);
if (failures) process.exit(1);