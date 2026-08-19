"""OCHA "Text on screen" — the web-app twin of the plugin's OCHA Text MOGRT.

Up to three lines of white Raleway Bold, left-aligned at the format's safe
margin, line-1 baseline at 52% of frame height. Each line RISES into place and
fades in (staggered), holds, then leaves in reverse — the same motion the AE
template bakes (premiere/ae/make_assets.py DATA.text; the numbers here MIRROR
that table, change them together). Rendered as a PNG strip sequence and
composited by social_brand.py, which also drops the MID readability gradient
(feather-dark-feather band) behind it automatically.
"""
import os
import shutil

from lower_third import ease, esc, _svg2png  # same brand plumbing (cairosvg + real Raleway)
from svgpng import has_arabic as _has_arabic, font_for as _font_for, font_path as _font_path
from PIL import ImageFont

# ---- the plugin's DATA.text numbers (premiere/ae/make_assets.py) ----
RATIO = {"portrait": 0.052, "square": 0.058, "landscape": 0.062}
Y_FRAC = 0.52          # line-1 baseline, fraction of H (0.42 standard, all orients)
LINE_GAP = 1.16        # lineH = size * LINE_GAP
RISE_FRAC = 0.045      # rise distance, fraction of H
ENTER, EXIT, STAGGER = 0.5, 0.4, 0.09
COLOR = "#FFFFFF"
WEIGHT = 700           # Raleway Bold
# safe left margins per orientation (mirrors finish.py profile())
SAFE_LEFT = {"portrait": 0.06, "square": 0.08, "landscape": 0.045}

# the MID gradient behind the text = the plugin's Middle mode
# (feather - dark - feather): band spans 27.5..72.5% of H, per-edge feather =
# the one-sided fade / 2, black at 80%.
MID_TOP_FRAC, MID_BOT_FRAC = 0.275, 0.725
MID_FEATHER_FRAC = 0.45 * 0.75 / 2
MID_OPACITY = 0.80


def orient_of(w, h):
    r = w / h
    return "landscape" if r > 1.25 else ("portrait" if r < 0.85 else "square")


def build(lines, W, H, rtl=None):
    """Geometry for a text block. `lines` = 1..3 non-empty strings (already
    compacted — the web UI drops blanks, so there is no gap-close logic)."""
    # RTL mirrors the block to the RIGHT safe margin, right-aligned. Explicit flag
    # wins (one video-level setting); otherwise auto-detect from the copy.
    if rtl is None:
        rtl = any(_has_arabic(l) for l in lines)
    orient = orient_of(W, H)
    size = round(H * RATIO[orient])
    line_h = round(size * LINE_GAP)
    rise = round(H * RISE_FRAC)
    x = round(W * (1 - SAFE_LEFT[orient])) if rtl else round(W * SAFE_LEFT[orient])
    y0 = round(H * Y_FRAC)                      # line-1 baseline (comp coords)
    # strip: full width; from a size above line 1 to below the last line + rise
    top = y0 - size - 4
    bot = y0 + (len(lines) - 1) * line_h + round(size * 0.35) + rise + 4
    # Widest line, measured with the face that will RENDER it — the cloud behind the
    # text has to be sized to the WORDS. A fixed fraction of the frame is right for a
    # short line on a wide frame and far too small for a portrait line that runs
    # nearly edge to edge.
    try:
        face = _font_path("Raleway-Bold.ttf")
        text_w = max(ImageFont.truetype(_font_for(l, WEIGHT, face), size).getbbox(l)[2]
                     for l in lines)
    except Exception:
        text_w = round(W * 0.6)                 # measuring must never fail a render
    return dict(lines=list(lines), size=size, line_h=line_h, rise=rise,
                x=x, y0=y0, top=top, H_strip=bot - top, W=W, rtl=bool(rtl),
                text_w=text_w)


def total(duration):
    return max(float(duration), ENTER + EXIT + 0.2)


def state(t, dur, i, n):
    """(alpha, dy) for line i of n at time t — the AE template's motion:
    staggered rise+fade in, reversed out (last in = first out)."""
    t0 = i * STAGGER
    t_out = dur - EXIT - i * STAGGER
    if t < t0:
        return 0.0, None
    if t < t0 + ENTER:
        p = ease((t - t0) / ENTER)
        return p, (1 - p)
    if t < t_out:
        return 1.0, 0.0
    if t < t_out + EXIT:
        p = ease((t - t_out) / EXIT)
        return 1 - p, p
    return 0.0, None


