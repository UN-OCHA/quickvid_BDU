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


def build(lines, W, H):
    """Geometry for a text block. `lines` = 1..3 non-empty strings (already
    compacted — the web UI drops blanks, so there is no gap-close logic)."""
    orient = orient_of(W, H)
    size = round(H * RATIO[orient])
    line_h = round(size * LINE_GAP)
    rise = round(H * RISE_FRAC)
    x = round(W * SAFE_LEFT[orient])
    y0 = round(H * Y_FRAC)                      # line-1 baseline (comp coords)
    # strip: full width; from a size above line 1 to below the last line + rise
    top = y0 - size - 4
    bot = y0 + (len(lines) - 1) * line_h + round(size * 0.35) + rise + 4
    return dict(lines=list(lines), size=size, line_h=line_h, rise=rise,
                x=x, y0=y0, top=top, H_strip=bot - top, W=W)


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
            f'<text x="{g["x"]}" y="{y:.1f}" font-family="Raleway" '
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


def mid_gradient_svg(W, H):
    """The static feather-dark-feather band (full frame, black, transparent
    outside): dark core between the feathers, alpha ramps on both edges."""
    top, bot = MID_TOP_FRAC, MID_BOT_FRAC
    f = MID_FEATHER_FRAC / 2       # the feather STRADDLES each band edge (half
    a = MID_OPACITY                # in, half out) — same as AE's Linear Wipe
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">'
            f'<defs><linearGradient id="band" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="{top - f:.4f}" stop-color="#000" stop-opacity="0"/>'
            f'<stop offset="{top + f:.4f}" stop-color="#000" stop-opacity="{a}"/>'
            f'<stop offset="{bot - f:.4f}" stop-color="#000" stop-opacity="{a}"/>'
            f'<stop offset="{bot + f:.4f}" stop-color="#000" stop-opacity="0"/>'
            f'</linearGradient></defs>'
            f'<rect width="{W}" height="{H}" fill="url(#band)"/></svg>')


def render_mid_gradient(W, H, out_png):
    _svg2png(bytestring=mid_gradient_svg(W, H).encode(),
             write_to=out_png, output_width=W, output_height=H)
    return out_png
