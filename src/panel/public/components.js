/* Monolith Panel — custom element component library.
 *
 * Every interactive control in the dashboard is a custom element built on
 * Shadow DOM. Each element wraps a native control internally so keyboard
 * navigation, screen readers, autofill and mobile pickers keep working, while
 * the shadow boundary gives us full control of the visual design.
 *
 * The elements deliberately mirror the native DOM API (value, checked,
 * selectedOptions, options, focus, validity...) so the application code in
 * app.js talks to them exactly like it would to <input>/<select>/<button>.
 */

/* ---------- shared design tokens ---------- */

const TOKENS = `
  :host {
    /* Everything resolves against the page palette, so the controls and the
     * dashboard cannot drift apart. Fallbacks keep an element readable if it is
     * ever rendered without style.css loaded. */
    --mono-font: var(--font, "Inter", system-ui, sans-serif);
    --mono-mono: var(--font-mono, ui-monospace, monospace);
    --mono-radius: var(--radius, 16px);
    --mono-radius-sm: var(--radius-sm, 10px);
    --mono-bg: var(--card-2, #1e1a45);
    --mono-bg-hover: var(--card-3, #262157);
    --mono-border: var(--border-strong, #3b3382);
    --mono-text: var(--text, #f3f1ff);
    --mono-muted: var(--muted, #a49dd6);
    --mono-accent: var(--accent, #7cd4fd);
    --mono-violet: var(--violet, #a78bfa);
    --mono-accent-soft: var(--accent-soft, rgb(124 212 253 / 14%));
    --mono-danger: var(--red, #fb7185);
    --mono-green: var(--green, #4ade80);
    --mono-ring: var(--shadow-focus, 0 0 0 4px rgb(124 212 253 / 22%));
    /* Ink for text sitting on a filled accent. Light blue and violet are pale
     * enough that white on them fails contrast, so filled variants use these. */
    --mono-on-accent: var(--on-accent, #0b1030);
    --mono-on-danger: var(--on-danger, #2b0512);
    --mono-on-success: var(--on-success, #04240f);
    --mono-on-discord: var(--on-discord, #ffffff);
    --mono-glow-violet: var(--shadow-violet-glow, 0 0 24px rgb(167 139 250 / 30%));
    --mono-transition: var(--fast, 130ms) var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
    font-family: var(--mono-font);
    box-sizing: border-box;
  }
  :host([hidden]) { display: none !important; }
  * { box-sizing: border-box; }
  :host([disabled]) { opacity: 0.55; pointer-events: none; }
`;

/* ---------- helpers ---------- */

const sheet = new CSSStyleSheet();
sheet.replaceSync(TOKENS);

const define = (name, cls) => {
  if (!customElements.get(name)) customElements.define(name, cls);
};

const boolAttr = (el, name) => el.hasAttribute(name);

/* app.js sometimes sets option.value as a property and sometimes as markup, and
 * an empty value="" must stay empty rather than falling back to the label. */
const optValue = (o) => {
  const attr = o.getAttribute("value");
  if (attr !== null) return attr;
  const prop = o.value;
  if (prop !== undefined && prop !== "") return prop;
  return o.textContent ?? "";
};

/* Every control that pops out of its shadow root teleports it here and
 * positions it in viewport coordinates. A popup cannot escape its host's
 * stacking context, so a select inside an overflow:hidden card would otherwise
 * be clipped. */
let __layer = null;
function popupLayer() {
  if (__layer?.isConnected) return __layer;
  __layer = document.createElement("div");
  __layer.id = "mono-popup-layer";
  __layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483000",
    "pointer-events:none"
  ].join(";");
  __layer.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  mount.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  __layer.shadowRoot.append(mount);
  document.body.append(__layer);
  return __layer;
}

function popupOutside(handler) {
  const listener = (event) => {
    const path = event.composedPath?.() ?? [];
    if (path.includes(handler.anchor)) return;
    handler.close?.();
  };
  document.addEventListener("pointerdown", listener, true);
  return () => document.removeEventListener("pointerdown", listener, true);
}

let selectUid = 0;
const numAttr = (el, name, fallback) => {
  const v = el.getAttribute(name);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* Base class: shadow root + adopted tokens + form plumbing. */
class MonoElement extends HTMLElement {
  static formAssociated = false;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open", delegatesFocus: true });
    this._root.adoptedStyleSheets = [sheet];
    /* attachInternals() is only legal during construction, so form-associated
     * elements must grab it here rather than lazily on first use. */
    if (this.constructor.formAssociated) this._internals = this.attachInternals();
  }

  get internals() {
    return this._internals ?? null;
  }

  /* A control can be labelled from the light DOM -- by an author, or by the
   * <mono-field> that wraps it -- but the element assistive tech actually
   * reports lives in the shadow root and cannot see the host's attributes. A
   * <label for> cannot cross the boundary either, so the name is pushed down
   * here instead. Removal is symmetric so a renamed field does not leave a stale
   * name behind. */
  _mirrorName(inner) {
    if (!inner) return;
    for (const attr of ["aria-label", "aria-labelledby"]) {
      const v = this.getAttribute(attr);
      if (v) inner.setAttribute(attr, v);
      else inner.removeAttribute(attr);
    }
  }

  get form() {
    return this._internals?.form ?? null;
  }
}

/* ============================================================
 * <mono-input> — text, password, number, color, date, search…
 * ============================================================ */

const inputTmpl = document.createElement("template");
inputTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: inline-flex; position: relative; width: 100%; }
    :host([width]) { width: var(--mono-w, auto); }
    .wrap {
      display: flex; align-items: center; gap: 8px; width: 100%;
      background: var(--mono-bg);
      border: 1px solid var(--mono-border);
      border-radius: var(--mono-radius-sm);
      padding: 0 12px;
      transition: border-color var(--mono-transition), box-shadow var(--mono-transition),
                  background var(--mono-transition);
    }
    .wrap:hover { border-color: color-mix(in srgb, var(--mono-accent) 45%, var(--mono-border)); }
    :host(:focus-within) .wrap {
      border-color: var(--mono-accent);
      box-shadow: var(--mono-ring);
    }
    :host([invalid]) .wrap { border-color: var(--mono-danger); }
    input {
      flex: 1; min-width: 0; width: 100%;
      background: none; border: 0; outline: none;
      color: var(--mono-text);
      font: 500 14px/1.4 var(--mono-font);
      padding: 10px 0;
    }
    input::placeholder { color: var(--mono-muted); opacity: 0.65; font-weight: 400; }
    input:disabled { cursor: not-allowed; }
    input[type="color"] { padding: 4px 0; height: 38px; cursor: pointer; }
    input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
    input[type="color"]::-webkit-color-swatch {
      border: 1px solid var(--mono-border); border-radius: 6px;
    }
    input[type="number"] { -moz-appearance: textfield; }
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type="datetime-local"] { font-family: var(--mono-mono); font-size: 13px; }
    /* number steppers rendered by hand so they match the design */
    .steppers { display: none; gap: 2px; }
    :host([type="number"]) .steppers { display: flex; }
    .steppers button {
      all: unset; cursor: pointer; color: var(--mono-muted);
      width: 22px; height: 22px; display: grid; place-items: center;
      border-radius: 6px; font: 700 13px/1 var(--mono-mono);
      transition: background var(--mono-transition), color var(--mono-transition);
    }
    .steppers button:hover { background: var(--mono-bg-hover); color: var(--mono-accent); }
    .suffix { color: var(--mono-muted); font-size: 13px; font-weight: 500; white-space: nowrap; }
  </style>
  <div class="wrap">
    <input part="input" />
    <div class="steppers">
      <button type="button" data-step="1" aria-label="Increase">+</button>
      <button type="button" data-step="-1" aria-label="Decrease">−</button>
    </div>
    <span class="suffix"><slot name="suffix"></slot></span>
  </div>
