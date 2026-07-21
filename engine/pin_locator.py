#!/usr/bin/env python3
"""
OCHA pin locator (location strip) — animated place + date, top-left.

A map-pin icon beside a UN-blue rectangle carrying two white lines:
  TOP  = place  (Raleway ExtraBold)   e.g. "Ankara, Türkiye"
  BOT  = date   (Raleway Medium)      e.g. "June 2026"

Rendered as a transparent PNG sequence and composited by finish.py (Titles &
branding) and social_brand.py (statement clips), the same way lower_third.py is.
Numbers live once in browser/brand-pin.json; the drawing logic is here.

Motion (locked, mirrors the lower third's language — see engine/lower_third.py):
  * no fade. The rectangle reveals as TWO stacked bands, each a left-anchored
    wipe: the top (place) line leads, the bottom (date) line follows a beat later
    so the two never appear/disappear together. Exit is the exact reverse.
  * the pin does NOT fade — it SCALES in with a subtle rebound, anchored at its
    very bottom tip, so it grows bottom→top (and shrinks back to the tip on exit).
  * the pin can be toggled off; the text block then shifts left into its space.
  * cubic ease-in-out on the wipes; back-ease-out (overshoot) on the pin scale-in.
"""
import argparse
import json
import math
import os
import re
import shutil

from PIL import ImageFont

from svgpng import svg2png as _svg2png, font_path as _font_path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_FILE = os.path.join(ROOT, "browser", "brand-pin.json")
SPEC = json.load(open(SPEC_FILE, encoding="utf-8"))
_T, _G, _C, _F = SPEC["timing"], SPEC["geometry"], SPEC["colors"], SPEC["fonts"]

FONTS = {800: _font_path("Raleway-ExtraBold.ttf"), 500: _font_path("Raleway-Medium.ttf")}

# the pin icon: a single path (OCHA Humanitarian "Location"); parsed once, recoloured per render
PIN_SVG = os.path.join(ROOT, "assets", "pin_location.svg")
_pin_src = open(PIN_SVG, encoding="utf-8").read()
_PIN_VB = [float(v) for v in re.search(r'viewBox="([^"]+)"', _pin_src).group(1).split()]
_PIN_W, _PIN_H = _PIN_VB[2], _PIN_VB[3]          # 32 x 47.867 — tip (bottom-centre) at (16, 47.867)
_PIN_D = re.search(r'\bd="([^"]+)"', _pin_src).group(1)

esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# entrance / exit envelope (canvas-independent seconds)
ENTER_END = max(_T["pin_in"],
                _T["line1_delay"] + _T["line1_in"],
                _T["line1_delay"] + _T["line2_delay"] + _T["line2_in"])
EXIT_DUR = max(_T["line2_out"],
               _T["line1_out_delay"] + _T["line1_out"],
               _T["pin_out_delay"] + _T["pin_out"])


def _c01(x):
    return max(0.0, min(1.0, x))


def ease(x):                                     # cubic ease-in-out
    x = _c01(x)
    return 4 * x ** 3 if x < 0.5 else 1 - ((-2 * x + 2) ** 3) / 2


def back_out(x, s=_T["pin_overshoot"]):          # ease-out with a subtle overshoot (the rebound)
    x = _c01(x) - 1.0
    return 1 + (s + 1) * x ** 3 + s * x ** 2


def _peak_scale(s):
    """The crest of back_out over x∈[0,1] — how far past 1× the rebound reaches
    (e.g. s=0.9 → ≈1.03, a 3% overshoot). Used to size the anti-crop headroom so
    the value tracks pin_overshoot automatically if it's ever retuned."""
    if s <= 0:
        return 1.0
    u = -2 * s / (3 * (s + 1))                   # where d/dx back_out = 0 → the overshoot peak
    return 1 + (s + 1) * u ** 3 + s * u ** 2


def total(hold):
    return ENTER_END + hold + EXIT_DUR


def orient_of(w, h):
    r = w / h
    return "landscape" if r > 1.25 else ("portrait" if r < 0.85 else "square")


def state(t, hold):
    """(pin_scale, line1_reveal, line2_reveal) at time t. pin_scale may exceed 1
    briefly (the rebound); reveals are clamped to [0,1]."""
    if t < ENTER_END:                                              # entrance
        pin = back_out(t / _T["pin_in"]) if t < _T["pin_in"] else 1.0
        l1 = ease((t - _T["line1_delay"]) / _T["line1_in"])
        l2 = ease((t - _T["line1_delay"] - _T["line2_delay"]) / _T["line2_in"])
    elif t < ENTER_END + hold:                                     # hold
        pin, l1, l2 = 1.0, 1.0, 1.0
    else:                                                          # exit — reverse order
        e = t - (ENTER_END + hold)
        l2 = 1 - ease(e / _T["line2_out"])
        l1 = 1 - ease((e - _T["line1_out_delay"]) / _T["line1_out"])
        pin = 1 - ease((e - _T["pin_out_delay"]) / _T["pin_out"])
    return max(0.0, pin), _c01(l1), _c01(l2)


