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
from svgpng import has_arabic as _has_arabic

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
    return dict(lines=list(lines), size=size, line_h=line_h, rise=rise,
                x=x, y0=y0, top=top, H_strip=bot - top, W=W, rtl=bool(rtl))


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
MID_CLOUD_MIN_RATIO = 1.2        # W/H above this counts as landscape
MID_CLOUD_W_FRAC = 0.55          # solid part, from the TEXT'S OWN EDGE inwards
MID_CLOUD_FEATHER = 0.18         # the ramp that fades it out across the empty side


def mid_gradient_svg(W, H, opacity=None, rtl=False):
    """The static feather-dark-feather band (black, transparent outside): dark core
    between the feathers, alpha ramps on both edges. On landscape it is ALSO
    feathered left and right, so it reads as a cloud rather than a bar.

    `opacity` is 0..1 and is PER TEXT BLOCK — the web app offers it as a picker
    so a block over dark footage can use a lighter band (or none) without
    weakening the one over a bright shot. Omitted = MID_OPACITY, which stays
    the default everywhere and is the value the plugin's AE gradient is baked
    at (make_assets.py DATA.gradient.opacity), so the two stay in step."""
    top, bot = MID_TOP_FRAC, MID_BOT_FRAC
    f = MID_FEATHER_FRAC / 2       # the feather STRADDLES each band edge (half
    a = MID_OPACITY if opacity is None else max(0.0, min(1.0, float(opacity)))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">'
            f'<defs><linearGradient id="band" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="{top - f:.4f}" stop-color="#000" stop-opacity="0"/>'
            f'<stop offset="{top + f:.4f}" stop-color="#000" stop-opacity="{a}"/>'
            f'<stop offset="{bot - f:.4f}" stop-color="#000" stop-opacity="{a}"/>'
            f'<stop offset="{bot + f:.4f}" stop-color="#000" stop-opacity="0"/>'
            f'</linearGradient></defs>'
            + _cloud_mask(W, H, rtl) +
            f'<rect width="{W}" height="{H}" fill="url(#band)"{_cloud_ref(W, H)}/></svg>')


def _is_wide(W, H):
    return H and (W / H) >= MID_CLOUD_MIN_RATIO


def _cloud_mask(W, H, rtl=False):
    """A horizontal alpha ramp, as a mask. Only on landscape; empty otherwise so
    portrait and square render byte-identically to before.

    ANCHORED TO THE TEXT'S SIDE, not centred: the text is left-aligned at the safe
    margin (right when RTL), so a centred cloud leaves the first words in the fade
    and darkens empty picture on the far side. Solid from the text's edge, fading
    out across the empty half."""
    if not _is_wide(W, H):
        return ""
    solid, feather = MID_CLOUD_W_FRAC, MID_CLOUD_FEATHER
    if rtl:      # text on the right: solid from the right edge, fading leftwards
        a, b = max(0.0, 1.0 - solid - feather), 1.0 - solid
        stops = (f'<stop offset="{a:.4f}" stop-color="#fff" stop-opacity="0"/>'
                 f'<stop offset="{b:.4f}" stop-color="#fff" stop-opacity="1"/>'
                 f'<stop offset="1" stop-color="#fff" stop-opacity="1"/>')
    else:        # text on the left: solid from the left edge, fading rightwards
        a, b = solid, min(1.0, solid + feather)
        stops = (f'<stop offset="0" stop-color="#fff" stop-opacity="1"/>'
                 f'<stop offset="{a:.4f}" stop-color="#fff" stop-opacity="1"/>'
                 f'<stop offset="{b:.4f}" stop-color="#fff" stop-opacity="0"/>')
    return (f'<defs><linearGradient id="cloudx" x1="0" y1="0" x2="1" y2="0">{stops}'
            f'</linearGradient>'
            f'<mask id="cloud"><rect width="{W}" height="{H}" fill="url(#cloudx)"/></mask></defs>')


def _cloud_ref(W, H):
    return ' mask="url(#cloud)"' if _is_wide(W, H) else ""


def render_mid_gradient(W, H, out_png, opacity=None, rtl=False):
    _svg2png(bytestring=mid_gradient_svg(W, H, opacity, rtl).encode(),
             write_to=out_png, output_width=W, output_height=H)
    return out_png