`;

class MonoInput extends MonoElement {
  static formAssociated = true;
  static observedAttributes = [
    "type", "value", "placeholder", "maxlength", "min", "max", "step",
    "disabled", "readonly", "required", "name", "autocomplete", "spellcheck", "width",
    "aria-label", "aria-labelledby"
  ];

  constructor() {
    super();
    this._root.appendChild(inputTmpl.content.cloneNode(true));
    this._el = this._root.querySelector("input");
    this._el.addEventListener("input", () => this._onInput());
    this._el.addEventListener("change", () => this._onChange());
    this._el.addEventListener("blur", () => {
      this._validate();
      this.dispatchEvent(new Event("blur", { bubbles: false }));
    });
    for (const btn of this._root.querySelectorAll(".steppers button")) {
      btn.addEventListener("click", () => this._nudge(Number(btn.dataset.step)));
    }
  }

  connectedCallback() {
    this._sync();
  }

  attributeChangedCallback(name) {
    /* Only pull the attribute into the control; never push the control's
     * current value back out, or user typing would loop through the setter. */
    this._sync(name);
  }

  _sync(changed) {
    const el = this._el;
    if (!el) return;
    const t = this.getAttribute("type") || "text";
    if (el.type !== t) el.type = t === "datetime-local" ? "datetime-local" : t;
    for (const a of ["placeholder", "maxlength", "min", "max", "step"]) {
      const v = this.getAttribute(a);
      if (v === null) el.removeAttribute(a);
      else el.setAttribute(a, v);
    }
    el.disabled = boolAttr(this, "disabled");
    el.readOnly = boolAttr(this, "readonly");
    el.required = boolAttr(this, "required");
    const name = this.getAttribute("name");
    if (name) el.name = name;
    const ac = this.getAttribute("autocomplete");
    if (ac !== null) el.autocomplete = ac;
    el.spellcheck = this.getAttribute("spellcheck") !== "false";

    const w = this.getAttribute("width");
    if (w) this.style.setProperty("--mono-w", /^\d+$/.test(w) ? `${w}px` : w);

    if (changed === "value" || changed === undefined) {
      const attrValue = this.getAttribute("value");
      if (attrValue !== null && el.value !== attrValue) el.value = attrValue;
    }
    this._mirrorName(el);
  }

  _onInput() {
    this._reflect();
    this.internals?.setFormValue(this._el.value);
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this._validate();
  }

  _onChange() {
    this._reflect();
    this.internals?.setFormValue(this._el.value);
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  /* Keep the attribute in step so a re-render or a later attribute read sees
   * the same value the user typed. */
  _reflect() {
    const v = this._el.value;
    if (this.getAttribute("value") !== v) this.setAttribute("value", v);
  }

  _validate() {
    const el = this._el;
    this.internals?.setValidity(
      el.validity.valid ? {} : { valueMissing: el.validity.valueMissing, typeMismatch: el.validity.typeMismatch, rangeUnderflow: el.validity.rangeUnderflow, rangeOverflow: el.validity.rangeOverflow, patternMismatch: el.validity.patternMismatch, badInput: el.validity.badInput },
      el.validationMessage,
      el
    );
    this.toggleAttribute("invalid", !el.validity.valid);
  }

  _nudge(dir) {
    const el = this._el;
    const step = numAttr(this, "step", 1) || 1;
    const min = el.min === "" ? -Infinity : Number(el.min);
    const max = el.max === "" ? Infinity : Number(el.max);
    let next = (Number(el.value) || 0) + step * dir;
    next = Math.min(Math.max(next, min), max);
    el.value = String(next);
    this._onInput();
    this._onChange();
  }

  /* --- API --- */
  get value() { return this._el.value; }
  set value(v) {
    const next = v ?? "";
    this._el.value = next;
    if (this.getAttribute("value") !== next) this.setAttribute("value", next);
    this.internals?.setFormValue(this._el.value);
  }
  get type() { return this._el.type; }
  set type(v) { this.setAttribute("type", v); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get disabled() { return this._el.disabled; }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  get required() { return this._el.required; }
  set required(v) { v ? this.setAttribute("required", "") : this.removeAttribute("required"); }
  get readOnly() { return this._el.readOnly; }
  set readOnly(v) { v ? this.setAttribute("readonly", "") : this.removeAttribute("readonly"); }
  get placeholder() { return this._el.placeholder; }
  set placeholder(v) { this.setAttribute("placeholder", v); }
  get maxLength() { return this._el.maxLength; }
  set maxLength(v) { this.setAttribute("maxlength", v); }
  get min() { return this._el.min; }
  set min(v) { this.setAttribute("min", v); }
  get max() { return this._el.max; }
  set max(v) { this.setAttribute("max", v); }
  get validity() { return this._el.validity; }
  get validationMessage() { return this._el.validationMessage; }
  checkValidity() { this._validate(); return this._el.checkValidity(); }
  reportValidity() { this._validate(); return this._el.reportValidity(); }
  setSelectionRange(...a) { return this._el.setSelectionRange(...a); }
  select() { this._el.select(); }
  focus(opts) { this._el.focus(opts); }
  blur() { this._el.blur(); }
}

define("mono-input", MonoInput);

/* ============================================================
 * <mono-textarea>
 * ============================================================ */

const areaTmpl = document.createElement("template");
areaTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: block; width: 100%; }
    textarea {
      width: 100%; display: block; resize: vertical;
      background: var(--mono-bg);
      border: 1px solid var(--mono-border);
      border-radius: var(--mono-radius-sm);
      color: var(--mono-text);
      font: 500 14px/1.5 var(--mono-font);
      padding: 10px 12px;
      outline: none;
      transition: border-color var(--mono-transition), box-shadow var(--mono-transition);
    }
    textarea::placeholder { color: var(--mono-muted); opacity: 0.65; font-weight: 400; }
    textarea:hover { border-color: color-mix(in srgb, var(--mono-accent) 45%, var(--mono-border)); }
    :host(:focus-within) textarea { border-color: var(--mono-accent); box-shadow: var(--mono-ring); }
    :host([invalid]) textarea { border-color: var(--mono-danger); }
  </style>
  <textarea part="textarea"></textarea>
`;

class MonoTextarea extends MonoElement {
  static formAssociated = true;
  static observedAttributes = [
    "placeholder", "maxlength", "rows", "disabled", "readonly",
    "required", "name", "spellcheck", "value", "aria-label", "aria-labelledby"
  ];

  constructor() {
    super();
    this._root.appendChild(areaTmpl.content.cloneNode(true));
    this._el = this._root.querySelector("textarea");
    this._el.addEventListener("input", () => this._onInput());
    this._el.addEventListener("change", () => this._onChange());
  }

  connectedCallback() { this._sync(); }
  attributeChangedCallback() { this._sync(); }

  _sync() {
    const el = this._el;
    if (!el) return;
    if (this.hasAttribute("rows")) el.rows = numAttr(this, "rows", 3);
    for (const a of ["placeholder", "maxlength"]) {
      const v = this.getAttribute(a);
      if (v === null) el.removeAttribute(a); else el.setAttribute(a, v);
    }
    el.disabled = boolAttr(this, "disabled");
    el.readOnly = boolAttr(this, "readonly");
    el.required = boolAttr(this, "required");
    const name = this.getAttribute("name");
    if (name) el.name = name;
    el.spellcheck = this.getAttribute("spellcheck") !== "false";
    const v = this.getAttribute("value");
    if (v !== null && el.value !== v) el.value = v;
    this._mirrorName(el);
  }

  _onInput() {
    this.internals?.setFormValue(this._el.value);
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.internals?.setValidity(
      this._el.validity.valid ? {} : { valueMissing: true },
      this._el.validationMessage,
      this._el
    );
  }

  _onChange() {
    this.internals?.setFormValue(this._el.value);
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  get value() { return this._el.value; }
  set value(v) { this._el.value = v ?? ""; this.internals?.setFormValue(this._el.value); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get disabled() { return this._el.disabled; }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  get required() { return this._el.required; }
  set required(v) { v ? this.setAttribute("required", "") : this.removeAttribute("required"); }
  get readOnly() { return this._el.readOnly; }
  set readOnly(v) { v ? this.setAttribute("readonly", "") : this.removeAttribute("readonly"); }
  get placeholder() { return this._el.placeholder; }
  set placeholder(v) { this.setAttribute("placeholder", v); }
  get maxLength() { return this._el.maxLength; }
  set maxLength(v) { this.setAttribute("maxlength", v); }
  get rows() { return this._el.rows; }
  set rows(v) { this.setAttribute("rows", v); }
  get validity() { return this._el.validity; }
  checkValidity() { return this._el.checkValidity(); }
  reportValidity() { return this._el.reportValidity(); }
  setSelectionRange(...a) { return this._el.setSelectionRange(...a); }
  select() { this._el.select(); }
  focus(opts) { this._el.focus(opts); }
  blur() { this._el.blur(); }
}

define("mono-textarea", MonoTextarea);

/* ============================================================
 * <mono-select> — mirrors light-DOM <option> children into a
 * native <select> kept in shadow DOM.
 * ============================================================ */

/* The popup lives in the shared layer, outside this shadow root, so these rules
 * are needed in both places. One source, injected twice. */
const OPTION_CSS = `
  .mono-opt {
    display: flex; align-items: center; gap: 9px; padding: 7px 9px;
    border-radius: 7px; cursor: pointer; color: var(--mono-text);
    font: 500 14px/1.35 var(--mono-font);
  }
  .mono-opt:hover { background: var(--mono-bg-hover); }
  .mono-opt[data-active] { background: color-mix(in srgb, var(--mono-accent) 16%, transparent); }
  .mono-opt[aria-selected="true"] { color: var(--mono-accent); }
  .mono-opt[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
  .mono-tick {
    width: 15px; height: 15px; flex: none; border-radius: 4px; display: none;
    place-items: center; border: 1.5px solid var(--mono-border);
    font: 700 11px/1 var(--mono-font);
  }
  [data-multiple] .mono-tick { display: grid; }
  .mono-opt[aria-selected="true"] .mono-tick {
    background: var(--mono-accent); border-color: var(--mono-accent); color: var(--bg, #0d0b1a);
  }
  .mono-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const selectTmpl = document.createElement("template");
selectTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: block; width: 100%; position: relative; }
    :host([width]) { width: var(--mono-w, auto); }
    :host([size]) { width: 100%; }

    button {
      all: unset; box-sizing: border-box;
      display: flex; align-items: center; gap: 8px; width: 100%;
      min-height: 38px; padding: 0 12px; cursor: pointer;
      border: 1px solid var(--mono-border); border-radius: var(--mono-radius-sm);
      background: var(--mono-bg); color: var(--mono-text);
      font: 500 14px/1.4 var(--mono-font);
      transition: border-color var(--mono-transition), box-shadow var(--mono-transition);
    }
    button:hover { border-color: color-mix(in srgb, var(--mono-accent) 45%, var(--mono-border)); }
    button:focus-visible { box-shadow: var(--mono-ring); }
    :host([disabled]) button { cursor: not-allowed; }
    .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .value.placeholder { color: var(--mono-muted); opacity: 0.65; font-weight: 400; }
    .arrow {
      margin-left: auto; flex: none; color: var(--mono-muted);
      font-size: 10px; transition: transform var(--mono-transition);
    }
    button[aria-expanded="true"] .arrow { transform: rotate(180deg); }

    /* size mode replaces the popup with a permanently visible listbox, which is
       what a native <select size> is. Only one select in the panel uses it. */
    .list { display: none; }
    :host([size]) button { display: none; }
    :host([size]) .list {
      display: block; overflow-y: auto; overscroll-behavior: contain;
      padding: 6px; border: 1px solid var(--mono-border);
      border-radius: var(--mono-radius-sm); background: var(--mono-bg);
      min-height: calc(var(--mono-rows, 6) * 36px);
    }
    .list:focus-visible { box-shadow: var(--mono-ring); }

${OPTION_CSS}
  </style>
  <button part="select" type="button">
    <span class="value"></span>
    <span class="arrow" aria-hidden="true">▾</span>
  </button>
  <div class="list" part="list" role="listbox" tabindex="0"></div>
`;

class MonoSelect extends MonoElement {
  static formAssociated = true;
  static observedAttributes = [
    "multiple", "size", "disabled", "required", "name", "width", "rows",
    "aria-label", "aria-labelledby"
  ];

  constructor() {
    super();
    this._root.appendChild(selectTmpl.content.cloneNode(true));
    this._button = this._root.querySelector("button");
    this._listEl = this._root.querySelector(".list");
    this._valueEl = this._root.querySelector(".value");
    this._listId = `mono-listbox-${++selectUid}`;
    this._popup = null;
    this._activeIndex = -1;
    this._open = false;
    this._typeahead = "";
    this._typeaheadTimer = null;
    this._pendingValue = null;

    this._button.addEventListener("click", () => this._toggle());
    this._button.addEventListener("keydown", (e) => this._onKeyDown(e));
    this._listEl.addEventListener("click", (e) => this._onListClick(e));
    this._listEl.addEventListener("keydown", (e) => this._onListKeyDown(e));
    this._listEl.addEventListener("mousemove", (e) => this._onListHover(e));
  }

  connectedCallback() {
    this._sync();
    this._observer = new MutationObserver(() => this._syncOptions());
    this._observer.observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["value", "selected", "disabled"] });
    this._syncOptions();
  }

