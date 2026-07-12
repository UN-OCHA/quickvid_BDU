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


def svg2png(bytestring=None, url=None, write_to=None, output_width=None, output_height=None):
    if _cairo is not None:
        return _cairo.svg2png(bytestring=bytestring, url=url, write_to=write_to,
                              output_width=output_width, output_height=output_height)
    import resvg_py
    svg = bytestring.decode("utf-8") if bytestring is not None else open(url, encoding="utf-8").read()
    zoom = None
    if output_width or output_height:               # cairosvg semantics: scale to the given pixel size
        iw, ih = _intrinsic(svg)
        if output_height and ih:
            zoom = output_height / ih
        elif output_width and iw:
            zoom = output_width / iw
    png = resvg_py.svg_to_bytes(svg_string=svg, zoom=zoom, font_dirs=[_FONT_DIR])
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
