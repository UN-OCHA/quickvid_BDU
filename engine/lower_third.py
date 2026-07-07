#!/usr/bin/env python3
"""
OCHA animated lower third — SVG renderer, generalized for ANY canvas + format.

Ported from the approved Venezuela build and made resolution-independent:
  - sizes scale with the canvas height (a per-format ratio, passed in);
  - supports CENTER or LEFT alignment;
  - callable as a library from finish.py (returns a frame sequence + geometry),
    or from the CLI for quick tests.

Style (locked):  NAME = black on white box, uppercase, Raleway Bold, sharp corners;
ORG = white on OCHA-blue box directly below.
Motion (locked): no fade; left-anchored wipe reveal; NAME first, ORG follows and
pans slightly left as it settles; exit is the exact reverse; cubic ease-in-out.
"""
import os
import shutil
import argparse
from PIL import ImageFont
import cairosvg

RALEWAY_BOLD = "/Library/Fonts/Raleway/static/Raleway-Bold.ttf"
BLACK, BLUE, WHITE = "#000000", "#009EDB", "#FFFFFF"

# motion timing (seconds) — canvas-independent
NAME_IN, ORG_DELAY, ORG_IN = 0.50, 0.26, 0.50
ENTER_END = ORG_DELAY + ORG_IN                       # 0.76
ORG_OUT, NAME_OUT_DELAY, NAME_OUT = 0.44, 0.20, 0.44
EXIT_DUR = NAME_OUT_DELAY + NAME_OUT                  # 0.64


def _clamp(x):
    return max(0.0, min(1.0, x))


def ease(x):                                          # cubic ease-in-out ("easy ease")
    x = _clamp(x)
    return 4 * x ** 3 if x < 0.5 else 1 - ((-2 * x + 2) ** 3) / 2


def style(canvas_h, name_ratio):
    """Type/box sizes derived from the canvas height. Ratios match the approved
    Venezuela look (name 76px @ 2560 = 0.0297)."""
    name = max(20, round(canvas_h * name_ratio))
    return {"name": name, "org": round(name * 0.60),
            "pad_x": round(name * 0.68), "pad_y": round(name * 0.31),
            "pan": round(name * 0.50), "radius": 0}


def _measure(text, size):
    f = ImageFont.truetype(RALEWAY_BOLD, size)
    l, t, r, b = f.getbbox(text)
    return r - l


def layout(name, org, st):
    name = name.upper()
    nw = _measure(name, st["name"]) + 2 * st["pad_x"]
    ow = _measure(org, st["org"]) + 2 * st["pad_x"]
    nh = st["name"] + 2 * st["pad_y"]
    oh = st["org"] + 2 * st["pad_y"]
    BW = max(nw, ow)
    return {"name": name, "org": org, "name_w": nw, "org_w": ow,
            "name_h": nh, "org_h": oh, "BW": BW, "pan": st["pan"],
            "W": BW + 2 * st["pan"], "H": nh + oh, "st": st}


def state(t, hold):
    """(name_reveal, org_reveal, org_pan_fraction) at time t."""
    if t < ENTER_END:
        nr = ease(t / NAME_IN)
        ot = t - ORG_DELAY
        if ot <= 0:
            orr, pan = 0.0, 1.0
        else:
            p = ease(ot / ORG_IN)
            orr, pan = p, (1 - p)
    elif t < ENTER_END + hold:
        nr, orr, pan = 1.0, 1.0, 0.0
    else:
        e = t - (ENTER_END + hold)
        po = ease(e / ORG_OUT)
        orr, pan = 1 - po, po
        nr = 1.0 if e <= NAME_OUT_DELAY else 1 - ease((e - NAME_OUT_DELAY) / NAME_OUT)
    return _clamp(nr), _clamp(orr), pan


def svg(lo, nr, orr, pan_frac, align):
    W, H = lo["W"], lo["H"]
    st = lo["st"]
    pan = pan_frac * lo["pan"]
    ny, oy = 0, lo["name_h"]
    if align == "left":
        nx = lo["pan"]
        ox = lo["pan"] + pan
        anchor, ntx, otx = "start", nx + st["pad_x"], ox + st["pad_x"]
    else:                                            # center
        nx = (W - lo["name_w"]) / 2
        ox = (W - lo["org_w"]) / 2 + pan
        anchor, ntx, otx = "middle", nx + lo["name_w"] / 2, ox + lo["org_w"] / 2
    nrw = max(0.0, nr * lo["name_w"])
    orw = max(0.0, orr * lo["org_w"])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <clipPath id="cn"><rect x="{nx:.2f}" y="{ny}" width="{nrw:.2f}" height="{lo['name_h']}"/></clipPath>
    <clipPath id="co"><rect x="{ox:.2f}" y="{oy}" width="{orw:.2f}" height="{lo['org_h']}"/></clipPath>
  </defs>
  <g clip-path="url(#cn)">
    <rect x="{nx:.2f}" y="{ny}" width="{lo['name_w']}" height="{lo['name_h']}" rx="{st['radius']}" fill="{WHITE}"/>
    <text x="{ntx:.2f}" y="{ny + lo['name_h']/2:.1f}" font-family="Raleway" font-weight="700"
          font-size="{st['name']}" fill="{BLACK}" text-anchor="{anchor}" dominant-baseline="central"
          letter-spacing="0.5">{lo['name']}</text>
  </g>
  <g clip-path="url(#co)">
    <rect x="{ox:.2f}" y="{oy}" width="{lo['org_w']}" height="{lo['org_h']}" rx="{st['radius']}" fill="{BLUE}"/>
    <text x="{otx:.2f}" y="{oy + lo['org_h']/2:.1f}" font-family="Raleway" font-weight="700"
          font-size="{st['org']}" fill="{WHITE}" text-anchor="{anchor}" dominant-baseline="central">{lo['org']}</text>
  </g>
</svg>'''


def render(name, org, canvas_h, align, fps, hold, outdir, name_ratio=0.030):
    """Render the LT animation to `outdir` as NNNN.png frames. Returns geometry
    so the caller can position the block: W/H = PNG size, block_left = the settled
    block's left edge inside the PNG (for LEFT align), BW = block width."""
    st = style(canvas_h, name_ratio)
    lo = layout(name, org, st)
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir, exist_ok=True)
    total = ENTER_END + hold + EXIT_DUR
    n = int(round(total * fps))
    for i in range(n):
        nr, orr, pan = state(i / fps, hold)
        cairosvg.svg2png(bytestring=svg(lo, nr, orr, pan, align).encode(),
                         write_to=os.path.join(outdir, f"{i:04d}.png"),
                         output_width=lo["W"], output_height=lo["H"])
    block_left = lo["pan"] if align == "left" else (lo["W"] - lo["BW"]) / 2
    return {"dir": outdir, "frames": n, "W": lo["W"], "H": lo["H"],
            "BW": lo["BW"], "block_left": block_left, "total": total}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--org", required=True)
    ap.add_argument("--out", required=True, help="output frames dir")
    ap.add_argument("--canvas-h", type=int, default=2560)
    ap.add_argument("--align", choices=["center", "left"], default="left")
    ap.add_argument("--name-ratio", type=float, default=0.030)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--hold", type=float, default=3.4)
    args = ap.parse_args()
    g = render(args.name, args.org, args.canvas_h, args.align, args.fps, args.hold,
               args.out, args.name_ratio)
    print(f"frames -> {g['dir']} ({g['frames']} frames, {g['W']}x{g['H']}, block {g['BW']}px)")


if __name__ == "__main__":
    main()