  disconnectedCallback() {
    this._observer?.disconnect();
    if (this._open) this._close({ focus: false });
  }

  attributeChangedCallback() {
    this._sync();
  }

  _sync() {
    const rows = this.hasAttribute("rows") ? numAttr(this, "rows", 6) : numAttr(this, "size", 6);
    this.style.setProperty("--mono-rows", String(rows));
    const w = this.getAttribute("width");
    if (w) this.style.setProperty("--mono-w", /^\d+$/.test(w) ? `${w}px` : w);
    this._listEl.setAttribute("data-multiple", String(this.multiple));
    this._listEl.toggleAttribute("aria-multiselectable", this.multiple);
    this._syncAria();
    if (this.hasAttribute("size")) this._render();
  }

  /* app.js builds <option> children and marks them with the `selected` and
   * `disabled` *properties*, so those are the source of truth here. The
   * signature check keeps us from rebuilding the popup on every mutation. */
  _syncOptions() {
    const declared = [...this.querySelectorAll(":scope > option")];
    const sig = declared
      .map((d) => `${optValue(d)}\u0000${d.selected ? 1 : 0}\u0000${d.disabled ? 1 : 0}`)
      .join("\u0001");
    if (sig === this._sig) return;
    this._sig = sig;

    const prev = this._pendingValue;
    if (this._activeIndex >= declared.length) this._activeIndex = -1;

    if (this.hasAttribute("size")) {
      this._renderList(this._listEl);
      this._paint();
    }
    if (prev !== null && prev !== undefined) this._applyValue(prev);
    else if (!this.multiple && declared.length) this._applyValue(declared[0]);
    this._syncForm();
    this._render();
  }

  /* Mirrors the native fallback the old implementation relied on: assigning a
   * value that does not exist selects the first option rather than clearing,
   * and a single select with options defaults to the first one. */
  _applyValue(v) {
    const declared = this._declared();
    if (this.multiple) {
      const wanted = Array.isArray(v) ? v.map(String) : [String(v ?? "")];
      for (const o of declared) o.selected = wanted.includes(optValue(o));
      return;
    }
    const target = v == null ? "" : String(v);
    const hit = declared.find((o) => optValue(o) === target && !o.disabled);
    if (hit) {
      for (const o of declared) o.selected = o === hit;
    } else if (target === "") {
      for (const o of declared) o.selected = false;
    } else if (declared.length) {
      for (const o of declared) o.selected = o === declared[0];
    }
  }

  _declared() {
    return [...this.querySelectorAll(":scope > option")];
  }

  get options() {
    return this._declared();
  }

  get selectedOptions() {
    const picked = this._declared().filter((o) => o.selected);
    /* Native single selects are exclusive, so callers that assign
     * option.selected directly expect the previous pick to disappear. The
     * light DOM is normalised on the next render; this reports the observable
     * state straight away. */
    return this.multiple ? picked : picked.slice(-1);
  }

  get selectedIndex() {
    return this._declared().findIndex((o) => o.selected);
  }

  set selectedIndex(v) {
    const declared = this._declared();
    const n = Number(v);
    if (!declared.length) return;
    const pick = declared[n < 0 ? declared.length + n : n];
    if (pick) this._applyValue(optValue(pick));
    this._syncForm();
  }

  _syncForm() {
    if (!this.internals) return;
    /* A disabled control must not submit, exactly like a native one. */
    if (this.disabled) {
      this.internals.setFormValue(null);
      return;
    }
    if (this.multiple) {
      this.internals.setFormValue(this._declared().filter((o) => o.selected).map(optValue));
      return;
    }
    this.internals.setFormValue(this.value);
  }

  /* ---------- rendering ---------- */

  /* A native single select never holds two selected options: setting selected on
 * one deselects the rest. The light-DOM options are now the source of truth
 * rather than a mirror of a native <select>, so that rule has to be enforced
 * here or callers that assign option.selected directly break exclusivity. */
_normalize() {
  if (this.multiple) return;
  const selected = this._declared().filter((o) => o.selected);
  if (selected.length < 2) return;
  const keep = selected[selected.length - 1];
  for (const o of selected) o.selected = o === keep;
}

_render() {
    this._normalize();
    const sel = this.selectedOptions;
    const placeholder = this.getAttribute("placeholder") ?? "";
    let text;
    if (!sel.length) text = placeholder;
    else if (this.multiple) text = sel.map((o) => o.textContent ?? "").join(", ");
    else text = sel[0].textContent ?? "";
    this._valueEl.textContent = text;
    this._valueEl.classList.toggle("placeholder", !sel.length);
    if (this.hasAttribute("size")) this._renderList(this._listEl);
    if (this._popup) {
      this._renderList(this._popup);
      this._paint();
    } else if (this.hasAttribute("size")) {
      this._paint();
    } else {
      this._syncAria();
    }
    this._syncForm();
  }

  _renderList(target) {
    if (!target) return;
    target.textContent = "";
    const frag = document.createDocumentFragment();
    this._declared().forEach((o, i) => {
      frag.append(this._makeOption(o, i, target));
    });
    target.append(frag);
  }

  _makeOption(o, i, list) {
    const el = document.createElement("div");
    el.id = `${this._listId}-${i}`;
    el.className = "mono-opt";
    el.dataset.index = String(i);
    el.setAttribute("role", "option");
    const tick = document.createElement("span");
    tick.className = "mono-tick";
    tick.setAttribute("aria-hidden", "true");
    el.append(tick);
    const label = document.createElement("span");
    label.className = "mono-label";
    label.textContent = o.textContent ?? "";
    el.append(label);
    el.__index = i;
    el.__source = o;
    return el;
  }

  _paint() {
    const list = this._popup ?? (this.hasAttribute("size") ? this._listEl : null);
    if (!list) return;
    for (const el of list.children) {
      const o = el.__source;
      if (!o) continue;
      const active = el.__index === this._activeIndex;
      el.setAttribute("aria-selected", String(Boolean(o.selected)));
      if (o.disabled) el.setAttribute("aria-disabled", "true");
      else el.removeAttribute("aria-disabled");
      if (active) el.setAttribute("data-active", "");
      else el.removeAttribute("data-active");
      const tick = el.firstElementChild;
      if (tick) tick.textContent = o.selected ? "✓" : "";
    }
    this._syncAria();
    const active = list.children[this._activeIndex];
    active?.scrollIntoView?.({ block: "nearest" });
  }

  _syncAria() {
    const btn = this._button;
    const required = this.hasAttribute("required");
    const listMode = this.hasAttribute("size");
    if (listMode) {
      btn.setAttribute("role", "presentation");
      this.removeAttribute("aria-expanded");
      this._listEl.setAttribute("aria-required", String(required));
    } else {
      /* ARIA 1.2 combobox pattern: the role and every state live on the
       * focused element, not on the host, or the two are announced twice. */
      btn.setAttribute("role", "combobox");
      btn.setAttribute("aria-haspopup", "listbox");
      btn.setAttribute("aria-expanded", String(this._open));
      btn.setAttribute("aria-controls", this._listId);
      btn.setAttribute("aria-required", String(required));
      const target = this._popup ?? this._listEl;
      const index = this._activeIndex;
      if (index >= 0 && target?.children[index]) {
        btn.setAttribute("aria-activedescendant", `${this._listId}-${index}`);
      } else {
        btn.removeAttribute("aria-activedescendant");
      }
    }
    if (this.disabled) btn.setAttribute("aria-disabled", "true");
    else btn.removeAttribute("aria-disabled");
    /* Named like every other control here: a host aria-label, written by an
     * author or handed over by <mono-field>, wins. Without one the trigger is
     * named by the selected option it displays, which is not the same thing as
     * the field label -- "general" rather than "Trigger channel". In list mode
     * the trigger is presentation-only, so the listbox is the widget that needs
     * the name. */
    const host = this.getAttribute("aria-label");
    if (host) {
      btn.setAttribute("aria-label", host);
      if (listMode) this._listEl.setAttribute("aria-label", host);
    } else {
      btn.removeAttribute("aria-label");
      if (listMode) this._listEl.removeAttribute("aria-label");
    }
  }

