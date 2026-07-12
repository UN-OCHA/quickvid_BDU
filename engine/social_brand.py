#!/usr/bin/env python3
"""
OCHA social branding pass — captions + animated lower third(s) + OCHA logo ending.

Library + CLI port of the proven ocha-social-subtitles renderer (Venezuela USG /
ASG Ukraine builds), for the QuickVid engine. Everything is rendered as
transparent PNGs via cairosvg (this Mac's ffmpeg has no libfreetype — and PNG
layers are the better approach anyway) and composited with ffmpeg overlay.

House rules baked in (locked — see docs/decisions.md):
  * Captions HARD-CUT on/off (no fade), half-open interval. Two styles:
      box=True  -> grey rounded box (social feed look)
      box=False -> plain white text over a subtle bottom GRADIENT (event look);
                   the gradient gives the contrast — never a text outline.
  * Lower third = the locked wipe motion (engine/lower_third.py timing), 1–2
    title lines, centre or left. Rendered as a PNG SEQUENCE (ffmpeg `enable=`
    can only hard-cut, never animate).
  * Captions lift to a higher row while a lower third is on screen.
  * Ending: OCHA logo SNAPS on (no fade) — over the footage itself or over
    black — with the OCHA click sound timed to the snap; NEVER a scrim layer
    behind the logo; logo rasterized from the SVG at render time (never a PNG
    asset). Speech stays full level (amix normalize=0).
  * Sentence case across cues: capital after a cue that ends in . ! ?

Spec (JSON; library entry point is render(spec, log)):
{
  "src": "...", "out": "...", "canvas": [W,H]?, "fps": 30?,
  "footage_end": 74.0?,            // where speech content ends (captions never pass it)
  "subtitle": {"box": true, "size": 46, ...},          // merged over per-canvas defaults
  "cues": [[start, "text"], ...],                      // end = next start; "" = boundary
  "lower_thirds": [{"name": "...", "titles": ["…","…"], "align": "center",
                     "in": 1.5, "hold": 3.6, "bottom": px?, "name_size": px?, "org_size": px?}],
  "ending": {"style": "over_footage" | "over_black" | "none",
              "at": secs?,          // logo snap time; default footage_end
              "hold": 2.0, "click": true, "logo_ratio": 0.077}
}
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

from svgpng import svg2png as _svg2png   # cairosvg, or portable resvg on Macs without Homebrew
from PIL import ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = os.environ.get("IMAGEIO_FFMPEG_EXE") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = FF.replace("ffmpeg", "ffprobe")
LOGO_SVG = os.path.join(ROOT, "assets", "OCHA_logo_horizontal_white.svg")
BRAND_JSON = os.path.join(ROOT, "brand", "brand.json")
from svgpng import font_path as _font_path             # bundled fonts first - identical on every machine
FONTS = {700: _font_path("Raleway-Bold.ttf"), 600: _font_path("Raleway-SemiBold.ttf"),
         500: _font_path("Raleway-Medium.ttf")}
CYAN, WHITE, BLACK = "#009EDB", "#FFFFFF", "#000000"

esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
def _mw(text, weight, size): return ImageFont.truetype(FONTS[weight], size).getbbox(text)[2]


# ---------------- locked lower-third motion (see engine/lower_third.py) ----------------
NAME_IN, ORG_DELAY, ORG_IN = 0.50, 0.26, 0.50
ENTER_END = ORG_DELAY + ORG_IN
ORG_OUT, NAME_OUT_DELAY, NAME_OUT = 0.44, 0.20, 0.44
EXIT_DUR = NAME_OUT_DELAY + NAME_OUT

def _ease(x):
    x = max(0.0, min(1.0, x))
    return 4 * x ** 3 if x < 0.5 else 1 - ((-2 * x + 2) ** 3) / 2

def _lt_total(hold): return ENTER_END + hold + EXIT_DUR

def _lt_state(t, hold):
    if t < ENTER_END:
        nr = _ease(t / NAME_IN); ot = t - ORG_DELAY
        orr, pan = (0.0, 1.0) if ot <= 0 else ((p := _ease(ot / ORG_IN)), 1 - p)
    elif t < ENTER_END + hold:
        nr, orr, pan = 1.0, 1.0, 0.0
    else:
        e = t - (ENTER_END + hold); po = _ease(e / ORG_OUT); orr, pan = 1 - po, po
        nr = 1.0 if e <= NAME_OUT_DELAY else 1 - _ease((e - NAME_OUT_DELAY) / NAME_OUT)
    return max(0, min(1, nr)), max(0, min(1, orr)), pan


def _build_lt(lt):
    name = lt["name"].upper()
    titles = [t for t in (lt.get("titles") or ([lt["org"]] if lt.get("org") else [])) if t]
    nsize, osize = lt.get("name_size", 44), lt.get("org_size", 26)
    npx, npy = round(nsize * 0.6), round(nsize * 0.32)
    opx, opy, oline = round(osize * 0.85), round(osize * 0.55), round(osize * 1.42)
    nw = _mw(name, 700, nsize) + 2 * npx
    ow = (max(_mw(t, 500, osize) for t in titles) + 2 * opx) if titles else 0
    nh = nsize + 2 * npy
    oh = (2 * opy + (len(titles) - 1) * oline + osize) if titles else 0
    pan = round(nsize * 0.5); bw = max(nw, ow)
    return dict(name=name, titles=titles, nsize=nsize, osize=osize,
                align=lt.get("align", "center"), npx=npx, opx=opx, opy=opy, oline=oline,
                nw=nw, ow=ow, nh=nh, oh=oh, pan=pan, BW=bw, W=bw + 2 * pan, H=nh + oh,
                hold=lt.get("hold", 3.6), t_in=lt.get("in", 1.5),
                bottom=lt.get("bottom"), left=lt.get("left"))


def _lt_svg(g, nr, orr, panf):
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
        f'<text x="{otx:.1f}" y="{ty0 + i * g["oline"]:.0f}" font-family="Raleway" font-weight="500" '
        f'font-size="{g["osize"]}" fill="{WHITE}" text-anchor="{oa}">{esc(t)}</text>'
        for i, t in enumerate(g["titles"]))
    org_group = (f'<g clip-path="url(#co)"><rect x="{ox:.2f}" y="{oy}" width="{g["ow"]}" height="{g["oh"]}" '
                 f'fill="{CYAN}"/>{org}</g>') if g["titles"] else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">'
            f'<defs><clipPath id="cn"><rect x="{nx:.2f}" y="0" width="{nrw:.2f}" height="{g["nh"]}"/></clipPath>'
            f'<clipPath id="co"><rect x="{ox:.2f}" y="{oy}" width="{orw:.2f}" height="{g["oh"]}"/></clipPath></defs>'
            f'<g clip-path="url(#cn)"><rect x="{nx:.2f}" y="0" width="{g["nw"]}" height="{g["nh"]}" fill="{WHITE}"/>'
            f'<text x="{ntx:.1f}" y="{g["nh"] / 2:.1f}" font-family="Raleway" font-weight="700" font-size="{g["nsize"]}" '
            f'fill="{BLACK}" text-anchor="{na}" dominant-baseline="central" letter-spacing="0.5">{esc(g["name"])}</text></g>'
            f'{org_group}</svg>')


def _render_lt_seq(g, fps, outdir):
    shutil.rmtree(outdir, ignore_errors=True); os.makedirs(outdir)
    n = int(round(_lt_total(g["hold"]) * fps))
    for i in range(n):
        nr, orr, panf = _lt_state(i / fps, g["hold"])
        _svg2png(bytestring=_lt_svg(g, nr, orr, panf).encode(),
                         write_to=os.path.join(outdir, f"{i:04d}.png"),
                         output_width=g["W"], output_height=g["H"])
    return n


# ---------------- captions ----------------
def _sub_png(text, sub, path):
    weight = sub.get("weight", 500); size = sub["size"]; maxw = sub["max_w"]
    f = ImageFont.truetype(FONTS[weight], size)
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if f.getbbox(t)[2] <= maxw or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    px, py = sub["pad"]; lh = int(size * sub["line_h"])
    tw = max(f.getbbox(l)[2] for l in lines)
    w = int(tw + 2 * px); h = int(len(lines) * lh + 2 * py); cx = w / 2; y0 = py + lh / 2
    tsp = "".join(f'<tspan x="{cx:.1f}" y="{y0 + i * lh:.1f}">{esc(l)}</tspan>' for i, l in enumerate(lines))
    common = (f'font-family="Raleway" font-weight="{weight}" font-size="{size}" '
              f'text-anchor="middle" dominant-baseline="central"')
    if sub.get("box", True):
        bg = (f'<rect width="{w}" height="{h}" rx="{sub["radius"]}" ry="{sub["radius"]}" '
              f'fill="{sub.get("box_color", "#3F3F3F")}" fill-opacity="{sub["opacity"]}"/>')
    else:
        bg = ""                    # event style: contrast comes from the bottom gradient
    _svg2png(bytestring=(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">'
                                 f'{bg}<text {common} fill="{WHITE}">{tsp}</text></svg>').encode(),
                     write_to=path, output_width=w, output_height=h)
    return w, h


def fix_sentence_caps(texts):
    """Capital after a cue that ends a sentence (. ! ? …) — running-speech rule."""
    out, want_cap = [], True
    for t in texts:
        t = t.strip()
        if t and want_cap:
            for i, ch in enumerate(t):
                if ch.isalpha():
                    t = t[:i] + ch.upper() + t[i + 1:]
                    break
        if t:
            want_cap = t.rstrip('"”’)').endswith((".", "!", "?", "…"))
        out.append(t)
    return out


def probe(src):
    r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height,r_frame_rate",
                        "-show_entries", "format=duration", "-of", "json", src],
                       capture_output=True, text=True, check=True)
    j = json.loads(r.stdout); st = j["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    return st["width"], st["height"], round(float(num) / float(den)) or 30, float(j["format"]["duration"])


SUB_DEFAULTS = dict(size=44, max_w=800, box=True, box_color="#3F3F3F", opacity=0.75, radius=16,
                    pad=[22, 14], line_h=1.28, weight=500, bottom_hi=806, bottom_lo=900,
                    gradient_h_frac=0.42, gradient_opacity=0.80)


def render(spec: dict, log=print) -> str:
    src, out = spec["src"], spec["out"]
    pw, ph, pfps, dur = probe(src)
    W, H = spec.get("canvas") or [pw, ph]
    fps = spec.get("fps") or pfps
    sub = {**SUB_DEFAULTS, **(spec.get("subtitle") or {})}
    end = spec.get("ending") or {"style": "none"}
    style = end.get("style", "none")
    footage_end = float(spec.get("footage_end") or dur)
    at = float(end.get("at") or footage_end)          # when the logo snaps on
    hold = float(end.get("hold", 2.0))
    work = os.path.join(os.path.dirname(os.path.abspath(out)), "_brand_work")
    os.makedirs(work, exist_ok=True)

    # cues: end = next start; last ends at footage_end; "" = boundary only
    raw = spec.get("cues") or []
    texts = fix_sentence_caps([t for _, t in raw])
    cues = [(float(s), float(raw[i + 1][0]) if i + 1 < len(raw) else footage_end, texts[i])
            for i, (s, _) in enumerate(raw)]

    lts = [_build_lt(lt) for lt in (spec.get("lower_thirds") or []) if lt.get("name")]
    windows = [(g["t_in"], g["t_in"] + _lt_total(g["hold"])) for g in lts]

    def cue_bottom(s, e):
        lifted = any(s < w1 and e > w0 for (w0, w1) in windows)
        return sub["bottom_hi"] if lifted else sub["bottom_lo"]

    log("Rendering caption + title layers…")
    subs = []
    for i, (s, e, t) in enumerate(cues):
        if not t:
            continue
        p = os.path.join(work, f"sub{i}.png")
        w, h = _sub_png(t, sub, p)
        subs.append((s, e, p, w, h))
    for i, g in enumerate(lts):
        g["dir"] = os.path.join(work, f"lt{i}")
        _render_lt_seq(g, fps, g["dir"])

    grad_png = None
    grad_h = round(H * sub["gradient_h_frac"])
    if subs and not sub.get("box", True):             # event look: bottom gradient scrim
        grad_png = os.path.join(work, "gradient.png")
        _svg2png(bytestring=(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{grad_h}">'
            f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="#000" stop-opacity="0"/>'
            f'<stop offset="1" stop-color="#000" stop-opacity="{sub["gradient_opacity"]}"/>'
            f'</linearGradient></defs><rect width="{W}" height="{grad_h}" fill="url(#g)"/></svg>').encode(),
            write_to=grad_png, output_width=W, output_height=grad_h)

    logo_png = None; lw = lh_ = 0; click_mov = None
    if style != "none":
        logo_png = os.path.join(work, "logo.png")     # always rasterized fresh from the SVG
        _svg2png(url=LOGO_SVG, write_to=logo_png,
                         output_height=round(H * float(end.get("logo_ratio", 0.077))))
        from PIL import Image
        lw, lh_ = Image.open(logo_png).size
        if end.get("click", True) and os.path.exists(BRAND_JSON):
            asset = json.loads(open(BRAND_JSON).read()).get("ending", {}).get("asset")
            cm = os.path.join(ROOT, asset) if asset else None
            if cm and os.path.exists(cm):
                click_mov = cm

    out_dur = dur if style == "over_footage" else (at + hold if style == "over_black" else footage_end)

    inputs = ["-i", src]
    for _, _, p, _, _ in subs:
        inputs += ["-i", p]
    idx = 1 + len(subs); lt_idx = []
    for g in lts:
        inputs += ["-framerate", str(fps), "-start_number", "0", "-i", os.path.join(g["dir"], "%04d.png")]
        lt_idx.append(idx); idx += 1
    grad_idx = logo_idx = click_idx = None
    if grad_png:
        inputs += ["-loop", "1", "-i", grad_png]; grad_idx = idx; idx += 1
    if logo_png:
        inputs += ["-loop", "1", "-i", logo_png]; logo_idx = idx; idx += 1
    if click_mov:
        inputs += ["-i", click_mov]; click_idx = idx; idx += 1

    needs_scale = (W, H) != (pw, ph)
    fc = []
    prev = "0:v"
    if needs_scale:
        fc.append(f"[0:v]scale={W}:{H},setsar=1[v0]"); prev = "v0"
    if grad_png:                                       # under LT + captions
        fc.append(f"[{grad_idx}:v]format=rgba[grad]")
        fc.append(f"[{prev}][grad]overlay=0:{H - grad_h}[vg]"); prev = "vg"
    for k, g in enumerate(lts):
        x = ((g["left"] if g["left"] is not None else round(W * 0.06)) - g["pan"]) if g["align"] == "left" \
            else (W - g["W"]) // 2
        y = (g["bottom"] if g["bottom"] is not None else round(H * 0.90)) - g["H"]
        fc.append(f"[{lt_idx[k]}:v]setpts=PTS+{g['t_in']}/TB[ltv{k}]")
        fc.append(f"[{prev}][ltv{k}]overlay={x}:{y}:eof_action=pass:enable='gte(t,{g['t_in']})'[lb{k}]")
        prev = f"lb{k}"
    for i, (s, e, p, w, h) in enumerate(subs):        # captions HARD-CUT, half-open [s,e)
        yb = cue_bottom(s, e)
        fc.append(f"[{prev}][{i + 1}:v]overlay={(W - w) // 2}:{yb - h}:enable='gte(t,{s})*lt(t,{e})'[v{i}]")
        prev = f"v{i}"

    if style == "over_black":                          # footage cuts to black; logo snaps on
        fc.append(f"[{prev}]trim=0:{at},setpts=PTS-STARTPTS,tpad=stop_duration={hold}:color=black[vend]")
        fc.append(f"[{logo_idx}:v]format=rgba[lg]")
        fc.append(f"[vend][lg]overlay={(W - lw) // 2}:{(H - lh_) // 2}:eof_action=pass:enable='gte(t,{at})',format=yuv420p[vout]")
        fc.append(f"[0:a]atrim=0:{at},asetpts=PTS-STARTPTS,afade=t=out:st={at - 0.06:.2f}:d=0.06,apad=pad_dur={hold}[amain]")
    elif style == "over_footage":                      # logo snaps on over the running footage — no scrim, ever
        fc.append(f"[{logo_idx}:v]format=rgba[lg]")
        fc.append(f"[{prev}][lg]overlay={(W - lw) // 2}:{(H - lh_) // 2}:eof_action=pass:enable='gte(t,{at})',format=yuv420p[vout]")
        fc.append("[0:a]anull[amain]")
    else:
        fc.append(f"[{prev}]trim=0:{footage_end},setpts=PTS-STARTPTS,format=yuv420p[vout]")
        fc.append(f"[0:a]atrim=0:{footage_end},asetpts=PTS-STARTPTS[amain]")

    if click_mov and style != "none":                  # click peak @0.30s lands on the snap
        delay = int(max(0, at - 0.30) * 1000)
        fc.append(f"[{click_idx}:a]atrim=0:0.7,asetpts=PTS-STARTPTS,adelay={delay}|{delay}[ca]")
        fc.append("[amain][ca]amix=inputs=2:duration=first:normalize=0[aout]")
    else:
        fc.append("[amain]anull[aout]")

    log("Compositing with ffmpeg…")
    cmd = [FF, "-y", "-loglevel", "error"] + inputs + [
        "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
        "-t", f"{out_dur:.2f}", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-b:v", spec.get("bitrate", "6M"), "-c:a", "aac", "-b:a", "160k", "-r", str(fps),
        "-movflags", "+faststart", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("branding ffmpeg failed: " + (r.stderr or "")[-500:])
    shutil.rmtree(work, ignore_errors=True)
    log(f"Branded: {out}")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    args = ap.parse_args()
    render(json.loads(open(args.spec).read()))
