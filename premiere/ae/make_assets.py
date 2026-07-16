#!/usr/bin/env python3
"""
OCHA Premiere plugin — asset baker for the After Effects MOGRT builder.

Run me (from the repo, any cwd) whenever brand-lt.json / brand-pin.json / the
logo or pin SVGs change:

    ./.venv/bin/python premiere/ae/make_assets.py

What I do:
  1. Rasterize the OCHA logos from their SVG sources into premiere/ae/assets/
     (big sizes — comps scale DOWN, so they stay crisp up to 4K). The SVGs stay
     the single source of truth; these PNGs are generated build output.
  2. Convert assets/pin_location.svg's path (cubics + arcs) into After Effects
     bezier vertex arrays (arcs → cubic approximation), tip-anchored so the pin
     scales from its bottom point.
  3. Bake browser/brand-lt.json + brand-pin.json + the engine's safe-area /
     format tables into a JS object literal.
  4. Emit premiere/ae/build_ocha_mogrts.jsx = src/builder_template.jsx with the
     baked data injected — a single self-contained script to run in AE
     (File → Scripts → Run Script File…). No file reads at AE runtime.
"""
import json
import math
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "engine"))
from svgpng import svg2png  # noqa: E402  (cairosvg, or portable resvg)

ASSETS = os.path.join(HERE, "assets")
GEN_JSX = os.path.join(HERE, "build_ocha_mogrts.jsx")
TEMPLATE = os.path.join(HERE, "src", "builder_template.jsx")