  /* ---------- popup ---------- */

  get open() {
    return this._open;
  }

  _toggle() {
    return this._open ? this._close() : this._openPopup();
  }

  _openPopup() {
    if (this._open || this.disabled || this.hasAttribute("size")) return;
    const declared = this._declared();
    if (!declared.length) return;
    this._open = true;

    const list = document.createElement("div");
    list.id = this._listId;
    list.setAttribute("part", "list");
    list.setAttribute("role", "listbox");
    if (this.multiple) list.setAttribute("aria-multiselectable", "true");
    list.setAttribute("data-multiple", String(this.multiple));
    this._popup = list;
    list.style.cssText = [
      "position:absolute",
      "box-sizing:border-box",
      "overflow-y:auto",
      "overscroll-behavior:contain",
      "padding:6px",
      "border:1px solid var(--mono-border,#3b3382)",
      "border-radius:var(--mono-radius-sm,9px)",
      "background:var(--card-2,#1e1a45)",
      "box-shadow:var(--shadow,0 12px 32px rgb(4 3 14 / 55%))",
      "font:500 14px/1.35 var(--mono-font,Inter,sans-serif)",
      "pointer-events:auto"
    ].join(";");
    this._renderList(list);
    /* The popup has to carry the same click/hover wiring as the size-mode
     * listbox, otherwise its options render but cannot be chosen. */
    list.addEventListener("click", (e) => {
      const el = e.target.closest?.("[data-index]");
      if (el) this._commit(Number(el.dataset.index));
    });
    list.addEventListener("mousemove", (e) => {
      const el = e.target.closest?.("[data-index]");
      if (!el) return;
      const index = Number(el.dataset.index);
      if (index === this._activeIndex) return;
      this._activeIndex = index;
      this._paint();
    });
    popupLayer().shadowRoot.firstElementChild.append(list);
    this._place();

    const at = declared.findIndex((o) => o.selected && !o.disabled);
    this._activeIndex = at >= 0 ? at : declared.findIndex((o) => !o.disabled);
    this._paint();

    this._offOutside = popupOutside({
      anchor: this,
      close: () => this._close()
    });
    this._onScroll = () => this._place();
    window.addEventListener("scroll", this._onScroll, true);
    window.addEventListener("resize", this._onScroll);
  }

  _place() {
    if (!this._popup) return;
    const a = this.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const width = a.width || this._popup.offsetWidth || 180;
    this._popup.style.width = `${Math.round(width)}px`;
    this._popup.style.maxHeight = "320px";
    const height = Math.min(this._popup.offsetHeight || 0, 320);
    let top = a.bottom + 6;
    if (height && top + height > vh - 8 && a.top - 6 - height > 8) top = a.top - 6 - height;
    let left = a.left;
    if (left + width > vw - 8) left = Math.max(8, vw - width - 8);
    this._popup.style.top = `${Math.round(top)}px`;
    this._popup.style.left = `${Math.round(left)}px`;
  }

  _close({ focus = true } = {}) {
    if (!this._open) return;
    this._open = false;
    this._offOutside?.();
    this._offOutside = null;
    window.removeEventListener("scroll", this._onScroll, true);
    window.removeEventListener("resize", this._onScroll);
    clearTimeout(this._typeaheadTimer);
    this._popup?.remove();
    this._popup = null;
    this._paint();
    if (focus) this._button.focus();
  }

  /* ---------- committing ---------- */

  _commit(index) {
    const declared = this._declared();
    const o = declared[index];
    if (!o || o.disabled) return;
    if (this.multiple) {
      o.selected = !o.selected;
      this._render();
      this._emit();
      this._paint();
      return;
    }
    for (const other of declared) other.selected = other === o;
    this._pendingValue = null;
    this._render();
    this._emit();
    this._close();
  }

  _emit() {
    this._syncForm();
    this._onChange();
  }

  _onChange() {
    this._pendingValue = null;
    this._syncForm();
    this.checkValidity();
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  _enabled() {
    return this._declared()
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => !o.disabled);
  }

  _move(step) {
    const enabled = this._enabled();
    if (!enabled.length) return;
    const current = enabled.findIndex(({ i }) => i === this._activeIndex);
    const next = current === -1
      ? (step > 0 ? 0 : enabled.length - 1)
      : (current + step + enabled.length) % enabled.length;
    this._activeIndex = enabled[next].i;
    this._paint();
  }

  _jump(edge) {
    const enabled = this._enabled();
    if (!enabled.length) return;
    this._activeIndex = (edge === "home" ? enabled[0] : enabled[enabled.length - 1]).i;
    this._paint();
  }

  _typeaheadMatch(char) {
    this._typeahead += char.toLowerCase();
    clearTimeout(this._typeaheadTimer);
    this._typeaheadTimer = setTimeout(() => {
      this._typeahead = "";
    }, 600);
    const enabled = this._enabled();
    const from = enabled.findIndex(({ i }) => i === this._activeIndex);
    for (let n = 1; n <= enabled.length; n++) {
      const { o, i } = enabled[(from + n + enabled.length) % enabled.length];
      if ((o.textContent ?? "").toLowerCase().startsWith(this._typeahead)) {
        this._activeIndex = i;
        this._paint();
        return;
      }
    }
  }

  _onKeyDown(e) {
    const { key } = e;
    if (!this._open) {
      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        this._openPopup();
        if (key === "ArrowUp") this._jump("end");
        return;
      }
      if (key === "Home" || key === "End") {
        e.preventDefault();
        this._jump(key === "Home" ? "home" : "end");
        return;
      }
      if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this._typeaheadMatch(key);
      }
      return;
    }
    switch (key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        this._close();
        break;
      case "Tab":
        this._close({ focus: false });
        break;
      case "ArrowDown":
        e.preventDefault();
        this._move(1);
        if (this.multiple) this._commit(this._activeIndex);
        break;
      case "ArrowUp":
        e.preventDefault();
        this._move(-1);
        if (this.multiple) this._commit(this._activeIndex);
        break;
      case "Home":
        e.preventDefault();
        this._jump("home");
        break;
      case "End":
        e.preventDefault();
        this._jump("end");
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        this._commit(this._activeIndex);
        break;
      default:
        if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          this._typeaheadMatch(key);
        }
    }
  }

  /* size mode: a permanently visible listbox driven by the same navigation. */
  _onListClick(e) {
    const el = e.target.closest?.("[data-index]");
    if (!el) return;
    this._commit(Number(el.dataset.index));
  }

  _onListHover(e) {
    const el = e.target.closest?.("[data-index]");
    if (!el) return;
    const index = Number(el.dataset.index);
    if (index === this._activeIndex) return;
    this._activeIndex = index;
    this._paint();
  }

  _onListKeyDown(e) {
    const { key } = e;
    if (key === "ArrowDown") {
      e.preventDefault();
      this._move(1);
    } else if (key === "ArrowUp") {
      e.preventDefault();
      this._move(-1);
    } else if (key === "Home") {
      e.preventDefault();
      this._jump("home");
    } else if (key === "End") {
      e.preventDefault();
      this._jump("end");
    } else if (key === "Enter" || key === " ") {
      e.preventDefault();
      this._commit(this._activeIndex);
    } else if (key === "Escape") {
      this._button.focus();
    }
  }

  /* ---------- API ---------- */
  get value() {
    const sel = this.selectedOptions;
    if (!sel.length) return "";
    return optValue(sel[0]);
  }
  set value(v) {
    this._pendingValue = v;
    /* the value may be assigned before the matching <option> exists */
    this._applyValue(v);
    this._render();
    this._syncForm();
  }
  get values() {
    return this._declared().filter((o) => o.selected).map(optValue);
  }
  set values(v) {
    this._pendingValue = Array.isArray(v) ? v.map(String) : [String(v)];
    this._applyValue(this._pendingValue);
    this._render();
    this._syncForm();
  }
  get multiple() { return boolAttr(this, "multiple"); }
  set multiple(v) { v ? this.setAttribute("multiple", "") : this.removeAttribute("multiple"); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get disabled() { return boolAttr(this, "disabled"); }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  get required() { return boolAttr(this, "required"); }
  set required(v) { v ? this.setAttribute("required", "") : this.removeAttribute("required"); }
  get validity() {
    const ok = !this.hasAttribute("required") || this.selectedOptions.length > 0;
    return {
      valid: ok,
      valueMissing: !ok,
      customError: Boolean(this._customMessage)
    };
  }
  checkValidity() {
    /* Validity has to reach the internals, not just the ARIA attribute, or a
     * real <form> never learns that the control is invalid. */
    const missing = this.hasAttribute("required") && this.selectedOptions.length === 0;
    const ok = !missing && !this._customMessage;
    if (ok) {
      this._button.removeAttribute("aria-invalid");
      this.internals?.setValidity?.({});
    } else {
      this._button.setAttribute("aria-invalid", "true");
      this.internals?.setValidity?.(
        missing ? { valueMissing: true } : { customError: true },
        this._customMessage ?? "",
        this._button
      );
    }
    return ok;
  }
  setCustomValidity(msg) {
    this._customMessage = msg || "";
    this.checkValidity();
  }
  formDisabledCallback(disabled) {
    this.toggleAttribute("disabled", disabled);
    this._syncForm();
  }
  formResetCallback() {
    const declared = this._declared();
    for (const o of declared) o.selected = o.defaultSelected;
    this._activeIndex = -1;
    this._render();
  }
  formStateRestoreCallback(state) {
    if (state) this.value = state;
  }
  focus(opts) { this._button.focus(opts); }
  blur() { this._button.blur(); }
}

