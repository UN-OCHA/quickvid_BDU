#!/usr/bin/env python3
"""
OCHA animated lower third — THE canonical implementation.

Look B (compact / ASG Ukraine reference), chosen by Javier 2026-07-12 as the one
standard. Every mode renders lower thirds through this module:

  - Titles & branding (Full mode)  -> finish.py calls render()
  - Statement clips (Edit mode)    -> social_brand.py calls build()/render_seq()
  - Browser (Lite mode, JS canvas) -> browser/engine.js reads the SAME numbers
                                      from browser/brand-lt.json

The NUMBERS (timings, ratios, colors) live once in browser/brand-lt.json — this
module loads them at import. Change the look there; it lands everywhere. (The
JS draws on canvas, so its drawing code mirrors this file's logic — keep the
two in step when changing LOGIC, not just numbers.)

Style (locked): NAME black on white box, uppercase, Raleway Bold; TITLE line(s)
white on OCHA-cyan bar below, Raleway Medium — supports a bilingual 2nd line.
Motion (locked): no fade; left-anchored wipe; NAME first, TITLE follows and
pans slightly as it settles; exit is the exact reverse; cubic ease-in-out.
"""
import argparse
import json
import os
import shutil

from PIL import ImageFont

from svgpng import svg2png as _svg2png, font_path as _font_path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_FILE = os.path.join(ROOT, "browser", "brand-lt.json")
SPEC = json.load(open(SPEC_FILE, encoding="utf-8"))
_T, _G, _C = SPEC["timing"], SPEC["geometry"], SPEC["colors"]

FONTS = {700: _font_path("Raleway-Bold.ttf"), 500: _font_path("Raleway-Medium.ttf")}

# motion timing (seconds) — canvas-independent
NAME_IN, ORG_DELAY, ORG_IN = _T["name_in"], _T["org_delay"], _T["org_in"]
ORG_OUT, NAME_OUT_DELAY, NAME_OUT = _T["org_out"], _T["name_out_delay"], _T["name_out"]
ENTER_END = ORG_DELAY + ORG_IN
EXIT_DUR = NAME_OUT_DELAY + NAME_OUT

esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def ease(x):                                          # cubic ease-in-out ("easy ease")
    x = max(0.0, min(1.0, x))
    return 4 * x ** 3 if x < 0.5 else 1 - ((-2 * x + 2) ** 3) / 2


def total(hold):
    return ENTER_END + hold + EXIT_DUR


def orient_of(w, h):
    r = w / h
    return "landscape" if r > 1.25 else ("portrait" if r < 0.85 else "square")


def _mw(text, weight, size):
    return ImageFont.truetype(FONTS[weight], size).getbbox(text)[2]


def state(t, hold):
    """(name_reveal, org_reveal, org_pan_fraction) at time t."""
    if t < ENTER_END:
        nr = ease(t / NAME_IN)
        ot = t - ORG_DELAY
        orr, pan = (0.0, 1.0) if ot <= 0 else ((p := ease(ot / ORG_IN)), 1 - p)
    elif t < ENTER_END + hold:
        nr, orr, pan = 1.0, 1.0, 0.0
    else:
        e = t - (ENTER_END + hold)
        po = ease(e / ORG_OUT)
        orr, pan = 1 - po, po
        nr = 1.0 if e <= NAME_OUT_DELAY else 1 - ease((e - NAME_OUT_DELAY) / NAME_OUT)
    return max(0.0, min(1.0, nr)), max(0.0, min(1.0, orr)), pan


def build(lt, canvas_h=None, orient="portrait"):
    """Geometry for one lower third. `lt` keys: name, org|titles[], align,
    hold, in, bottom, left, name_size?/org_size? (explicit px override the
    canvas-relative spec sizing)."""
    name = lt["name"].upper() if SPEC.get("uppercase_name", True) else lt["name"]
    titles = [t for t in (lt.get("titles") or ([lt.get("org")] if lt.get("org") else [])) if t]
    nsize = lt.get("name_size") or (max(20, round(canvas_h * _G["name_ratio"][orient])) if canvas_h else 44)
    osize = lt.get("org_size") or max(12, round(nsize * _G["org_scale"]))
    npx, npy = round(nsize * _G["name_pad_x"]), round(nsize * _G["name_pad_y"])
    opx, opy, oline = round(osize * _G["org_pad_x"]), round(osize * _G["org_pad_y"]), round(osize * _G["org_line"])
    nw = _mw(name, 700, nsize) + 2 * npx
    # per-row title band widths (2026-07-23, matching the plugin templates): each
    # cyan row hugs ITS OWN line's text — a single max-width band left the shorter
    # line with a cyan overhang. `ow` (the max) still sizes the canvas + wipe clip.
    ows = [_mw(t, 500, osize) + 2 * opx for t in titles]
    ow = max(ows) if ows else 0
    nh = nsize + 2 * npy
    oh = (2 * opy + (len(titles) - 1) * oline + osize) if titles else 0
    pan = round(nsize * _G["pan"])
    bw = max(nw, ow)
    return dict(name=name, titles=titles, nsize=nsize, osize=osize,
                align=lt.get("align", "center"), npx=npx, opx=opx, opy=opy, oline=oline,
                nw=nw, ow=ow, ows=ows, nh=nh, oh=oh, pan=pan, BW=bw, W=bw + 2 * pan, H=nh + oh,
                hold=lt.get("hold", 3.6), t_in=lt.get("in", 1.5),
                bottom=lt.get("bottom"), left=lt.get("left"))