def _mw(text, weight, size):
    return ImageFont.truetype(FONTS[weight], size).getbbox(text)[2]


def build(lt, canvas_h=None, orient="portrait"):
    """Geometry for one pin locator. `lt` keys: place, date, icon (bool),
    color ("red"|"blue"), hold, in. size = line1_ratio·canvas (px)."""
    place = (lt.get("place") or "").strip()
    date = (lt.get("date") or "").strip()
    icon_on = lt.get("icon", True)
    s1 = lt.get("line1_size") or max(16, round(canvas_h * _G["line1_ratio"][orient])) if canvas_h else 54
    s2 = max(12, round(s1 * _G["line2_scale"]))
    padx, pady = round(s1 * _G["pad_x"]), round(s1 * _G["pad_y"])
    gap = round(s1 * _G["line_gap"])

    w1 = _mw(place, 800, s1) if place else 0
    w2 = _mw(date, 500, s2) if date else 0
    box_w = max(w1, w2) + 2 * padx
    box_h = 2 * pady + s1 + gap + s2

    pin_h = round(box_h * _G["pin_scale"]) if icon_on else 0
    pin_w = round(pin_h * _PIN_W / _PIN_H) if icon_on else 0
    pin_gap = round(s1 * _G["pin_gap"]) if icon_on else 0

    core_h = max(box_h, pin_h)
    # The pin scales in from its bottom tip and briefly overshoots >1×, growing up
    # and slightly out. Pad the PNG's top+left edges by that crest so it's NEVER
    # clipped there; the compositor then shifts the overlay back by `pad` (up-left,
    # into the safe margin) so the box's on-screen position is unchanged.
    pad = (math.ceil(pin_h * (_peak_scale(_T["pin_overshoot"]) - 1)) + max(4, round(pin_h * 0.03))) if icon_on else 0
    box_x = pad + pin_w + pin_gap                 # 0 when the icon is off → text shifts left
    box_y = pad + round((core_h - box_h) / 2)
    split_y = box_y + pady + s1 + round(gap / 2)   # where the top band meets the bottom band

    return dict(place=place, date=date, icon_on=icon_on,
                color=_C["pin_blue"] if lt.get("color") == "blue" else _C["pin_red"],
                s1=s1, s2=s2, padx=padx, pady=pady, gap=gap,
                box_x=box_x, box_y=box_y, box_w=box_w, box_h=box_h, split_y=split_y,
                pin_w=pin_w, pin_h=pin_h, pad=pad, core_h=core_h,
                W=box_x + box_w, H=pad + core_h,
                hold=lt.get("hold", 3.7), t_in=lt.get("in", 1.2),
                top=lt.get("top"), left=lt.get("left"))


def _pin_group(g, pin_s):
    """The map pin, scaled by `pin_s` about its bottom tip (bottom-centre), placed
    left of the box and vertically centred on the full element."""
    rs = g["pin_h"] / _PIN_H                       # viewBox units → pixels
    pw, ph = g["pin_w"], g["pin_h"]
    px, py = g["pad"], g["pad"] + round((g["core_h"] - ph) / 2)   # inside the headroom, vertically centred
    tipx, tipy = pw / 2, ph                         # bottom-centre = the teardrop point
    # right-to-left: scale to px → move tip to origin → scale about tip → move back → position
    tf = (f"translate({px + 0:.2f},{py:.2f}) translate({tipx:.2f},{tipy:.2f}) "
          f"scale({pin_s:.4f}) translate({-tipx:.2f},{-tipy:.2f}) scale({rs:.5f})")
    return f'<g transform="{tf}"><path d="{_PIN_D}" fill="{g["color"]}"/></g>'