const el_validity = (el) => !el.required || (el.multiple ? el.selectedOptions.length > 0 : el.value !== "");

define("mono-select", MonoSelect);

/* ============================================================
 * <mono-checkbox>
 * ============================================================ */

const checkTmpl = document.createElement("template");
checkTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: inline-flex; }
    /* No native <label for> association and no labelable descendant inside the
     * label, so a click here produces exactly one event for the host to act
     * on. The old version needed stopPropagation to avoid a double toggle. */
    label {
      display: inline-flex; align-items: center; gap: 9px;
      cursor: pointer; user-select: none;
    }
    .ctl { display: inline-flex; align-items: center; outline: none; }
    .ctl:focus-visible .box { box-shadow: var(--mono-ring); }
    .box {
      position: relative; flex: none;
      width: 19px; height: 19px; border-radius: 6px;
      border: 2px solid var(--mono-border);
      background: var(--mono-bg);
      display: grid; place-items: center;
      transition: background var(--mono-transition), border-color var(--mono-transition),
                  transform var(--mono-transition);
    }
    :host(:hover) .box { border-color: var(--mono-accent); }
    :host([checked]) .box { background: var(--mono-accent); border-color: var(--mono-accent); }
    :host([checked]:active) .box { transform: scale(0.9); }
    .tick { width: 11px; height: 11px; opacity: 0; transform: scale(0.4);
            transition: opacity var(--mono-transition), transform var(--mono-transition); }
    :host([checked]) .tick { opacity: 1; transform: scale(1); }
    :host([indeterminate]) .tick { opacity: 1; transform: scale(1); }
    .dash { width: 10px; height: 2px; border-radius: 1px; background: var(--mono-accent); display: none; }
    :host([indeterminate]) .dash { display: block; }
    :host([indeterminate]) .tick { display: none; }
    .txt { color: inherit; font: inherit; line-height: 1.4; }
    /* the slotted caption is light-DOM content, so it picks up the page's
     * .check / .check.off styling; mirror that for the strikethrough state
     * because text-decoration cannot be inherited in from the host */
    :host(.off) ::slotted(*) { text-decoration: line-through; }
  </style>
  <label>
    <span class="ctl" part="control" role="checkbox" tabindex="0">
      <span class="box">
        <svg class="tick" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="none" stroke="var(--on-accent, #0b1030)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M4 12.5l5.5 5.5L20 6.5"/>
        </svg>
        <span class="dash" aria-hidden="true"></span>
      </span>
    </span>
    <span class="txt"><slot></slot></span>
  </label>
`;

class MonoCheckbox extends MonoElement {
  static formAssociated = true;
  static observedAttributes = ["checked", "disabled", "name", "value", "required", "indeterminate"];

  constructor() {
    super();
    this._root.appendChild(checkTmpl.content.cloneNode(true));
    this._ctl = this._root.querySelector(".ctl");

    /* One delegated handler for the whole control. A click on the box, on the
     * caption, or on the host itself all arrive here exactly once, so a toggle
     * can never happen twice. */
    this.addEventListener("click", () => {
      if (this.disabled) return;
      this._activate();
    });

    this._ctl.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (this.disabled) return;
      this._activate();
    });
  }

  /* Any deliberate interaction settles the mixed state first, the way clicking
   * a native checkbox in its indeterminate state clears the dash. */
  _activate() {
    this.indeterminate = false;
    this.checked = !this.checked;
    this._onChange();
  }

  connectedCallback() { this._sync(); }
  attributeChangedCallback(name) { this._sync(name); }

  _sync() {
    this._ctl.setAttribute("aria-checked", this._indeterminate ? "mixed" : String(this.checked));
    if (this.hasAttribute("required")) this._ctl.setAttribute("aria-required", "true");
    else this._ctl.removeAttribute("aria-required");
    if (this.disabled) this._ctl.setAttribute("aria-disabled", "true");
    else this._ctl.removeAttribute("aria-disabled");
    /* The slotted caption sits outside the control, so the accessible name has
     * to be supplied explicitly. */
    /* A host aria-label -- written by an author, or handed over by
     * <mono-field> -- wins. Without one the slotted caption names it, which is
     * how these controls were labelled before fields started handing names
     * down. */
    const host = this.getAttribute("aria-label");
    if (host) this._ctl.setAttribute("aria-label", host);
    else {
      const text = (this.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) this._ctl.setAttribute("aria-label", text);
      else this._ctl.removeAttribute("aria-label");
    }
    this._syncForm();
  }

  _onChange() {
    this._sync();
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  _syncForm() {
    const value = this.getAttribute("value") ?? "on";
    this.internals?.setFormValue(
      this.disabled || !this.checked ? null : value
    );
    const missing = this.hasAttribute("required") && !this.checked;
    this.internals?.setValidity?.(
      missing ? { valueMissing: true } : {},
      missing ? "Please tick this box" : "",
      this._ctl
    );
  }

  get checked() { return this.hasAttribute("checked"); }
  set checked(v) {
    v ? this.setAttribute("checked", "") : this.removeAttribute("checked");
  }
  get value() { return this.getAttribute("value") ?? "on"; }
  set value(v) { this.setAttribute("value", v); }
  get indeterminate() { return this._indeterminate === true; }
  set indeterminate(v) {
    this._indeterminate = Boolean(v);
    v ? this.setAttribute("indeterminate", "") : this.removeAttribute("indeterminate");
  }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get disabled() { return boolAttr(this, "disabled"); }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  get required() { return boolAttr(this, "required"); }
  set required(v) { v ? this.setAttribute("required", "") : this.removeAttribute("required"); }
  get validity() {
    const missing = this.hasAttribute("required") && !this.checked;
    return { valid: !missing, valueMissing: missing, customError: false };
  }
  checkValidity() {
    this._syncForm();
    const ok = !this.validity.valueMissing;
    /* The invalid state has to be visible to assistive tech, not just held in
     * the form internals. */
    if (ok) this._ctl.removeAttribute("aria-invalid");
    else this._ctl.setAttribute("aria-invalid", "true");
    return ok;
  }
  reportValidity() {
    const ok = this.checkValidity();
    if (!ok) this._ctl.focus();
    return ok;
  }
  focus(opts) { this._ctl.focus(opts); }
  blur() { this._ctl.blur(); }
}

define("mono-checkbox", MonoCheckbox);

/* ============================================================
 * <mono-button>
 * ============================================================ */

const btnTmpl = document.createElement("template");
btnTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: inline-flex; }
    :host([full]) { display: flex; width: 100%; }
    :host([block]) { display: flex; width: 100%; }
    button {
      all: unset; box-sizing: border-box;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      width: 100%; cursor: pointer;
      padding: 10px 18px;
      border-radius: var(--mono-radius-sm);
      border: 1px solid var(--mono-border);
      background: var(--mono-bg);
      color: var(--mono-text);
      font: 600 14px/1.2 var(--mono-font);
      text-align: center; white-space: nowrap;
      transition: background var(--mono-transition), border-color var(--mono-transition),
                  transform var(--mono-transition), box-shadow var(--mono-transition),
                  color var(--mono-transition);
    }
    button:hover { background: var(--mono-bg-hover); border-color: var(--mono-border); }
    button:active { transform: translateY(1px); }
    button:focus-visible { outline: none; border-color: var(--mono-accent); box-shadow: var(--mono-ring); }
    :host([small]) button { padding: 7px 12px; font-size: 12.5px; }
    :host([large]) button { padding: 13px 22px; font-size: 15px; }

    :host([variant="primary"]) button {
      background: var(--mono-accent); border-color: var(--mono-accent); color: var(--mono-on-accent);
    }
    :host([variant="primary"]) button:hover {
      background: var(--accent-hover, color-mix(in srgb, var(--mono-accent) 82%, white));
      border-color: var(--mono-accent);
      /* the one place violet carries weight: the glow on the main action */
      box-shadow: 0 6px 20px var(--mono-glow-violet);
    }
    :host([variant="danger"]) button {
      background: color-mix(in srgb, var(--mono-danger) 16%, transparent);
      border-color: color-mix(in srgb, var(--mono-danger) 45%, transparent);
      color: var(--mono-danger);
    }
    :host([variant="danger"]) button:hover {
      background: var(--mono-danger); border-color: var(--mono-danger); color: var(--mono-on-danger);
    }
    :host([variant="success"]) button {
      background: color-mix(in srgb, var(--mono-green) 16%, transparent);
      border-color: color-mix(in srgb, var(--mono-green) 45%, transparent);
      color: var(--mono-green);
    }
    :host([variant="success"]) button:hover { background: var(--mono-green); color: var(--mono-on-success); }
    :host([variant="ghost"]) button { background: none; border-color: transparent; color: var(--mono-muted); }
    :host([variant="ghost"]) button:hover { background: var(--mono-bg); color: var(--mono-text); }
    :host([variant="discord"]) button {
      background: var(--discord, #5865f2); border-color: var(--discord, #5865f2);
      color: var(--mono-on-discord);
    }
    :host([variant="discord"]) button:hover {
      background: var(--discord-hover, #4752c4); border-color: var(--discord-hover, #4752c4);
    }
    :host([loading]) button { opacity: 0.6; pointer-events: none; }
    ::slotted([slot="icon"]) { display: inline-flex; }

    /* bare mode: the host carries the page's own styling (nav tabs, icon
     * buttons) and the inner button is only the hit target. */
    :host([bare]) { display: inline-flex; }
    :host([bare][full]) { display: flex; }
    :host([bare]) button {
      padding: 0; border: 0; background: none; border-radius: 0;
      font: inherit; color: inherit; width: 100%; height: 100%;
      gap: inherit;
    }
    :host([bare]) button:hover { background: none; }
    :host([bare]) button:active { transform: none; }
    /* Deliberately NOT outline:none here. The page's own :focus-visible rule is
     * a document-level selector, so it cannot reach into this shadow root, and
     * these buttons hold every nav tab and icon trigger in the dashboard --
     * killing the indicator left keyboard users tabbing blind. Matches the page
     * treatment (2px accent, 2px offset) instead. */
    :host([bare]) button:focus-visible {
      outline: 2px solid var(--mono-accent); outline-offset: 2px;
    }
  </style>
  <button part="button"><slot name="icon"></slot><slot></slot></button>
`;

