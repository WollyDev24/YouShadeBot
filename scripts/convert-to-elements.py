#!/usr/bin/env python3
"""Rewrite index.html so every interactive control is a Monolith custom element.

The transformation only ever rewrites tags, never the surrounding text, and it
leaves every id / class / data-* attribute intact so app.js keeps working.
It is idempotent: running it twice produces the same output.
"""
import io
import re
import sys

PATH = "src/panel/public/index.html"

# ------------------------------------------------------------------ tag scan

TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(/?)>", re.S)
ATTR_RE = re.compile(
    r"""([a-zA-Z_:@][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?""",
    re.S,
)

BUTTON_VARIANTS = ("primary", "danger", "ghost", "discord", "success")
BUTTON_SIZES = ("small", "large", "full", "block")
CHECK_ROLES = ("check", "check-grid")


def parse_attrs(raw):
    out, i, n = [], 0, len(raw)
    while i < n:
        m = ATTR_RE.match(raw, i)
        if not m:
            i += 1
            continue
        name, val = m.group(1), m.group(2)
        quote = ""
        if val and val[0] in "\"'":
            quote, val = val[0], val[1:-1]
        out.append((name, val, quote))
        i = m.end()
    return out


def render_attrs(attrs):
    parts = []
    for name, val, quote in attrs:
        parts.append(name if val is None else f"{name}={quote or '\"'}{val}{quote or '\"'}")
    return (" " + " ".join(parts)) if parts else ""


def get(attrs, name):
    low = name.lower()
    for a, v, _ in attrs:
        if a.lower() == low:
            return v
    return None


def drop(attrs, *names):
    low = {n.lower() for n in names}
    return [a for a in attrs if a[0].lower() not in low]


def setattr_(attrs, name, value):
    for a in attrs:
        if a[0].lower() == name.lower():
            attrs[attrs.index(a)] = (name, value, '"')
            return attrs
    attrs.append((name, value, '"'))
    return attrs


def classes(attrs):
    return (get(attrs, "class") or "").split()


# ----------------------------------------------------------------- rewriting

def convert_input(attrs):
    itype = (get(attrs, "type") or "text").lower()
    cls = classes(attrs)
    attrs = drop(attrs, "class")

    if itype == "checkbox":
        return "mono-checkbox", drop(attrs, "type")

    tag = "mono-search" if "search-box" in cls else "mono-input"
    if tag == "mono-input":
        if itype == "text":
            attrs = drop(attrs, "type")
        else:
            attrs = setattr_(attrs, "type", itype)

    if tag == "mono-search":
        return tag, attrs

    # inline width on a custom element is meaningless, it has a width attribute
    style = get(attrs, "style") or ""
    m = re.search(r"width:\s*(\d+px)", style)
    if m:
        attrs = setattr_(attrs, "width", m.group(1)[:-2])
        style = style[: m.start()] + style[m.end():]
    style = style.strip().rstrip(";").strip()
    if style:
        attrs = setattr_(attrs, "style", style)
    else:
        attrs = drop(attrs, "style")
    return tag, attrs


def convert_button(attrs):
    cls = classes(attrs)
    if "btn" not in cls:
        return None
    variant = next((v for v in BUTTON_VARIANTS if v in cls), None)
    sizes = [s for s in BUTTON_SIZES if s in cls]
    attrs = drop(attrs, "class")
    if variant:
        attrs = setattr_(attrs, "variant", variant)
    for s in sizes:
        attrs = setattr_(attrs, s, "")
    return "mono-button", attrs