def svg(g, t, dur):
    n = len(g["lines"])
    parts = []
    for i, line in enumerate(g["lines"]):
        a, dyf = state(t, dur, i, n)
        if a <= 0 or dyf is None:
            continue
        y = (g["y0"] - g["top"]) + i * g["line_h"] + dyf * g["rise"]
        parts.append(
            f'<text x="{g["x"]}" y="{y:.1f}" text-anchor="{"end" if g.get("rtl") else "start"}" font-family="Raleway" '
            f'font-weight="{WEIGHT}" font-size="{g["size"]}" fill="{COLOR}" '
            f'fill-opacity="{a:.3f}">{esc(line)}</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{g["W"]}" '
            f'height="{g["H_strip"]}">{"".join(parts)}</svg>')


def render_seq(g, dur, fps, outdir):
    """PNG frames for the whole block (transparent strip, overlay at y=top)."""
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir)
    n = int(round(dur * fps))
    for i in range(n):
        _svg2png(bytestring=svg(g, i / fps, dur).encode(),
                 write_to=os.path.join(outdir, f"{i:04d}.png"),
                 output_width=g["W"], output_height=g["H_strip"])
    return n


# On a LANDSCAPE frame a full-width band reads as a letterbox bar across the whole
# picture. Feathering it horizontally as well turns it into a soft cloud sitting
# behind the words — the same treatment the plugin's middle gradient offers. Portrait
# and square keep the full width: there the band is already about as wide as the text.
# THE CLOUD. Mirrors the plugin's own gradient spec (make_assets.py DATA.gradient):
# an ellipse with a big feather — edges fade to nothing, the middle is the darkest
# part — sized as fractions of W/H so it is proportional in every format. These
# three numbers and the plugin's MUST stay equal, or the same text block gets a
# different backing in Premiere than it does here.
MID_CLOUD_RX_FRAC = 0.34         # half-width, fraction of W
MID_CLOUD_RY_FRAC = 0.30         # half-height, fraction of H
MID_CLOUD_FEATHER_FRAC = 0.14    # feather, fraction of W


def mid_gradient_svg(W, H, opacity=None, rtl=False, block=None):
    """A soft elliptical CLOUD behind the text: darkest in the middle, edges
    transparent. Not a band — a full-width bar reads as a letterbox stripe, and the
    picture either side of the words does not need darkening.

    Centred on the TEXT, which is left-aligned at the safe margin (right when RTL),
    so the cloud sits under the words rather than in the middle of the frame.

    `opacity` is 0..1 and is PER TEXT BLOCK — the web app offers it as a picker so a
    block over dark footage can use a lighter cloud (or none) without weakening the
    one over a bright shot. Omitted = MID_OPACITY, the value the plugin's AE template
    is baked at, so the two stay in step.
    """
    a = MID_OPACITY if opacity is None else max(0.0, min(1.0, float(opacity)))
    feather = MID_CLOUD_FEATHER_FRAC * W
    rx, ry = MID_CLOUD_RX_FRAC * W, MID_CLOUD_RY_FRAC * H
    cy = (MID_TOP_FRAC + MID_BOT_FRAC) / 2 * H          # fallback: the mid band's centre
    if block:
        # Sized and placed from the BLOCK: wide enough to carry the longest line
        # (plus the feather, which is transparent at its outer edge), and centred on
        # the text's own rows rather than the middle of the frame.
        want = block.get("text_w", 0) / 2 + feather
        rx = max(rx, want)
        strip_mid = block.get("top", 0) + block.get("H_strip", 0) / 2
        if strip_mid:
            cy = strip_mid
        ry = max(ry, block.get("H_strip", 0) / 2 + feather * 0.6)
    rx = min(rx, W)                                     # never wider than the frame
    # hug the text's side: the ellipse's own edge sits at the frame edge
    cx = (W - rx) if rtl else rx
    core = max(0.0, (rx - feather) / rx) if rx else 0.0  # solid until here, then fade
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">'
            f'<defs><radialGradient id="cloud">'
            f'<stop offset="0" stop-color="#000" stop-opacity="{a}"/>'
            f'<stop offset="{core:.4f}" stop-color="#000" stop-opacity="{a}"/>'
            f'<stop offset="1" stop-color="#000" stop-opacity="0"/>'
            f'</radialGradient></defs>'
            f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="url(#cloud)"/>'
            f'</svg>')


def render_mid_gradient(W, H, out_png, opacity=None, rtl=False, block=None):
    _svg2png(bytestring=mid_gradient_svg(W, H, opacity, rtl, block).encode(),
             write_to=out_png, output_width=W, output_height=H)
    return out_png