class MonoButton extends MonoElement {
  static formAssociated = true;
  static observedAttributes = ["variant", "disabled", "type", "loading", "bare", "aria-label"];

  constructor() {
    super();
    this._root.appendChild(btnTmpl.content.cloneNode(true));
    this._el = this._root.querySelector("button");
    /* The inner button already produces a composed click that crosses the
     * shadow boundary, so listeners on the host see exactly one event. We only
     * add behaviour here: submit/reset the owning form, and keep the inner
     * button from ever entering the tab order twice. */
    this._el.addEventListener("click", (e) => this._onClick(e));
  }

  connectedCallback() { this._sync(); }
  attributeChangedCallback() { this._sync(); }

  _onClick(e) {
    if (boolAttr(this, "disabled") || boolAttr(this, "loading")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const type = this.getAttribute("type") || "button";
    if (type !== "submit" && type !== "reset") return;
    /* A shadow-DOM button has no form owner, so submission is done by hand. */
    const form = this._internals?.form ?? this.closest("form");
    if (!form) return;
    e.preventDefault();
    if (type === "reset") form.reset();
    else form.requestSubmit();
  }

  _sync() {
    const el = this._el;
    if (!el) return;
    el.type = "button"; /* never let the inner button submit on its own */
    el.disabled = boolAttr(this, "disabled");
    if (boolAttr(this, "loading")) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
    this._syncName();
  }

  /* A bare button draws itself from the host's own styling, which means its
   * label usually lives on the host too: every nav tab and icon trigger in the
   * dashboard puts aria-label there. The inner <button> is what assistive tech
   * actually reports, and a slotted aria-hidden icon gives it no name at all, so
   * the host's label has to be pushed down onto it. */
  _syncName() { this._mirrorName(this._el); }

  get disabled() { return boolAttr(this, "disabled"); }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  get type() { return this.getAttribute("type") || "button"; }
  set type(v) { this.setAttribute("type", v); }
  get variant() { return this.getAttribute("variant") || "default"; }
  set variant(v) { this.setAttribute("variant", v); }
  get loading() { return boolAttr(this, "loading"); }
  set loading(v) { v ? this.setAttribute("loading", "") : this.removeAttribute("loading"); }
  focus(opts) { this._el.focus(opts); }
  blur() { this._el.blur(); }
}

define("mono-button", MonoButton);

/* ============================================================
 * <mono-field> — label + control layout helper
 * ============================================================ */

const fieldTmpl = document.createElement("template");
fieldTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    :host([col]) { flex-direction: column; align-items: stretch; gap: 6px; }
    :host([grow]) { flex: 1 1 200px; }
    :host([right]) { justify-content: flex-end; }
    :host([between]) { justify-content: space-between; }
    label {
      font: 600 12.5px/1.3 var(--mono-font);
      color: var(--mono-muted);
      letter-spacing: 0.03em; text-transform: uppercase;
      white-space: nowrap; flex: none;
    }
    :host([col]) label { padding-left: 2px; }
    .body { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
    :host([col]) .body { width: 100%; }
    ::slotted(*) { min-width: 0; }
    .hint {
      flex-basis: 100%;
      font: 500 12px/1.35 var(--mono-font);
      color: var(--mono-muted); opacity: 0.85;
    }
    .hint[hidden] { display: none; }
  </style>
  <label part="label"><slot name="label"></slot></label>
  <div class="body"><slot></slot></div>
  <div class="hint" part="hint" hidden></div>
`;

class MonoField extends MonoElement {
  static observedAttributes = ["label", "hint"];
  constructor() {
    super();
    this._root.appendChild(fieldTmpl.content.cloneNode(true));
    /* The <label> and the control it names live in different shadow roots, so
     * there is no native label/for association and no implicit wrapping to fall
     * back on. Both halves of that have to be wired up by hand. */
    this._root.querySelector("label").addEventListener("click", () => this._focusControl());
  }
  connectedCallback() {
    const l = this._root.querySelector("label");
    const v = this.getAttribute("label");
    if (v !== null) l.textContent = v;
    l.hidden = v === null;
    const h = this._root.querySelector(".hint");
    const hv = this.getAttribute("hint");
    if (hv !== null) h.textContent = hv;
    h.hidden = hv === null;
    this._syncName();
    /* A field's control is usually not there yet when the field connects: the
     * parser inserts <mono-field> before it has parsed the child, and app.js
     * builds most fields at runtime by appending a control afterwards. Without
     * watching for children, the label would never reach the control. */
    if (!this._watch) {
      this._watch = new MutationObserver(() => this._syncName());
      this._watch.observe(this, { childList: true });
    }
  }
  disconnectedCallback() {
    this._watch?.disconnect();
    this._watch = null;
  }
  attributeChangedCallback() { this.connectedCallback(); }

  _control() {
    return this.querySelector(
      "mono-input, mono-textarea, mono-search, mono-select, mono-checkbox, mono-switch"
    );
  }

  /* Hand the visible label to the control as its accessible name. Only a label
   * this field set itself is ever taken back off again, so an aria-label the
   * author wrote directly on the control survives both a rename and a removal. */
  _syncName() {
    const label = this.getAttribute("label");
    if (this._labelled && this._labelled.getAttribute("aria-label") === this._setLabel) {
      this._labelled.removeAttribute("aria-label");
      this._labelled = null;
    }
    const ctl = this._control();
    if (!label || !ctl || ctl.hasAttribute("aria-label")) return;
    ctl.setAttribute("aria-label", label);
    this._labelled = ctl;
    this._setLabel = label;
  }

  _focusControl() {
    this._control()?.focus();
  }

  get label() { return this.getAttribute("label") || ""; }
  set label(v) { this.setAttribute("label", v); }
  get hint() { return this.getAttribute("hint") || ""; }
  set hint(v) { this.setAttribute("hint", v); }
}
define("mono-field", MonoField);

/* ============================================================
 * <mono-search> — search input with icon and result counter
 * ============================================================ */

const searchTmpl = document.createElement("template");
searchTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: block; width: 100%; }
    .wrap {
      display: flex; align-items: center; gap: 10px;
      background: var(--mono-bg);
      border: 1px solid var(--mono-border);
      border-radius: var(--mono-radius);
      padding: 0 14px;
      transition: border-color var(--mono-transition), box-shadow var(--mono-transition);
    }
    .wrap:hover { border-color: color-mix(in srgb, var(--mono-accent) 40%, var(--mono-border)); }
    :host(:focus-within) .wrap { border-color: var(--mono-accent); box-shadow: var(--mono-ring); }
    .ico { color: var(--mono-muted); font-size: 17px; flex: none; }
    :host(:focus-within) .ico { color: var(--mono-accent); }
    input {
      flex: 1; min-width: 0;
      background: none; border: 0; outline: none; color: var(--mono-text);
      font: 500 14.5px/1.4 var(--mono-font); padding: 12px 0;
    }
    input::placeholder { color: var(--mono-muted); opacity: 0.6; }
    kbd {
      font: 700 11px/1 var(--mono-mono); color: var(--mono-muted);
      border: 1px solid var(--mono-border); border-radius: 5px;
      padding: 4px 6px; background: var(--mono-bg-hover); flex: none;
    }
    .count {
      font: 700 11.5px/1 var(--mono-mono); color: var(--mono-accent);
      background: color-mix(in srgb, var(--mono-accent) 14%, transparent);
      border-radius: 20px; padding: 5px 9px; flex: none;
    }
    .count:empty { display: none; }
  </style>
  <div class="wrap">
    <span class="ico" aria-hidden="true">⌕</span>
    <input part="input" type="search" autocomplete="off" spellcheck="false" />
    <span class="count" part="count"></span>
    <kbd aria-hidden="true">/</kbd>
  </div>
`;

class MonoSearch extends MonoElement {
  static formAssociated = true;
  static observedAttributes = [
    "placeholder", "value", "disabled", "name", "aria-label", "aria-labelledby"
  ];

  constructor() {
    super();
    this._root.appendChild(searchTmpl.content.cloneNode(true));
    this._el = this._root.querySelector("input");
    this._count = this._root.querySelector(".count");
    this._el.addEventListener("input", () => {
      this.internals?.setFormValue(this._el.value);
      this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    });
  }

  connectedCallback() {
    const p = this.getAttribute("placeholder");
    if (p) this._el.placeholder = p;
    this._el.disabled = boolAttr(this, "disabled");
    const v = this.getAttribute("value");
    if (v !== null) this._el.value = v;
    const n = this.getAttribute("name");
    if (n) this._el.name = n;
    this._mirrorName(this._el);
  }
  attributeChangedCallback(name) {
    if (name === "placeholder" && this._el) this._el.placeholder = this.getAttribute("placeholder") ?? "";
    if (name === "value" && this._el && this._el.value !== this.getAttribute("value"))
      this._el.value = this.getAttribute("value") ?? "";
    this._mirrorName(this._el);
  }

  get value() { return this._el.value; }
  set value(v) { this._el.value = v ?? ""; this.internals?.setFormValue(this._el.value); }
  set count(v) { this._count.textContent = v == null || v === "" ? "" : String(v); }
  get count() { return this._count.textContent; }
  get disabled() { return this._el.disabled; }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  focus(opts) { this._el.focus(opts); }
  blur() { this._el.blur(); }
  select() { this._el.select(); }
}
define("mono-search", MonoSearch);

/* ============================================================
 * <mono-switch> — labelled on/off toggle
 * ============================================================ */

const switchTmpl = document.createElement("template");
switchTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
    .track {
      position: relative; flex: none;
      width: 42px; height: 24px; border-radius: 20px;
      background: var(--card-3, #262157);
      border: 1px solid var(--mono-border);
      transition: background var(--mono-transition), border-color var(--mono-transition);
    }
    .knob {
      position: absolute; top: 2px; left: 2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--mono-muted);
      transition: transform var(--mono-transition), background var(--mono-transition);
    }
    :host([checked]) .track { background: color-mix(in srgb, var(--mono-accent) 30%, transparent); border-color: var(--mono-accent); }
    :host([checked]) .knob { transform: translateX(18px); background: var(--mono-accent); }
    :host(:focus-within) .track { box-shadow: var(--mono-ring); }
    label { font: 500 14px/1.4 var(--mono-font); cursor: pointer; }
    /* Nothing inside the label is labelable, so a click on it produces a single
     * event and the host handler below does the one toggle. */
    .ctl { display: inline-flex; align-items: center; outline: none; flex: none; }
  </style>
  <label>
    <span class="ctl" part="control" role="switch" tabindex="0">
      <span class="track"><span class="knob"></span></span>
    </span>
    <span><slot></slot></span>
  </label>
`;

class MonoSwitch extends MonoElement {
  static formAssociated = true;
  static observedAttributes = [
    "checked", "disabled", "name", "value", "aria-label", "aria-labelledby"
  ];

  constructor() {
    super();
    this._root.appendChild(switchTmpl.content.cloneNode(true));
    this._ctl = this._root.querySelector(".ctl");

    /* Single delegated handler: a click anywhere on the control arrives here
     * once, so the toggle cannot run twice. */
    this.addEventListener("click", () => {
      if (this.disabled) return;
      this.checked = !this.checked;
      this._onChange();
    });

    this._ctl.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (this.disabled) return;
      this.checked = !this.checked;
      this._onChange();
    });
  }

  connectedCallback() { this._sync(); }
  attributeChangedCallback() { this._sync(); }

  _sync() {
    this._ctl.setAttribute("aria-checked", String(this.checked));
    if (this.disabled) this._ctl.setAttribute("aria-disabled", "true");
    else this._ctl.removeAttribute("aria-disabled");
    /* The caption is slotted outside the control, so name it explicitly. */
    /* A host aria-label -- written by an author, or handed over by
     * <mono-field> -- wins. Without one the slotted caption names it, which is
     * how these controls were labelled before fields started handing names
     * down. */
    const host = this.getAttribute("aria-label");
    if (host) this._ctl.setAttribute("aria-label", host);
    else {
      const text = (this.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) this._ctl.setAttribute("aria-label", text);
      else this._ctl.removeAttribute("aria-label");
    }
    this._syncForm();
  }

  _syncForm() {
    const value = this.getAttribute("value") ?? "on";
    this.internals?.setFormValue(this.disabled || !this.checked ? null : value);
  }

  _onChange() {
    this._sync();
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  get checked() { return boolAttr(this, "checked"); }
  set checked(v) {
    v ? this.setAttribute("checked", "") : this.removeAttribute("checked");
  }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get value() { return this.getAttribute("value") ?? "on"; }
  set value(v) { this.setAttribute("value", v); }
  get disabled() { return boolAttr(this, "disabled"); }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  checkValidity() { return true; }
  focus(opts) { this._ctl.focus(opts); }
  blur() { this._ctl.blur(); }
}
define("mono-switch", MonoSwitch);

/* ============================================================
 * <mono-badge>
 * ============================================================ */

const badgeTmpl = document.createElement("template");
badgeTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 9px; border-radius: 20px;
      font: 700 11.5px/1.4 var(--mono-mono);
      background: var(--mono-bg-hover); color: var(--mono-muted);
      border: 1px solid var(--mono-border);
      white-space: nowrap;
    }
    :host([tone="accent"]) { background: color-mix(in srgb, var(--mono-accent) 16%, transparent); color: var(--mono-accent); border-color: color-mix(in srgb, var(--mono-accent) 40%, transparent); }
    :host([tone="success"]) { background: color-mix(in srgb, var(--mono-green) 16%, transparent); color: var(--mono-green); border-color: color-mix(in srgb, var(--mono-green) 40%, transparent); }
    :host([tone="danger"]) { background: color-mix(in srgb, var(--mono-danger) 16%, transparent); color: var(--mono-danger); border-color: color-mix(in srgb, var(--mono-danger) 40%, transparent); }
    :host([on])::before {
      content: ""; width: 6px; height: 6px; border-radius: 50%;
      background: currentColor; box-shadow: 0 0 8px currentColor;
    }
  </style>
  <slot></slot>
`;

class MonoBadge extends MonoElement {
  static observedAttributes = ["tone", "on"];
  constructor() {
    super();
    this._root.appendChild(badgeTmpl.content.cloneNode(true));
  }
}
define("mono-badge", MonoBadge);

/* ============================================================
 * <mono-avatar>
 * ============================================================ */

const avatarTmpl = document.createElement("template");
avatarTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host {
      display: inline-grid; place-items: center; flex: none;
      width: var(--size, 34px); height: var(--size, 34px);
      border-radius: 50%; overflow: hidden;
      background: var(--mono-bg-hover);
      border: 1px solid var(--mono-border);
      font: 700 calc(var(--size, 34px) * 0.4)/1 var(--mono-font);
      color: var(--mono-muted);
    }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
    img[hidden] { display: none; }
  </style>
  <span part="initials"></span>
  <img part="img" alt="" hidden />
`;

class MonoAvatar extends MonoElement {
  static observedAttributes = ["src", "name", "size"];
  constructor() {
    super();
    this._root.appendChild(avatarTmpl.content.cloneNode(true));
    this._img = this._root.querySelector("img");
    this._ini = this._root.querySelector("span");
  }
  connectedCallback() { this._sync(); }
  attributeChangedCallback() { this._sync(); }
  _sync() {
    const size = this.getAttribute("size");
    if (size) this.style.setProperty("--size", /^\d+$/.test(size) ? `${size}px` : size);
    const src = this.getAttribute("src") || "";
    const name = this.getAttribute("name") || "";
    if (src) {
      this._img.src = src;
      this._img.hidden = false;
      this._ini.textContent = "";
    } else {
      this._img.hidden = true;
      this._ini.textContent = name
        ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
        : "?";
    }
  }
  get src() { return this.getAttribute("src") || ""; }
  set src(v) { v ? this.setAttribute("src", v) : this.removeAttribute("src"); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
}
define("mono-avatar", MonoAvatar);

/* ============================================================
 * <mono-progress>
 * ============================================================ */

const progressTmpl = document.createElement("template");
progressTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host {
      display: block; width: 100%; height: 8px;
      background: var(--mono-bg-hover); border-radius: 20px; overflow: hidden;
    }
    .bar {
      height: 100%; width: var(--pct, 0%);
      background: linear-gradient(90deg, var(--mono-accent), color-mix(in srgb, var(--mono-accent) 55%, var(--mono-green)));
      border-radius: 20px;
      transition: width 320ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    :host([tone="success"]) .bar { background: var(--mono-green); }
    :host([tone="danger"]) .bar { background: var(--mono-danger); }
    :host([indeterminate]) .bar { width: 40%; animation: slide 1.1s ease-in-out infinite; }
    @keyframes slide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
  </style>
  <div class="bar" part="bar"></div>
`;

class MonoProgress extends MonoElement {
  static observedAttributes = ["value", "max", "tone", "indeterminate"];
  constructor() {
    super();
    this._root.appendChild(progressTmpl.content.cloneNode(true));
  }
  connectedCallback() { this._sync(); }
  attributeChangedCallback() { this._sync(); }
  _sync() {
    if (boolAttr(this, "indeterminate")) return;
    const max = numAttr(this, "max", 100) || 100;
    const pct = Math.max(0, Math.min(100, (numAttr(this, "value", 0) / max) * 100));
    this.style.setProperty("--pct", `${pct}%`);
  }
  get value() { return numAttr(this, "value", 0); }
  set value(v) { this.setAttribute("value", v); }
  get max() { return numAttr(this, "max", 100); }
  set max(v) { this.setAttribute("max", v); }
}
define("mono-progress", MonoProgress);

/* ============================================================
 * <mono-toast>
 * ============================================================ */

const toastTmpl = document.createElement("template");
toastTmpl.innerHTML = `
  <style>
    :host {
      position: fixed; left: 50%; bottom: 26px; z-index: 9999;
      transform: translate(-50%, 0);
      display: block; pointer-events: none;
      visibility: visible;
      transition: transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity 220ms ease,
                  visibility 0s linear 0s;
      opacity: 1;
    }
    :host([hidden]) {
      display: block !important;
      opacity: 0; transform: translate(-50%, 24px);
      /* opacity alone is not enough: a dismissed toast would stay in the
       * accessibility tree and still turn up in find-in-page. visibility is
       * delayed until the fade finishes so the exit still animates. */
      visibility: hidden;
      transition: transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity 220ms ease,
                  visibility 0s linear 220ms;
    }
    .box {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 20px; border-radius: 12px;
      background: var(--card-3, #262157);
      border: 1px solid var(--border-strong, #3b3382);
      box-shadow: var(--shadow, 0 8px 24px rgb(4 3 14 / 55%));
      color: var(--text, #ffffff);
      font: 600 14px/1.3 var(--font, "Inter", system-ui, sans-serif);
      max-width: min(92vw, 460px);
    }
    :host([tone="error"]) .box { border-color: var(--coral, #fb7185); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #7cd4fd); flex: none;
           box-shadow: 0 0 10px var(--accent, #7cd4fd); }
    :host([tone="error"]) .dot { background: var(--coral, #fb7185); box-shadow: 0 0 10px var(--coral, #fb7185); }
  </style>
  <div class="box" part="box" role="status" aria-live="polite" aria-atomic="true">
    <span class="dot" aria-hidden="true"></span><span id="msg"></span>
  </div>
`;

class MonoToast extends MonoElement {
  static observedAttributes = ["tone"];
  constructor() {
    super();
    this._root.appendChild(toastTmpl.content.cloneNode(true));
    this._msg = this._root.querySelector("#msg");
    this._timer = null;
  }
  static show(message, tone = "info", ms = 3200) {
    let el = document.querySelector("mono-toast");
    if (!el) {
      el = document.createElement("mono-toast");
      document.body.appendChild(el);
    }
    el.show(message, tone, ms);
    return el;
  }
  show(message, tone = "info", ms = 3200) {
    this._msg.textContent = message;
    if (tone === "error") this.setAttribute("tone", "error");
    else this.removeAttribute("tone");
    this.hidden = false;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.hidden = true; }, ms);
  }
  hide() { this.hidden = true; clearTimeout(this._timer); }
}
define("mono-toast", MonoToast);