def svg(g, pin_s, l1r, l2r):
    W, H = g["W"], g["H"]
    bx, by, bw, bh = g["box_x"], g["box_y"], g["box_w"], g["box_h"]
    sy = g["split_y"]
    band1_h, band2_h = sy - by, (by + bh) - sy
    fam, bg, tc = _F["family"], _C["rect_bg"], _C["text"]
    # each line centred vertically in its own band-worth of space
    y1 = by + g["pady"] + g["s1"] / 2
    y2 = by + g["pady"] + g["s1"] + g["gap"] + g["s2"] / 2
    tx = bx + g["padx"]
    t1 = (f'<text x="{tx:.1f}" y="{y1:.1f}" font-family="{fam}" font-weight="{_F["line1_weight"]}" '
          f'font-size="{g["s1"]}" fill="{tc}" text-anchor="start" dominant-baseline="central" '
          f'letter-spacing="{_G["letter_spacing"]}">{esc(g["place"])}</text>') if g["place"] else ""
    t2 = (f'<text x="{tx:.1f}" y="{y2:.1f}" font-family="{fam}" font-weight="{_F["line2_weight"]}" '
          f'font-size="{g["s2"]}" fill="{tc}" text-anchor="start" dominant-baseline="central">'
          f'{esc(g["date"])}</text>') if g["date"] else ""
    band1 = (f'<g clip-path="url(#p1)"><rect x="{bx}" y="{by}" width="{bw}" height="{band1_h}" fill="{bg}"/>{t1}</g>')
    band2 = (f'<g clip-path="url(#p2)"><rect x="{bx}" y="{sy}" width="{bw}" height="{band2_h}" fill="{bg}"/>{t2}</g>')
    pin = _pin_group(g, pin_s) if g["icon_on"] and pin_s > 0.001 else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">'
            f'<defs>'
            f'<clipPath id="p1"><rect x="{bx}" y="{by}" width="{l1r * bw:.2f}" height="{band1_h}"/></clipPath>'
            f'<clipPath id="p2"><rect x="{bx}" y="{sy}" width="{l2r * bw:.2f}" height="{band2_h}"/></clipPath>'
            f'</defs>{band1}{band2}{pin}</svg>')


def render_seq(g, fps, outdir):
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir)
    n = int(round(total(g["hold"]) * fps))
    for i in range(n):
        pin_s, l1r, l2r = state(i / fps, g["hold"])
        _svg2png(bytestring=svg(g, pin_s, l1r, l2r).encode(),
                 write_to=os.path.join(outdir, f"{i:04d}.png"),
                 output_width=g["W"], output_height=g["H"])
    return n


def render(place, date, canvas_h, fps, hold, outdir, icon=True, color="red", orient="portrait"):
    """finish.py-compatible API: returns {dir, frames, W, H, total}."""
    g = build({"place": place, "date": date, "icon": icon, "color": color, "hold": hold},
              canvas_h=canvas_h, orient=orient)
    n = render_seq(g, fps, outdir)
    return {"dir": outdir, "frames": n, "W": g["W"], "H": g["H"], "total": total(hold),
            "pad": g["pad"]}         # compositor shifts the overlay up-left by this to undo the headroom


DEFAULT_START = 4.0                  # matches the panel default; see specs() below
DEFAULT_DURATION = 5.0


def specs(spec):
    """The ONE reader of a render spec's location strips — shared by finish.py and
    social_brand.py so the two tabs can never drift apart.

    Accepts either shape and always returns a clean list:
      {"pins": [ {...}, {...} ]}   the multi-strip UI
      {"pin":  {...} }             a single strip — projects saved before Jul 2026,
                                   and any old engine copy still posting one object
    Strips that are off, or have neither a place nor a date, are dropped here, so
    callers can just iterate. Defaults live here and nowhere else.
    """
    raw = spec.get("pins")
    if raw is None:
        one = spec.get("pin")
        raw = [one] if one else []
    elif isinstance(raw, dict):                      # a lone object under the new key
        raw = [raw]
    out = []
    for p in raw:
        if not isinstance(p, dict) or not p.get("on"):
            continue
        place, date = (p.get("place") or "").strip(), (p.get("date") or "").strip()
        if not (place or date):
            continue
        out.append({
            "on": True,                              # keeps the result idempotent: feeding
            "place": place, "date": date,            # specs() its own output returns the same list

            "icon": p.get("icon", True),
            "color": p.get("color", "red"),
            "start": max(0.0, float(p.get("start", DEFAULT_START))),
            "duration": max(2.0, float(p.get("duration", DEFAULT_DURATION))),
        })
    return out


def hold_for(duration):
    """Seconds the strip sits still, given the total on-screen time the user asked
    for. The in/out animations are fixed-length, so they come out of the total."""
    return max(0.4, float(duration) - ENTER_END - EXIT_DUR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--place", required=True)
    ap.add_argument("--date", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--canvas-h", type=int, default=1920)
    ap.add_argument("--orient", choices=["portrait", "square", "landscape"], default="portrait")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--hold", type=float, default=3.7)
    ap.add_argument("--no-icon", action="store_true")
    ap.add_argument("--color", choices=["red", "blue"], default="red")
    args = ap.parse_args()
    r = render(args.place, args.date, args.canvas_h, args.fps, args.hold, args.out,
               icon=not args.no_icon, color=args.color, orient=args.orient)
    print(f"frames -> {r['dir']} ({r['frames']} frames, {r['W']}x{r['H']}, total {r['total']:.2f}s)")


if __name__ == "__main__":
    main()
