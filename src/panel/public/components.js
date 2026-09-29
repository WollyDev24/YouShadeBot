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
    --mono-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --mono-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --mono-radius: 12px;
    --mono-radius-sm: 9px;
    --mono-bg: var(--card-2, #252525);
    --mono-bg-hover: var(--card-3, #2b2b2e);
    --mono-border: var(--border-strong, #3a3a3d);
    --mono-text: var(--text, #fff);
    --mono-muted: var(--muted, #98989d);
    --mono-accent: var(--accent, #00e5ff);
    --mono-danger: var(--coral, #ff453a);
    --mono-green: var(--green, #32d74b);
    --mono-ring: 0 0 0 4px var(--glow, rgba(0, 229, 255, 0.28));
    --mono-transition: 140ms cubic-bezier(0.4, 0, 0.2, 1);
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
    "disabled", "readonly", "required", "name", "autocomplete", "spellcheck", "width"
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
    "required", "name", "spellcheck", "value"
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

const selectTmpl = document.createElement("template");
selectTmpl.innerHTML = `
  <style>
    ${TOKENS}
    :host { display: inline-flex; position: relative; width: 100%; min-width: 0; }
    :host([width]) { width: var(--mono-w, auto); }
    .wrap { position: relative; display: flex; align-items: center; width: 100%; min-width: 0; }
    select {
      appearance: none; -webkit-appearance: none;
      width: 100%; min-width: 0;
      background: var(--mono-bg);
      border: 1px solid var(--mono-border);
      border-radius: var(--mono-radius-sm);
      color: var(--mono-text);
      font: 500 14px/1.4 var(--mono-font);
      padding: 10px 36px 10px 12px;
      cursor: pointer; outline: none;
      transition: border-color var(--mono-transition), box-shadow var(--mono-transition);
    }
    select:hover { border-color: color-mix(in srgb, var(--mono-accent) 45%, var(--mono-border)); }
    :host(:focus-within) select { border-color: var(--mono-accent); box-shadow: var(--mono-ring); }
    :host([invalid]) select { border-color: var(--mono-danger); }
    select:disabled { cursor: not-allowed; opacity: 0.6; }
    select[multiple] {
      padding: 6px; min-height: calc(var(--mono-rows, 6) * 1.4em + 12px);
      background-image: none;
    }
    select[multiple] option { padding: 6px 8px; border-radius: 6px; }
    .arrow {
      position: absolute; right: 11px; pointer-events: none;
      color: var(--mono-muted); font-size: 12px;
      display: grid; place-items: center;
      transition: transform var(--mono-transition), color var(--mono-transition);
    }
    :host(:focus-within) .arrow { color: var(--mono-accent); }
    :host([open]) .arrow { transform: rotate(180deg); }
    :host([multiple]) .arrow { display: none; }
    /* light-DOM options are configuration only, never rendered directly */
    ::slotted(option) { display: none; }
  </style>
  <div class="wrap">
    <select part="select"></select>
    <span class="arrow" aria-hidden="true">▾</span>
  </div>
`;

class MonoSelect extends MonoElement {
  static formAssociated = true;
  static observedAttributes = ["multiple", "size", "disabled", "required", "name", "width", "rows"];

  constructor() {
    super();
    this._root.appendChild(selectTmpl.content.cloneNode(true));
    this._el = this._root.querySelector("select");
    this._el.addEventListener("change", () => this._onChange());
    this._el.addEventListener("input", () => this._onChange());
    this._pendingValue = null;
  }

  connectedCallback() {
    this._sync();
    this._observer = new MutationObserver(() => this._syncOptions());
    this._observer.observe(this, { childList: true, subtree: true, characterData: true });
    this._syncOptions();
  }

  disconnectedCallback() {
    this._observer?.disconnect();
  }

  attributeChangedCallback() { this._sync(); }

  _sync() {
    const el = this._el;
    if (!el) return;
    const multiple = boolAttr(this, "multiple");
    if (el.multiple !== multiple) el.multiple = multiple;
    if (this.hasAttribute("size")) el.size = numAttr(this, "size", 6);
    if (this.hasAttribute("rows")) this.style.setProperty("--mono-rows", numAttr(this, "rows", 6));
    el.disabled = boolAttr(this, "disabled");
    el.required = boolAttr(this, "required");
    const name = this.getAttribute("name");
    if (name) el.name = name;
    const w = this.getAttribute("width");
    if (w) this.style.setProperty("--mono-w", /^\d+$/.test(w) ? `${w}px` : w);
  }

  /* Rebuild the native <option> list from the light-DOM declarations. */
  _syncOptions() {
    const el = this._el;
    if (!el) return;
    const declared = [...this.querySelectorAll(":scope > option")];
    /* app.js marks options with the `selected` *property*, not the attribute,
     * so the property is the source of truth here */
    const sig = declared
      .map((d) => `${d.getAttribute("value") ?? d.textContent}\u0000${d.selected ? 1 : 0}\u0000${d.disabled ? 1 : 0}`)
      .join("\u0001");
    if (sig === this._sig) return;
    this._sig = sig;

    const prevValue = this._pendingValue;
    el.replaceChildren();
    for (const d of declared) {
      const o = document.createElement("option");
      o.value = d.getAttribute("value") ?? d.textContent;
      o.textContent = d.textContent;
      o.disabled = d.hasAttribute("disabled");
      o.selected = d.selected;
      el.appendChild(o);
    }
    if (prevValue !== null && prevValue !== undefined) this._applyValue(prevValue);
    else if (!el.multiple && el.options.length) el.selectedIndex = 0;
    this._syncForm();
  }

  _applyValue(v) {
    const el = this._el;
    if (!el) return;
    if (el.multiple) {
      const wanted = Array.isArray(v) ? v.map(String) : [String(v)];
      for (const o of el.options) o.selected = wanted.includes(o.value);
      /* a <select multiple> starts with nothing selected when the option list
       * is rebuilt, so re-apply even when the value looks unchanged */
      if (!el.options.length) return;
    } else {
      el.value = v ?? "";
      if (el.selectedIndex < 0 && el.options.length) el.selectedIndex = 0;
    }
  }

  _syncForm() {
    const el = this._el;
    if (!el) return;
    if (!el.multiple) {
      this.internals?.setFormValue(el.value);
      return;
    }
    const picked = [];
    for (const o of el.options) if (o.selected) picked.push(o.value);
    this.internals?.setFormValue(picked);
  }

  _onChange() {
    this._pendingValue = null;
    this._syncForm();
    this.internals?.setValidity(
      el_validity(this._el) ? {} : { valueMissing: true },
      this._el.validationMessage,
      this._el
    );
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  /* --- API --- */
  get value() { return this._el.value; }
  set value(v) {
    this._pendingValue = v;
    /* values may be applied before the matching <option> exists */
    this._applyValue(v);
    this._syncForm();
  }
  get values() {
    const picked = [];
    for (const o of this._el.options) if (o.selected) picked.push(o.value);
    return picked;
  }
  set values(v) {
    this._pendingValue = Array.isArray(v) ? v.map(String) : [String(v)];
    this._applyValue(this._pendingValue);
    this._syncForm();
  }
  get selectedOptions() { return this._el.selectedOptions; }
  get options() { return this._el.options; }
  get selectedIndex() { return this._el.selectedIndex; }
  set selectedIndex(v) { this._el.selectedIndex = v; this._syncForm(); }
  get multiple() { return this._el.multiple; }
  set multiple(v) { v ? this.setAttribute("multiple", "") : this.removeAttribute("multiple"); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get disabled() { return this._el.disabled; }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  get required() { return this._el.required; }
  set required(v) { v ? this.setAttribute("required", "") : this.removeAttribute("required"); }
  get validity() { return this._el.validity; }
  checkValidity() { return this._el.checkValidity(); }
  reportValidity() { return this._el.reportValidity(); }
  focus(opts) { this._el.focus(opts); }
  blur() { this._el.blur(); }
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
    label {
      display: inline-flex; align-items: center; gap: 9px;
      cursor: pointer; user-select: none;
    }
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
    .txt { color: inherit; font: inherit; line-height: 1.4; }
    input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
    /* the slotted caption is light-DOM content, so it picks up the page's
     * .check / .check.off styling; mirror that for the strikethrough state
     * because text-decoration cannot be inherited in from the host */
    :host(.off) ::slotted(*) { text-decoration: line-through; }
  </style>
  <label>
    <input type="checkbox" />
    <span class="box">
      <svg class="tick" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="#06181c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M4 12.5l5.5 5.5L20 6.5"/>
      </svg>
    </span>
    <span class="txt"><slot></slot></span>
  </label>
`;

class MonoCheckbox extends MonoElement {
  static formAssociated = true;
  static observedAttributes = ["checked", "disabled", "name", "value", "required"];

  constructor() {
    super();
    this._root.appendChild(checkTmpl.content.cloneNode(true));
    this._el = this._root.querySelector("input");
    this._el.addEventListener("change", () => this._onChange());
    // The native <label> handles real pointer clicks; stop them bubbling so the
    // host handler below does not toggle a second time.
    this._root.querySelector("label").addEventListener("click", (e) => e.stopPropagation());
    this.addEventListener("click", (e) => {
      if (e.target !== this || this.disabled) return;
      this._el.checked = !this._el.checked;
      this._onChange();
    });
  }

  connectedCallback() { this._sync(); }
  attributeChangedCallback(name) { this._sync(name); }

  _sync() {
    const el = this._el;
    if (!el) return;
    el.disabled = boolAttr(this, "disabled");
    el.required = boolAttr(this, "required");
    const nm = this.getAttribute("name");
    if (nm) el.name = nm;
    const v = this.getAttribute("value");
    if (v !== null) el.value = v;
    el.checked = boolAttr(this, "checked");
    this._syncForm();
  }

  _onChange() {
    this._reflect();
    this._syncForm();
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  _reflect() {
    if (this._el.checked) this.setAttribute("checked", "");
    else this.removeAttribute("checked");
  }

  _syncForm() {
    this.internals?.setFormValue(this._el.checked ? (this.getAttribute("value") ?? "on") : null);
  }

  get checked() { return this._el.checked; }
  set checked(v) {
    v ? this.setAttribute("checked", "") : this.removeAttribute("checked");
    this._el.checked = Boolean(v);
    this._syncForm();
  }
  get value() { return this.getAttribute("value") ?? "on"; }
  set value(v) { this.setAttribute("value", v); }
  get indeterminate() { return this._el.indeterminate; }
  set indeterminate(v) { this._el.indeterminate = Boolean(v); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get disabled() { return this._el.disabled; }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  get required() { return this._el.required; }
  set required(v) { v ? this.setAttribute("required", "") : this.removeAttribute("required"); }
  get validity() { return this._el.validity; }
  checkValidity() { return this._el.checkValidity(); }
  focus(opts) { this._el.focus(opts); }
  blur() { this._el.blur(); }
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
      background: var(--mono-accent); border-color: var(--mono-accent); color: #04222a;
    }
    :host([variant="primary"]) button:hover {
      background: var(--mono-accent-hover, color-mix(in srgb, var(--mono-accent) 82%, white));
      border-color: var(--mono-accent);
      box-shadow: 0 6px 20px var(--glow, rgba(0, 229, 255, 0.28));
    }
    :host([variant="danger"]) button {
      background: color-mix(in srgb, var(--mono-danger) 16%, transparent);
      border-color: color-mix(in srgb, var(--mono-danger) 45%, transparent);
      color: var(--mono-danger);
    }
    :host([variant="danger"]) button:hover {
      background: var(--mono-danger); border-color: var(--mono-danger); color: #fff;
    }
    :host([variant="success"]) button {
      background: color-mix(in srgb, var(--mono-green) 16%, transparent);
      border-color: color-mix(in srgb, var(--mono-green) 45%, transparent);
      color: var(--mono-green);
    }
    :host([variant="success"]) button:hover { background: var(--mono-green); color: #05210b; }
    :host([variant="ghost"]) button { background: none; border-color: transparent; color: var(--mono-muted); }
    :host([variant="ghost"]) button:hover { background: var(--mono-bg); color: var(--mono-text); }
    :host([variant="discord"]) button {
      background: #5865f2; border-color: #5865f2; color: #fff;
    }
    :host([variant="discord"]) button:hover { background: #4752c4; border-color: #4752c4; }
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
    :host([bare]) button:focus-visible { box-shadow: none; outline: none; }
  </style>
  <button part="button"><slot name="icon"></slot><slot></slot></button>
`;

class MonoButton extends MonoElement {
  static formAssociated = true;
  static observedAttributes = ["variant", "disabled", "type", "loading"];

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
    if (boolAttr(this, "disabled")) {
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
  }

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
  </style>
  <label part="label"><slot name="label"></slot></label>
  <div class="body"><slot></slot></div>
`;

class MonoField extends MonoElement {
  static observedAttributes = ["label"];
  constructor() {
    super();
    this._root.appendChild(fieldTmpl.content.cloneNode(true));
  }
  connectedCallback() {
    const l = this._root.querySelector("label");
    const v = this.getAttribute("label");
    if (v !== null) l.textContent = v;
    l.hidden = v === null;
  }
  attributeChangedCallback() { this.connectedCallback(); }
  get label() { return this.getAttribute("label") || ""; }
  set label(v) { this.setAttribute("label", v); }
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
  static observedAttributes = ["placeholder", "value", "disabled", "name"];

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
  }
  attributeChangedCallback(name) {
    if (name === "placeholder" && this._el) this._el.placeholder = this.getAttribute("placeholder") ?? "";
    if (name === "value" && this._el && this._el.value !== this.getAttribute("value"))
      this._el.value = this.getAttribute("value") ?? "";
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
      background: var(--card-3, #2b2b2e);
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
    input { position: absolute; opacity: 0; pointer-events: none; }
  </style>
  <input type="checkbox" role="switch" />
  <span class="track"><span class="knob"></span></span>
  <label><slot></slot></label>
`;

class MonoSwitch extends MonoElement {
  static formAssociated = true;
  static observedAttributes = ["checked", "disabled", "name", "value"];
  constructor() {
    super();
    this._root.appendChild(switchTmpl.content.cloneNode(true));
    this._el = this._root.querySelector("input");
    this._el.addEventListener("change", () => this._onChange());
  }
  connectedCallback() { this._sync(); }
  attributeChangedCallback() { this._sync(); }
  _sync() {
    const el = this._el;
    if (!el) return;
    el.disabled = boolAttr(this, "disabled");
    el.checked = boolAttr(this, "checked");
    const n = this.getAttribute("name"); if (n) el.name = n;
    const v = this.getAttribute("value"); if (v !== null) el.value = v;
    this.internals?.setFormValue(el.checked ? (this.getAttribute("value") ?? "on") : null);
  }
  _onChange() {
    this._el.checked ? this.setAttribute("checked", "") : this.removeAttribute("checked");
    this.internals?.setFormValue(this._el.checked ? (this.getAttribute("value") ?? "on") : null);
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  get checked() { return this._el.checked; }
  set checked(v) {
    v ? this.setAttribute("checked", "") : this.removeAttribute("checked");
    this._el.checked = Boolean(v);
  }
  get disabled() { return this._el.disabled; }
  set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  focus(opts) { this._el.focus(opts); }
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
      transition: transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity 220ms ease;
      opacity: 1;
    }
    :host([hidden]) { display: block !important; opacity: 0; transform: translate(-50%, 24px); }
    .box {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 20px; border-radius: 12px;
      background: var(--card-3, #2b2b2e);
      border: 1px solid var(--border-strong, #3a3a3d);
      box-shadow: var(--shadow, 0 8px 24px rgba(0, 0, 0, 0.5));
      color: var(--text, #fff);
      font: 600 14px/1.3 "Inter", system-ui, sans-serif;
      max-width: min(92vw, 460px);
    }
    :host([tone="error"]) .box { border-color: var(--coral, #ff453a); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #00e5ff); flex: none;
           box-shadow: 0 0 10px var(--accent, #00e5ff); }
    :host([tone="error"]) .dot { background: var(--coral, #ff453a); box-shadow: 0 0 10px var(--coral, #ff453a); }
  </style>
  <div class="box"><span class="dot"></span><span id="msg"></span></div>
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
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: fade 180ms ease;
    }
    :host([hidden]) { display: none !important; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes rise { from { opacity: 0; transform: translateY(18px) scale(0.97); } to { opacity: 1; transform: none; } }
    .panel {
      width: 100%; max-width: var(--max, 460px); max-height: 88vh; overflow: auto;
      background: var(--card, #1e1e1e);
      border: 1px solid var(--border-strong, #3a3a3d);
      border-radius: 18px;
      box-shadow: var(--shadow, 0 8px 24px rgba(0, 0, 0, 0.5));
      animation: rise 220ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
    }
    .head {
      display: flex; align-items: center; gap: 12px;
      padding: 18px 20px 12px;
    }
    .head h2, .head h3 { margin: 0; font: 800 18px/1.3 "Inter", system-ui, sans-serif; flex: 1; }
    .x {
      all: unset; cursor: pointer; color: var(--muted, #98989d);
      width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px;
      transition: background 140ms, color 140ms;
    }
    .x:hover { background: var(--card-3, #2b2b2e); color: var(--text, #fff); }
    .body { padding: 0 20px 18px; display: grid; gap: 12px; }
    .foot {
      display: flex; gap: 10px; justify-content: flex-end;
      padding: 14px 20px 18px; border-top: 1px solid var(--border, #2c2c2e);
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
      background: var(--card, #1e1e1e);
      border: 1px solid var(--border, #2c2c2e);
      border-radius: var(--radius, 16px);
      padding: 20px;
      transition: border-color var(--mono-transition), box-shadow var(--mono-transition);
    }
    :host([interactive]:hover) {
      border-color: color-mix(in srgb, var(--mono-accent) 40%, var(--border));
      box-shadow: 0 6px 26px rgba(0, 0, 0, 0.35);
    }
    :host([flat]) { background: var(--card-2, #252525); }
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
    :host([divider]) { border-top: 1px solid var(--border, #2c2c2e); padding-top: 10px; }
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