/* ============================================================
 * <mono-modal>
 * ============================================================ */

const modalTmpl = document.createElement("template");
modalTmpl.innerHTML = `
  <style>
    :host {
      position: fixed; inset: 0; z-index: 9000;
      display: grid; place-items: center; padding: 20px;
      background: rgb(4 3 14 / 72%);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: fade 180ms ease;
    }
    :host([hidden]) { display: none !important; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes rise { from { opacity: 0; transform: translateY(18px) scale(0.97); } to { opacity: 1; transform: none; } }
    .panel {
      width: 100%; max-width: var(--max, 460px); max-height: 88vh; overflow: auto;
      background: var(--card, #171434);
      border: 1px solid var(--border-strong, #3b3382);
      border-radius: 18px;
      box-shadow: var(--shadow, 0 8px 24px rgb(4 3 14 / 55%));
      animation: rise 220ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
    }
    .head {
      display: flex; align-items: center; gap: 12px;
      padding: 18px 20px 12px;
    }
    .head h2, .head h3 { margin: 0; font: 800 18px/1.3 "Inter", system-ui, sans-serif; flex: 1; }
    .x {
      all: unset; cursor: pointer; color: var(--muted, #a49dd6);
      width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px;
      transition: background 140ms, color 140ms;
    }
    .x:hover { background: var(--card-3, #262157); color: var(--text, #ffffff); }
    .body { padding: 0 20px 18px; display: grid; gap: 12px; }
    .foot {
      display: flex; gap: 10px; justify-content: flex-end;
      padding: 14px 20px 18px; border-top: 1px solid var(--border, #2a2460);
    }
  </style>
  <div class="panel" part="panel" role="dialog" aria-modal="true">
    <div class="head">
      <slot name="title"></slot>
      <button class="x" part="close" aria-label="Close">✕</button>
    </div>
    <div class="body"><slot></slot></div>
    <div class="foot"><slot name="footer"></slot></div>
  </div>
`;