# ---------------------------------------------------------------- SVG path → AE
NUM = re.compile(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?")


def _arc_to_cubics(p0, rx, ry, rot_deg, laf, sf, p1):
    """SVG endpoint arc → list of cubic segments (F.6.5 + quarter-arc split)."""
    x1, y1 = p0
    x2, y2 = p1
    if rx == 0 or ry == 0 or (x1 == x2 and y1 == y2):
        return []
    phi = math.radians(rot_deg)
    cosp, sinp = math.cos(phi), math.sin(phi)
    # to center parametrization
    dx, dy = (x1 - x2) / 2.0, (y1 - y2) / 2.0
    x1p = cosp * dx + sinp * dy
    y1p = -sinp * dx + cosp * dy
    rx, ry = abs(rx), abs(ry)
    lam = (x1p / rx) ** 2 + (y1p / ry) ** 2
    if lam > 1:                                   # scale radii up if too small
        s = math.sqrt(lam)
        rx, ry = rx * s, ry * s
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if laf == sf:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2.0
    cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2.0

    def ang(ux, uy, vx, vy):
        d = math.hypot(ux, uy) * math.hypot(vx, vy)
        c = max(-1.0, min(1.0, (ux * vx + uy * vy) / d))
        a = math.acos(c)
        return -a if ux * vy - uy * vx < 0 else a

    th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sf and dth > 0:
        dth -= 2 * math.pi
    elif sf and dth < 0:
        dth += 2 * math.pi

    n = max(1, int(math.ceil(abs(dth) / (math.pi / 2))))
    segs = []
    for i in range(n):
        a0 = th1 + dth * i / n
        a1 = th1 + dth * (i + 1) / n
        d = a1 - a0
        k = 4.0 / 3.0 * math.tan(d / 4.0)

        def pt(a):
            x = cx + rx * math.cos(a) * cosp - ry * math.sin(a) * sinp
            y = cy + rx * math.cos(a) * sinp + ry * math.sin(a) * cosp
            return (x, y)

        def dpt(a):                                # derivative (tangent direction)
            x = -rx * math.sin(a) * cosp - ry * math.cos(a) * sinp
            y = -rx * math.sin(a) * sinp + ry * math.cos(a) * cosp
            return (x, y)

        s, e = pt(a0), pt(a1)
        ds, de = dpt(a0), dpt(a1)
        c1 = (s[0] + k * ds[0], s[1] + k * ds[1])
        c2 = (e[0] - k * de[0], e[1] - k * de[1])
        segs.append((s, c1, c2, e))
    return segs


def parse_pin_path(d):
    """Parse the pin SVG's path (M/C/c/A/a/Z only) into subpaths of cubics."""
    tokens = re.findall(r"[MmCcAaZzLl]|" + NUM.pattern, d)
    i, cur, start = 0, (0.0, 0.0), (0.0, 0.0)
    subs, segs = [], []

    def nums(n):
        nonlocal i
        vals = [float(tokens[i + k]) for k in range(n)]
        i += n
        return vals

    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        if cmd in "Mm":
            x, y = nums(2)
            cur = (x, y) if cmd == "M" else (cur[0] + x, cur[1] + y)
            start = cur
        elif cmd in "Cc":
            while i < len(tokens) and NUM.fullmatch(tokens[i]):
                v = nums(6)
                if cmd == "c":
                    v = [v[0] + cur[0], v[1] + cur[1], v[2] + cur[0],
                         v[3] + cur[1], v[4] + cur[0], v[5] + cur[1]]
                segs.append((cur, (v[0], v[1]), (v[2], v[3]), (v[4], v[5])))
                cur = (v[4], v[5])
        elif cmd in "Aa":
            while i < len(tokens) and NUM.fullmatch(tokens[i]):
                v = nums(7)
                end = (v[5], v[6]) if cmd == "A" else (cur[0] + v[5], cur[1] + v[6])
                segs.extend(_arc_to_cubics(cur, v[0], v[1], v[2], int(v[3]), int(v[4]), end))
                cur = end
        elif cmd in "Ll":
            while i < len(tokens) and NUM.fullmatch(tokens[i]):
                v = nums(2)
                end = (v[0], v[1]) if cmd == "L" else (cur[0] + v[0], cur[1] + v[1])
                third = ((end[0] - cur[0]) / 3.0, (end[1] - cur[1]) / 3.0)
                segs.append((cur, (cur[0] + third[0], cur[1] + third[1]),
                             (end[0] - third[0], end[1] - third[1]), end))
                cur = end
        elif cmd in "Zz":
            if segs:
                subs.append(segs)
            segs, cur = [], start
    if segs:
        subs.append(segs)
    return subs


def subpath_to_ae(segs, tip):
    """Cubic segments → AE Shape arrays (vertices + RELATIVE tangents), shifted
    so the pin's bottom tip sits at (0,0) — the layer anchor scales about it."""
    n = len(segs)
    verts, ins, outs = [], [[0.0, 0.0]] * n, []
    for k, (p0, c1, c2, p1) in enumerate(segs):
        verts.append([p0[0] - tip[0], p0[1] - tip[1]])
        outs.append([c1[0] - p0[0], c1[1] - p0[1]])
        ins_idx = (k + 1) % n
        while len(ins) <= ins_idx:
            ins.append([0.0, 0.0])
        ins[ins_idx] = [c2[0] - p1[0], c2[1] - p1[1]]
    ins = ins[:n]
    r = lambda a: [[round(x, 4), round(y, 4)] for x, y in a]
    return {"v": r(verts), "i": r(ins), "o": r(outs)}


# ---------------------------------------------------------------- build steps
def main():
    os.makedirs(ASSETS, exist_ok=True)

    # 1) logos — big renders, scaled down in comps (crisp at 4K)
    for src, out, h in (("OCHA_logo_horizontal_white.svg", "logo_horizontal_white.png", 1200),
                        ("OCHA_logo_vertical_white.svg", "logo_vertical_white.png", 1200)):
        svg2png(url=os.path.join(ROOT, "assets", src),
                write_to=os.path.join(ASSETS, out), output_height=h)
        print(f"rendered {out} (h={h})")

    # click sound — copied so premiere/ is self-contained (also bundled by the plugin later)
    shutil.copy2(os.path.join(ROOT, "brand", "OCHA_logo_click.wav"),
                 os.path.join(ASSETS, "OCHA_logo_click.wav"))
    print("copied OCHA_logo_click.wav")

    # 2) pin path → AE bezier data
    svg = open(os.path.join(ROOT, "assets", "pin_location.svg"), encoding="utf-8").read()
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    d = re.search(r'\bd="([^"]+)"', svg).group(1)
    tip = (vb[2] / 2.0, vb[3])                       # bottom-centre of the viewBox
    subs = [subpath_to_ae(s, tip) for s in parse_pin_path(d)]
    print(f"pin path: {len(subs)} subpaths, "
          f"{[len(s['v']) for s in subs]} vertices (arcs → cubics)")

    # 3) bake the brand numbers (single source of truth = the JSONs; the engine's
    #    safe-area/profile table is mirrored here — same tolerance social_brand.py has)
    lt = json.load(open(os.path.join(ROOT, "browser", "brand-lt.json"), encoding="utf-8"))
    pin = json.load(open(os.path.join(ROOT, "browser", "brand-pin.json"), encoding="utf-8"))
    data = {
        "lt": {k: lt[k] for k in ("timing", "geometry", "colors", "fonts", "uppercase_name")},
        "pin": {k: pin[k] for k in ("timing", "geometry", "colors", "fonts")},
        "safe": {  # mirrors engine/finish.py profile(); 4:5 uses the portrait bucket
            "landscape": {"top": .06, "bottom": .09, "left": .045, "right": .06},
            "portrait": {"top": .11, "bottom": .20, "left": .06, "right": .06},
            "square": {"top": .08, "bottom": .10, "left": .08, "right": .08},
        },
        "formats": [
            {"key": "reels", "label": "Reels 9x16", "w": 1080, "h": 1920, "orient": "portrait"},
            {"key": "feed45", "label": "Feed 4x5", "w": 1080, "h": 1350, "orient": "portrait"},
            {"key": "square", "label": "Square 1x1", "w": 1080, "h": 1080, "orient": "square"},
            {"key": "event", "label": "Event 16x9", "w": 1920, "h": 1080, "orient": "landscape"},
        ],
        "bug_height_frac": 0.065,      # mirrors finish.py BUG_HEIGHT_FRAC
        "ending": {"logo_frac": 0.054, "lead_in": 0.30, "hold": 1.5},  # click peak @0.30s → snap
        "pin_path": {"w": vb[2], "h": vb[3], "subs": subs},
        "assets": {"logo_h": "assets/logo_horizontal_white.png",
                   "logo_v": "assets/logo_vertical_white.png",
                   "click": "assets/OCHA_logo_click.wav"},
    }

    # 4) inject into the template → single runnable JSX
    tpl = open(TEMPLATE, encoding="utf-8").read()
    baked = json.dumps(data, indent=1)
    out = tpl.replace("/*__BAKED_DATA__*/ null", baked)
    if out == tpl:
        raise SystemExit("template placeholder not found — src/builder_template.jsx changed?")
    open(GEN_JSX, "w", encoding="utf-8").write(out)
    print(f"wrote {os.path.relpath(GEN_JSX, ROOT)}  "
          f"({len(out.splitlines())} lines — run this in After Effects)")


if __name__ == "__main__":
    main()