def rewrite_tags(src):
    """Rename tags, tracking a stack of open elements so a closing tag only
    changes when its matching opening tag was actually converted."""
    ALWAYS = {"select": "mono-select", "textarea": "mono-textarea"}
    VOID = {"input", "img", "br", "hr", "meta", "link", "source", "area", "col", "wbr"}

    out, i, stack = [], 0, []
    for m in TAG_RE.finditer(src):
        out.append(src[i:m.start()])
        i = m.end()
        closing, name, raw, self_close = m.groups()
        low = name.lower()
        attrs = parse_attrs(raw)

        if closing:
            open_name = stack.pop() if stack else None
            out.append(f"</{open_name or name}>")
            continue

        converted = None
        if low in ALWAYS:
            converted = ALWAYS[low]
            body = render_attrs(drop(attrs, "class"))
        elif low == "input":
            tag, nattrs = convert_input(attrs)
            converted, body = tag, render_attrs(nattrs) + ("/" if self_close else "")
        elif low == "button":
            done = convert_button(attrs)
            if done:
                converted, body = done[0], render_attrs(done[1])

        if converted:
            out.append(f"<{converted}{body}>")
        else:
            out.append(m.group(0))

        # keep the stack aligned so </span> never pops a <button>
        if not self_close and low not in VOID:
            stack.append(converted or name)
    out.append(src[i:])
    return "".join(out)


# --------------------------------------------------------------- label pairs
# <label for="x">Text</label>\n<CONTROL id="x">  ->  <mono-field label="Text">

# a control is either self-closing, or a container whose children must be
# carried along with it (select > option, textarea > text)
CONTROL = (
    r'(?P<ctrl><mono-(?:select|textarea)\b[^>]*?>.*?</mono-(?:select|textarea)>'
    r'|<mono-[a-z-]+\b[^>]*?/?>)'
)

LABEL = re.compile(
    r'(?P<ind>[ \t]*)(?P<open><label\b(?P<lattrs>[^>]*)>)(?P<ltext>[^<]*)(?P<close></label>)'
    r'[ \t]*\r?\n[ \t]*' + CONTROL,
    re.I | re.S,
)

# <label class="check"><input type=checkbox> text</label> -> <mono-checkbox class="check">
CHECK_LABEL = re.compile(
    r'(?P<ind>[ \t]*)(?P<open><label\b(?P<lattrs>[^>]*\bclass="[^"]*\bcheck\b[^"]*"[^>]*)>)'
    r'[ \t]*<input\b(?P<iattrs>[^>]*?type="checkbox"[^>]*?)/?>[ \t]*(?P<text>[^<]*)</label>',
    re.I,
)


def convert_check_labels(src):
    """Runs before the tag rewrite, while the checkbox is still native."""
    def check(m):
        cattrs = parse_attrs(m.group("lattrs"))
        idattr = get(parse_attrs(m.group("iattrs")), "id")
        if idattr:
            cattrs = setattr_(cattrs, "id", idattr)
        ind = m.group("ind")
        return f'{ind}<mono-checkbox{render_attrs(cattrs)}>{m.group("text").strip()}</mono-checkbox>'

    return CHECK_LABEL.sub(check, src)


def wrap_fields(src):
    def field(match):
        lattrs = parse_attrs(match.group("lattrs"))
        if any(c in classes(lattrs) for c in CHECK_ROLES):
            return match.group(0)
        text = (match.group("ltext") or "").strip()
        if not text:
            return match.group(0)
        ind = match.group("ind")
        return (
            f'{ind}<mono-field label="{text}">\n'
            f"{ind}  {match.group('ctrl')}\n"
            f"{ind}</mono-field>"
        )

    return LABEL.sub(field, src)


# --------------------------------------------------------------------- main

def main():
    src = io.open(PATH, encoding="utf-8").read()
    result = convert_check_labels(src)
    result = rewrite_tags(result)
    result = wrap_fields(result)

    if result == src:
        print("no changes", file=sys.stderr)
        return 1
    io.open(PATH, "w", encoding="utf-8").write(result)

    for tag in ("input", "select", "textarea", "button", "label for"):
        n = len(re.findall(rf"<{tag}\b" if " " not in tag else rf"<{re.escape(tag)}\b", result))
        print(f"  <{tag:>12}> remaining: {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