class MonoModal extends MonoElement {
  constructor() {
    super();
    this._root.appendChild(modalTmpl.content.cloneNode(true));
    this._x = this._root.querySelector(".x");
    this._onKey = (e) => { if (e.key === "Escape" && !this.hidden) this.close(); };
  }
  connectedCallback() {
    if (!this.hasAttribute("hidden")) {
      document.addEventListener("keydown", this._onKey);
      document.body.style.overflow = "hidden";
    }
    this._x.addEventListener("click", () => this.close());
    this._root.addEventListener("click", (e) => { if (e.target === this._root) this.close(); });
  }
  disconnectedCallback() {
    document.removeEventListener("keydown", this._onKey);
    document.body.style.overflow = "";
  }
  attributeChangedCallback(name, oldV, newV) {
    if (name !== "hidden" || oldV === newV) return;
    if (newV === null) {
      document.addEventListener("keydown", this._onKey);
      document.body.style.overflow = "hidden";
    } else {
      document.removeEventListener("keydown", this._onKey);
      document.body.style.overflow = "";
    }
  }
  open() { this.hidden = false; }
  close() {
    this.hidden = true;
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }
}
define("mono-modal", MonoModal);

/* ============================================================
 * <mono-card>
 * ============================================================ */

const cardTmpl = document.createElement("template");
cardTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host {
      display: block;
      background: var(--card, #171434);
      border: 1px solid var(--border, #2a2460);
      border-radius: var(--radius, 16px);
      padding: 20px;
      transition: border-color var(--mono-transition), box-shadow var(--mono-transition);
    }
    :host([interactive]:hover) {
      border-color: color-mix(in srgb, var(--mono-accent) 40%, var(--border));
      box-shadow: 0 6px 26px rgb(4 3 14 / 35%);
    }
    :host([flat]) { background: var(--card-2, #1e1a45); }
    :host([ghost]) { background: none; border-style: dashed; }
    :host([pad0]) { padding: 0; }
    ::slotted(h3:first-child), ::slotted(h2:first-child) { margin-top: 0; }
  </style>
  <slot></slot>
`;

class MonoCard extends MonoElement {
  constructor() {
    super();
    this._root.appendChild(cardTmpl.content.cloneNode(true));
  }
}
define("mono-card", MonoCard);

/* ============================================================
 * <mono-list> / <mono-list-item> — data rows with icon, body, actions
 * ============================================================ */

const listTmpl = document.createElement("template");
listTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: grid; gap: 8px; }
    :host([divider]) { border-top: 1px solid var(--border, #2a2460); padding-top: 10px; }
  </style>
  <slot></slot>
`;

class MonoList extends MonoElement {
  constructor() {
    super();
    this._root.appendChild(listTmpl.content.cloneNode(true));
  }
}
define("mono-list", MonoList);

const itemTmpl = document.createElement("template");
itemTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px;
      background: var(--mono-bg);
      border: 1px solid var(--mono-border);
      border-radius: var(--mono-radius-sm);
      transition: border-color var(--mono-transition), background var(--mono-transition);
    }
    :host(:hover) { border-color: color-mix(in srgb, var(--mono-accent) 35%, var(--mono-border)); }
    :host([clickable]) { cursor: pointer; }
    .ico {
      flex: none; display: grid; place-items: center;
      width: 34px; height: 34px; border-radius: 9px;
      background: var(--mono-bg-hover); color: var(--mono-accent);
    }
    .grow { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .title { font: 600 14px/1.35 var(--mono-font); color: var(--mono-text);
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font: 400 12.5px/1.4 var(--mono-font); color: var(--mono-muted);
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; align-items: center; gap: 8px; flex: none; }
    :host([tone="danger"]) .ico { color: var(--mono-danger); }
    :host([tone="success"]) .ico { color: var(--mono-green); }
  </style>
  <span class="ico"><slot name="icon"></slot></span>
  <div class="grow">
    <span class="title"><slot name="title"></slot></span>
    <span class="sub"><slot name="subtitle"></slot></span>
    <slot></slot>
  </div>
  <div class="actions"><slot name="actions"></slot></div>
`;

class MonoListItem extends MonoElement {
  constructor() {
    super();
    this._root.appendChild(itemTmpl.content.cloneNode(true));
  }
}
define("mono-list-item", MonoListItem);

/* ============================================================
 * <mono-stat> — label / value / icon metric tile
 * ============================================================ */

const statTmpl = document.createElement("template");
statTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px;
      background: var(--mono-bg);
      border: 1px solid var(--mono-border);
      border-radius: var(--mono-radius-sm);
    }
    .ico {
      flex: none; display: grid; place-items: center;
      width: 36px; height: 36px; border-radius: 10px;
      background: color-mix(in srgb, var(--mono-accent) 13%, transparent);
      color: var(--mono-accent);
    }
    .body { display: grid; gap: 1px; min-width: 0; }
    .label { font: 600 11.5px/1.3 var(--mono-font); color: var(--mono-muted);
             letter-spacing: 0.04em; text-transform: uppercase; }
    .value { font: 800 17px/1.25 var(--mono-font); color: var(--mono-text); }
    :host([tone="success"]) .ico { background: color-mix(in srgb, var(--mono-green) 13%, transparent); color: var(--mono-green); }
    :host([tone="danger"]) .ico { background: color-mix(in srgb, var(--mono-danger) 13%, transparent); color: var(--mono-danger); }
  </style>
  <span class="ico"><slot name="icon"></slot></span>
  <div class="body">
    <span class="label"><slot name="label"></slot></span>
    <span class="value"><slot name="value"></slot></span>
  </div>
`;

class MonoStat extends MonoElement {
  constructor() {
    super();
    this._root.appendChild(statTmpl.content.cloneNode(true));
  }
}
define("mono-stat", MonoStat);
