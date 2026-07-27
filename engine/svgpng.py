"""cairosvg-compatible svg2png with a portable fallback.

cairosvg (preferred; pixel-identical with the original proven pipeline) needs
the cairo C library, which on a Mac normally arrives via Homebrew. A
colleague's fresh Mac has no Homebrew — so when cairosvg can't load, we render
with resvg (self-contained Rust wheel, zero system libraries) using the
Raleway TTFs bundled in engine/assets/fonts. The layout code measures the
rendered ink (alpha channel) and positions from that, so a renderer swap
self-corrects instead of shifting compositions.

Only the svg2png(bytestring|url, write_to, output_width/output_height) subset
the engine actually uses is implemented.
"""
import os
import re

_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "fonts")


def font_path(filename):
    """Absolute path of a brand font file (e.g. "Raleway-Bold.ttf").
    Bundled fonts FIRST so every machine measures and renders with the exact
    same TTF; system installs are the fallback, then the bare name so Pillow
    raises a clear error naming the missing file."""
    for d in (_FONT_DIR, "/Library/Fonts/Raleway/static",
              os.path.expanduser("~/Library/Fonts")):
        p = os.path.join(d, filename)
        if os.path.exists(p):
            return p
    return filename

try:
    import cairosvg as _cairo
except Exception:                                   # fresh Mac: no Homebrew libcairo
    _cairo = None


# Arabic (incl. Presentation Forms) — the trigger for the RTL path below.
_ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
ARABIC_FAMILY = "Almarai"       # OCHA's Arabic brand face (bundled, OFL)


def has_arabic(s):
    return bool(_ARABIC_RE.search(s or ""))


# Latin weight -> the Almarai file that stands in for it. Almarai ships
# Light/Regular/Bold/ExtraBold (no Medium/SemiBold), so 500/600 round to the
# nearest real weight rather than letting Pillow synthesise one.
_ARABIC_FILES = {400: "Almarai-Regular.ttf", 500: "Almarai-Regular.ttf",
                 600: "Almarai-Bold.ttf", 700: "Almarai-Bold.ttf",
                 800: "Almarai-ExtraBold.ttf"}


def font_for(text, weight, latin_path):
    """Path of the font that will ACTUALLY render `text` — so layout measures
    the same face the renderer draws with. Measuring Arabic against Raleway is
    how a caption box came out sized for .notdef boxes (1111px measured vs
    664px drawn). Needs Pillow built with Raqm for true shaped widths; without
    it Arabic still renders correctly, the box is just approximate."""
    if has_arabic(text):
        return font_path(_ARABIC_FILES.get(weight, "Almarai-Regular.ttf"))
    return latin_path


def _arabize(svg):
    """Append the Arabic family to every font-family so ONE text run can mix
    scripts: Raleway keeps the Latin (identical output), Almarai supplies the
    glyphs Raleway simply doesn't have."""
    return re.sub(r'font-family="([^"]*)"',
                  lambda m: 'font-family="%s, %s"' % (m.group(1), ARABIC_FAMILY)
                  if ARABIC_FAMILY not in m.group(1) else m.group(0),
                  svg)


def svg2png(bytestring=None, url=None, write_to=None, output_width=None, output_height=None):
    svg_txt = None
    if bytestring is not None:
        svg_txt = bytestring.decode("utf-8")
    elif url is not None and str(url).lower().endswith(".svg"):
        try:
            svg_txt = open(url, encoding="utf-8").read()
        except Exception:
            svg_txt = None

    # THE ARABIC GATE — one place, like mediakit's colour gate.
    # cairosvg cannot SHAPE Arabic: it draws the isolated letterforms in visual
    # order, so the result is disconnected and reads backwards (measured
    # 2026-07-27 — and with a Latin-only family it draws .notdef tofu boxes).
    # resvg shapes through rustybuzz and applies the bidi algorithm, so any SVG
    # containing Arabic goes to resvg with the Arabic family appended, whatever
    # cairosvg is available. Latin-only SVGs keep the proven cairosvg path
    # untouched. If you make cairosvg handle Arabic one day, delete this branch,
    # never "simplify" it away.
    if svg_txt is not None and has_arabic(svg_txt):
        return _resvg(_arabize(svg_txt), write_to, output_width, output_height)

    if _cairo is not None:
        return _cairo.svg2png(bytestring=bytestring, url=url, write_to=write_to,
                              output_width=output_width, output_height=output_height)
    svg = svg_txt if svg_txt is not None else open(url, encoding="utf-8").read()
    return _resvg(svg, write_to, output_width, output_height)


def _resvg(svg, write_to, output_width=None, output_height=None):
    import resvg_py
    # Pass width/height (ints) instead of zoom: resvg scales proportionally from
    # either one, and resvg_py 0.3.2 (what Python 3.9 installs — stock-macOS
    # colleagues) declares zoom as int-only, so a float zoom crashes every
    # element render with "argument 'zoom': 'float' object cannot be
    # interpreted as an integer". width/height work on 0.3.2 and 0.3.3 alike.
    kw = {}
    if output_height:
        kw["height"] = int(round(output_height))
    elif output_width:
        kw["width"] = int(round(output_width))
    png = resvg_py.svg_to_bytes(svg_string=svg, font_dirs=[_FONT_DIR], **kw)
    with open(write_to, "wb") as fh:
        fh.write(bytes(png))


def _intrinsic(svg):
    """(width, height) of the SVG root — attrs first, else the viewBox box."""
    m = re.search(r"<svg[^>]*>", svg)
    root = m.group(0) if m else ""

    def attr(name):
        am = re.search(name + r'="([0-9.]+)', root)
        return float(am.group(1)) if am else None

    w, h = attr("width"), attr("height")
    if w and h:
        return w, h
    vb = re.search(r'viewBox="\s*[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)', root)
    if vb:
        return float(vb.group(1)), float(vb.group(2))
    return None, None