def svg(g, nr, orr, panf):
    W, H, pan, oy = g["W"], g["H"], g["pan"], g["nh"]
    p = panf * pan
    if g["align"] == "left":
        nx, ox = pan, pan + p
        na = oa = "start"; ntx, otx = nx + g["npx"], ox + g["opx"]
    else:
        nx, ox = (W - g["nw"]) / 2, (W - g["ow"]) / 2 + p
        na = oa = "middle"; ntx, otx = W / 2, ox + g["ow"] / 2
    nrw, orw = nr * g["nw"], orr * g["ow"]
    ty0 = oy + g["opy"] + g["osize"] * 0.82
    org = "".join(
        f'<text x="{otx:.1f}" y="{ty0 + i * g["oline"]:.0f}" font-family="{SPEC["fonts"]["family"]}" '
        f'font-weight="{SPEC["fonts"]["org_weight"]}" font-size="{g["osize"]}" fill="{_C["org_text"]}" '
        f'text-anchor="{oa}">{esc(t)}</text>'
        for i, t in enumerate(g["titles"]))
    # PER-ROW cyan bands (each hugs its own line's text — matches the plugin
    # templates); the wipe clip #co still spans the max width, like the AE matte.
    rows = ""
    if g["titles"]:
        n_t = len(g["titles"])
        row_h = g["oh"] / n_t
        for i, w_i in enumerate(g["ows"]):
            rx = (ox if g["align"] == "left" else (W - w_i) / 2 + p)
            rows += (f'<rect x="{rx:.2f}" y="{oy + i * row_h:.2f}" width="{w_i}" '
                     f'height="{row_h:.2f}" fill="{_C["org_bg"]}"/>')
    org_group = f'<g clip-path="url(#co)">{rows}{org}</g>' if g["titles"] else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">'
            f'<defs><clipPath id="cn"><rect x="{nx:.2f}" y="0" width="{nrw:.2f}" height="{g["nh"]}"/></clipPath>'
            f'<clipPath id="co"><rect x="{ox:.2f}" y="{oy}" width="{orw:.2f}" height="{g["oh"]}"/></clipPath></defs>'
            f'<g clip-path="url(#cn)"><rect x="{nx:.2f}" y="0" width="{g["nw"]}" height="{g["nh"]}" fill="{_C["name_bg"]}"/>'
            f'<text x="{ntx:.1f}" y="{g["nh"] / 2:.1f}" font-family="{SPEC["fonts"]["family"]}" '
            f'font-weight="{SPEC["fonts"]["name_weight"]}" font-size="{g["nsize"]}" fill="{_C["name_text"]}" '
            f'text-anchor="{na}" dominant-baseline="central" '
            f'letter-spacing="{_G["letter_spacing"]}">{esc(g["name"])}</text></g>'
            f'{org_group}</svg>')


def render_seq(g, fps, outdir):
    """Render the animation to `outdir` as NNNN.png frames; returns frame count."""
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir)
    n = int(round(total(g["hold"]) * fps))
    for i in range(n):
        nr, orr, panf = state(i / fps, g["hold"])
        _svg2png(bytestring=svg(g, nr, orr, panf).encode(),
                 write_to=os.path.join(outdir, f"{i:04d}.png"),
                 output_width=g["W"], output_height=g["H"])
    return n


def render(name, org, canvas_h, align, fps, hold, outdir, name_ratio=None, orient="portrait", org2=None):
    """finish.py-compatible API. Sizes come from the shared spec (per
    orientation); an explicit name_ratio still overrides for special cases.
    org2 = optional second title line (bilingual)."""
    lt = {"name": name, "titles": [t for t in [org, org2] if t], "align": align, "hold": hold}
    if name_ratio:
        lt["name_size"] = max(20, round(canvas_h * name_ratio))
    g = build(lt, canvas_h=canvas_h, orient=orient)
    n = render_seq(g, fps, outdir)
    block_left = g["pan"] if align == "left" else (g["W"] - g["BW"]) / 2
    return {"dir": outdir, "frames": n, "W": g["W"], "H": g["H"],
            "BW": g["BW"], "block_left": block_left, "total": total(hold)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--org", required=True)
    ap.add_argument("--out", required=True, help="output frames dir")
    ap.add_argument("--canvas-h", type=int, default=1920)
    ap.add_argument("--orient", choices=["portrait", "square", "landscape"], default="portrait")
    ap.add_argument("--align", choices=["center", "left"], default="center")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--hold", type=float, default=3.4)
    args = ap.parse_args()
    g = render(args.name, args.org, args.canvas_h, args.align, args.fps, args.hold,
               args.out, orient=args.orient)
    print(f"frames -> {g['dir']} ({g['frames']} frames, {g['W']}x{g['H']}, block {g['BW']}px)")


if __name__ == "__main__":
    main()
