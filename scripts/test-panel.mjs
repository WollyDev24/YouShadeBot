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
const css = readFileSync(new URL("style.css", PUBLIC), "utf8");

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


/* ------------------------------------------------------------- palette ----
 * The dashboard is driven by one token set in :root. These assertions keep it
 * that way: a token used but never defined silently falls back to nothing, a
 * literal creeping back in re-fragments the palette, and the hues can drift away
 * from the light blue and violet the panel is supposed to be.
 */

const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")) + 2);
const rules = css.slice(rootBlock.length);

test("every token the rules use is defined in :root", () => {
  const defined = new Set([...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...rules.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  /* --i is a per-element animation index supplied inline by app.js. */
  used.delete("--i");
  const missing = [...used].filter((t) => !defined.has(t));
  assert.deepEqual(missing, [], "tokens used but never defined");
});

test("no token inside :root refers to another token", () => {
  const loops = [...rootBlock.matchAll(/(--[a-z0-9-]+):\s*[^;]*var\((--[a-z0-9-]+)/g)]
    .filter((m) => m[1] === m[2])
    .map((m) => `${m[1]} -> ${m[2]}`);
  assert.deepEqual(loops, [], "a token defined in terms of itself is a dead loop");
});

test("the rules contain no hardcoded colours", () => {
  const literals = [...rules.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\((?![^)]*var\()/g)].map((m) => m[0]);
  assert.deepEqual(literals, [], "colours must come from tokens, not literals");
});

test("the palette is light blue and violet over a dark base", () => {
  const token = (name) => rootBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  const hue = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return Math.round(((h * 60) + 360) % 360);
  };
  const sat = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === min ? 0 : (max - min) / max;
  };

  /* light blue: a cyan-leaning hue, high blue, blue above red */
  const accent = token("--accent");
  assert.ok(accent, "--accent must be a hex colour");
  const ah = hue(accent);
  assert.ok(ah >= 185 && ah <= 215, `--accent should be light blue, got hue ${ah} (${accent})`);
  const ab = parseInt(accent.slice(5, 7), 16);
  const ar = parseInt(accent.slice(1, 3), 16);
  assert.ok(ab > ar, "--accent must lean blue over red");
  assert.ok(sat(accent) > 0.5, "--accent must be saturated enough to read as an accent");

  /* violet: between magenta and blue, red above green */
  const violet = token("--violet");
  assert.ok(violet, "--violet must be a hex colour");
  const vh = hue(violet);
  assert.ok(vh >= 250 && vh <= 280, `--violet should sit in the violet band, got hue ${vh} (${violet})`);
  assert.ok(
    parseInt(violet.slice(1, 3), 16) > parseInt(violet.slice(3, 5), 16),
    "--violet must lean red over green"
  );

  /* dark base */
  for (const name of ["--bg", "--card", "--card-2", "--card-3"]) {
    const hex = token(name);
    const lum = (parseInt(hex.slice(1, 3), 16) * 0.299
      + parseInt(hex.slice(3, 5), 16) * 0.587
      + parseInt(hex.slice(5, 7), 16) * 0.114) / 255;
    assert.ok(lum < 0.2, `${name} must stay dark, got luminance ${lum.toFixed(3)}`);
  }

  /* and the cool base has to be cool: more blue than red */
  const bg = token("--bg");
  assert.ok(
    parseInt(bg.slice(5, 7), 16) >= parseInt(bg.slice(1, 3), 16),
    "--bg should be an indigo rather than a neutral grey"
  );
});



test("every control in the dashboard ends up with an accessible name", () => {
  /* The inner element is what assistive tech reports, and it cannot see the
   * light DOM, so this is the only place the whole chain -- field label or
   * author aria-label down to the shadow control -- can be checked at once. */
  const inner = (ctl) => {
    const root = ctl.shadowRoot;
    if (!root) return null;
    return root.querySelector("input, textarea, .ctl") ?? root.querySelector("button");
  };
  /* No host-level fallback: the host is a custom element, not the thing
   * assistive tech reports, so a label sitting there names nothing. */
  const accessibleName = (ctl) => {
    const el = inner(ctl);
    if (!el) return null;
    if ((el.getAttribute("aria-label") ?? "").trim()) return "aria-label";
    if (el.getAttribute("aria-labelledby")) return "aria-labelledby";
    /* Name from content does work through a slot, but the text lives in the
     * light DOM -- the shadow element's own textContent is empty. */
    if ((ctl.textContent ?? "").replace(/\s+/g, " ").trim()) return "contents";
    return null;
  };

  const controls = $$("mono-input, mono-textarea, mono-search, mono-select, mono-checkbox, mono-switch, mono-button");
  const unnamed = controls
    .filter((ctl) => !accessibleName(ctl))
    .map((ctl) => `${ctl.tagName.toLowerCase()}${ctl.id ? "#" + ctl.id : ""}`);
  assert.deepEqual(unnamed, [], "controls with no accessible name");
  assert.ok(controls.length > 80, `expected the real dashboard, found ${controls.length}`);
});

test("a fielded control takes its name from the field label", () => {
  /* selects name their trigger <button>, not a .ctl like checkbox and switch */
  const innerOf = (ctl) =>
    ctl.shadowRoot.querySelector("input, textarea, .ctl") ?? ctl.shadowRoot.querySelector("button");
  let checked = 0;
  for (const field of $$("mono-field[label]")) {
    const ctl = field.querySelector("mono-input, mono-textarea, mono-search, mono-select");
    if (!ctl) continue;
    const expected = field.getAttribute("label").trim();
    /* an author label on the control wins, exactly as mono-field intends */
    const wanted = (ctl.getAttribute("aria-label") ?? expected).trim();
    assert.equal(
      (innerOf(ctl)?.getAttribute("aria-label") ?? "").trim(),
      wanted,
      `${ctl.tagName.toLowerCase()} inside field "${expected}"`
    );
    checked++;
  }
  assert.ok(checked >= 80, `expected the real field count, checked ${checked}`);
});

test("filled controls meet WCAG AA contrast against their ink", () => {
  const hex = (name) => rootBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /* Filled surfaces and the ink that sits on them. Light blue, green and red are
     all pale in this palette, which is exactly why white text on them fails. */
  const pairs = [
    ["--accent", "--on-accent", "primary button"],
    ["--red", "--on-danger", "danger button"],
    ["--green", "--on-success", "success button"],
    ["--discord", "--on-discord", "discord button"],
    ["--text", "--card", "body text on a card"],
    ["--text", "--bg", "body text on the page"],
    ["--muted", "--card", "muted text on a card"],
    ["--accent", "--card", "accent text on a card"]
  ];
  for (const [fgName, bgName, what] of pairs) {
    const fg = hex(fgName), bg = hex(bgName);
    assert.ok(fg && bg, `${what}: missing ${!fg ? fgName : bgName}`);
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${what}: ${fgName} on ${bgName} is ${ratio.toFixed(2)}:1, needs 4.5`);
  }
});

test("density is unchanged from the previous palette", () => {
  assert.match(rootBlock, /--radius:\s*16px/, "radius stays 16px");
  assert.match(rootBlock, /--control-h:\s*38px/, "controls stay 38px tall");
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
