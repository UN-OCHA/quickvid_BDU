#!/usr/bin/env python3
"""
OCHA QuickVid — FINISH pass: brand an already-edited video.

For people who cut their video anywhere (CapCut, Canva, Premiere…) and just want
OCHA elements added. No transcribe, no cut — just:
  - lower thirds  (typed name/title, start + duration, centre or left)
  - a bug         (small OCHA vertical-logo watermark, top-right, whole clip — off by default)
  - an ending     (over black, or over the last seconds of footage)
  - [later] location pins

Everything is placed correctly for the video's FORMAT and social SAFE AREAS, and
the footage is tone-mapped to SDR if it's HDR (so OCHA blue stays correct). All
local — nothing is uploaded.

Job spec (JSON or dict):
{
  "video": "in.mp4", "out": "out.mp4",
  "lower_thirds": [
     {"name":"Vanessa May","org":"OCHA Venezuela","start":2.0,"duration":4.0,"align":"center"}
  ],
  "bug": {"on": false},
  "ending": {"style":"over_black"}          # or {"style":"over_footage","darken":0.4} or {"style":"none"}
}
"""
import os
import sys
import json
import argparse
import subprocess
import tempfile
import threading
import traceback
import shutil

from svgpng import svg2png as _svg2png   # cairosvg, or portable resvg on Macs without Homebrew
from PIL import Image
import lower_third
import pin_locator
import ending as ending_mod   # THE ending — shared with social_brand.py

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "brand", "brand.json")
from mediakit import (COLOR, LOGO_SVG, BUG_SVG, BUG_HEIGHT_FRAC,  # noqa: F401 — re-exported
                      rotation as _rotation, ffmpeg_hdr as _ffmpeg_hdr, to_sdr, normalize_709)
import look as look_mod   # shared footage looks (eq presets) + the phone-colour flag


def _ffmpeg():
    """Homebrew ffmpeg (VideoToolbox, fast) — honours IMAGEIO_FFMPEG_EXE."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


FF = _ffmpeg()
FP = FF.replace("ffmpeg", "ffprobe") if FF.endswith("ffmpeg") else "ffprobe"


ff_progress = ending_mod.ff_progress      # one implementation, in ending.py


def probe(video):
    meta = json.loads(subprocess.run(
        [FP, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,color_transfer,color_primaries,r_frame_rate:"
         "stream_tags=rotate:stream_side_data=rotation",
         "-show_entries", "format=duration", "-of", "json", video],
        capture_output=True, text=True).stdout)
    s = meta["streams"][0]
    num, den = (s.get("r_frame_rate") or "30/1").split("/")
    fps = round(float(num) / float(den or 1))
    hdr = (s.get("color_transfer") in ("arib-std-b67", "smpte2084")
           or s.get("color_primaries") == "bt2020")
    W, H = int(s["width"]), int(s["height"])
    if _rotation(s) == 90:                       # portrait shot on a phone → report the
        W, H = H, W                              # DISPLAYED dims, matching ffmpeg's auto-rotate
    return {"W": W, "H": H,
            "dur": float(meta["format"]["duration"]),
            "fps": fps or 30, "hdr": hdr}


def has_audio(video):
    """True if the file carries at least one audio stream. Screen recordings —
    a common Titles-tab input — often have NONE, and a filter graph that
    references [0:a] on such a file aborts ffmpeg with AVERROR(EINVAL)
    (exit 234). Every audio graph below must check this and synthesize
    silence (anullsrc) instead of assuming [0:a] exists."""
    out = subprocess.run(
        [FP, "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", video],
        capture_output=True, text=True).stdout.strip()
    return bool(out)


def profile(W, H):
    """Format-aware placement: name size (ratio of height) + social safe-area
    insets (fractions). Landscape → bottom-left classic; portrait/square → lower
    band above the platform UI."""
    r = W / H
    # LT sizes now come from the shared spec (browser/brand-lt.json) per
    # orientation — profiles only carry placement safe areas.
    # cap_clear = bottom fraction reserved for captions (mirrors the plugin's
    # premiere/ae/make_assets.py table, 2026-07-23): the LT block bottom clamps
    # to H·(1−cap_clear) so it always sits ABOVE the caption band — portrait
    # captions live mid-frame (reels band 1190-1300), square/landscape in the
    # bottom zone (832-974 on 1080-tall).
    if r > 1.25:                                     # 16:9-ish landscape
        return {"orient": "landscape", "cap_clear": .24,
                # right=.06 (not .045 like left/LT) — matches the bug's real-world
                # margin in references/videos/HNPW2026_USG_remarks.mp4 (measured ~6.6%);
                # "right"/"top" here are consumed only by the bug, not by LT placement.
                "safe": {"top": .06, "bottom": .09, "left": .045, "right": .06}}
    if r < 0.85:                                     # 9:16 / 4:5 portrait
        return {"orient": "portrait", "cap_clear": .396,
                "safe": {"top": .11, "bottom": .20, "left": .06, "right": .06}}
    return {"orient": "square", "cap_clear": .24,     # 1:1
            "safe": {"top": .08, "bottom": .10, "left": .08, "right": .08}}


def place(g, W, H, prof, align):
    """Overlay x,y for a rendered LT block. Bottom-anchored in the lower band,
    just above the bottom safe line — CLAMPED above the caption band
    (cap_clear), same rule as the plugin's MOGRT defaults; centred or at the
    left safe margin."""
    bottom = min(H - prof["safe"]["bottom"] * H - 0.02 * H,
                 H * (1 - prof.get("cap_clear", 0)))
    y = round(bottom - g["H"])
    if align == "left":
        x = round(prof["safe"]["left"] * W - g["block_left"])
    else:
        x = round((W - g["W"]) / 2)
    return x, y


def render_bug(H, tmp):
    """The persistent corner watermark: the OCHA VERTICAL white lockup (distinct
    from the horizontal ending logo), small, rasterized crisp from its own SVG."""
    bug_h = round(H * BUG_HEIGHT_FRAC)
    png = os.path.join(tmp, "bug.png")
    _svg2png(url=BUG_SVG, write_to=png, output_height=bug_h)
    im = Image.open(png)
    return png, im.size[0], im.size[1]


def bug_pos(W, H, prof, bw, bh):
    """Top-right corner, inset by the format's own social safe-area margins —
    the same convention lower thirds are placed against."""
    x = round(W - prof["safe"]["right"] * W - bw)
    y = round(prof["safe"]["top"] * H)
    return x, y


def run(spec, bitrate=12.0):
    brand = json.loads(open(BRAND).read())
    video = spec["video"]
    out = spec["out"]
    info = probe(video)
    W, H, fps = info["W"], info["H"], info["fps"]
    prof = profile(W, H)
    print(f"finish: {W}x{H} {prof['orient']} @ {fps}fps, {info['dur']:.1f}s"
          f"{' (HDR→SDR)' if info['hdr'] else ''}")
    print("PROGRESS 0", flush=True)                  # show the bar immediately (PNG prep precedes ffmpeg)
    tmp = tempfile.mkdtemp(prefix="ocha_finish_")

    # HDR → tonemap; tagged wide-gamut (iPhone Display-P3) → remap; user-forced
    # "Fix phone colours" → remap assuming P3. One shared gate (mediakit).
    video = normalize_709(video, tmp, spec.get("look"))

    # --- render + place each lower third ---
    inputs = ["-i", video]
    filt = []
    prev = "0:v"
    idx = 1

    look_vf = look_mod.chain(spec.get("look"))          # footage look — FIRST, under every overlay
    if look_vf:
        filt.append(f"[{prev}]{look_vf}[vlook]")
        prev = "vlook"
        print(f"  look: {(spec.get('look') or {}).get('preset')}")

    if (spec.get("bug") or {}).get("on"):                # persistent corner watermark, on for the whole clip
        bug_png, bw, bh = render_bug(H, tmp)
        bx, by = bug_pos(W, H, prof, bw, bh)
        inputs += ["-loop", "1", "-i", bug_png]
        filt.append(f"[{idx}:v]format=rgba[bug]")
        filt.append(f"[{prev}][bug]overlay={bx}:{by}[v{idx}]")
        prev = f"v{idx}"
        idx += 1
        print(f"  bug: OCHA vertical logo → {bx},{by}")

    # location strips, top-left (animated). pin_locator.specs() is the single reader
    # of the spec — social_brand.py calls the same one, so both tabs stay in step.
    for i, pin in enumerate(pin_locator.specs(spec)):
        seqdir = os.path.join(tmp, f"pin{i}")
        r = pin_locator.render(pin["place"], pin["date"], H, fps,
                               pin_locator.hold_for(pin["duration"]), seqdir,
                               icon=pin["icon"], color=pin["color"], orient=prof["orient"])
        pad = r.get("pad", 0)                             # undo the anti-crop headroom (bleeds into the safe margin)
        px = max(0, round(prof["safe"]["left"] * W) - pad)
        py = max(0, round(prof["safe"]["top"] * H) - pad)
        pstart = pin["start"]
        inputs += ["-framerate", str(fps), "-start_number", "0", "-i", os.path.join(seqdir, "%04d.png")]
        filt.append(f"[{idx}:v]setpts=PTS+{pstart}/TB[pn{idx}]")
        filt.append(f"[{prev}][pn{idx}]overlay={px}:{py}:eof_action=pass:enable='gte(t,{pstart})'[v{idx}]")
        prev = f"v{idx}"
        idx += 1
        print(f"  pin {i}: '{pin['place']}' / '{pin['date']}' @ {pstart:.1f}s "
              f"({pin['color']}, icon={pin['icon']}) → {px},{py}")

    for i, lt in enumerate(spec.get("lower_thirds", [])):
        align = lt.get("align", "left")   # left is the OCHA default
        hold = max(0.5, float(lt.get("duration", 4.0)) - lower_third.ENTER_END - lower_third.EXIT_DUR)
        seqdir = os.path.join(tmp, f"lt{i}")
        g = lower_third.render(lt["name"], lt["org"], H, align, fps, hold, seqdir,
                               orient=prof["orient"], org2=lt.get("org2"))
        x, y = place(g, W, H, prof, align)
        start = float(lt["start"])
        inputs += ["-framerate", str(fps), "-start_number", "0",
                   "-i", os.path.join(seqdir, "%04d.png")]
        filt.append(f"[{idx}:v]setpts=PTS+{start}/TB[l{idx}]")
        filt.append(f"[{prev}][l{idx}]overlay={x}:{y}:eof_action=pass:"
                    f"enable='gte(t,{start})'[v{idx}]")
        prev = f"v{idx}"
        idx += 1
        print(f"  LT {i}: '{lt['name']}' @ {start:.1f}s ({align}) → {x},{y}")

    # Split the 0–100 bar between the two ffmpeg passes: when an ending follows,
    # the overlay composite owns 0–70 and the ending owns 70–100; with no ending
    # the composite owns the whole bar (and vice-versa when there's no composite).
    style = spec.get("ending", {"style": "none"}).get("style", "none")
    has_ending = style in ("over_black", "over_footage")
    body_hi = 70 if has_ending else 100

    body = os.path.join(tmp, "body.mp4")
    if filt:
        filt.append(f"[{prev}]null[vout]")
        ff_progress([FF, "-y", "-v", "error"] + inputs + [
            "-filter_complex", ";".join(filt), "-map", "[vout]", "-map", "0:a?",
            "-t", f"{info['dur']:.3f}",
            ] + ending_mod.vcodec_args(bitrate) + COLOR
            + ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
               "-pix_fmt", "yuv420p", "-r", str(fps), body], info["dur"], 0, body_hi)
    else:
        body = video

    # --- ending ---
    ending = spec.get("ending", {"style": "none"})
    if has_ending:
        print(f"  ending: {style}")
        ending_mod.add_ending(FF, body, style, float(ending.get("darken", 0.0)),
                              bitrate, tmp, out, p_lo=(body_hi if filt else 0), p_hi=100)
    else:
        subprocess.run([FF, "-y", "-v", "error", "-i", body, "-c", "copy",
                        "-movflags", "+faststart", out], check=True)

    shutil.rmtree(tmp, ignore_errors=True)
    print(f"  -> {out}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True, help="job spec JSON file")
    ap.add_argument("--bitrate", type=float, default=12.0)
    args = ap.parse_args()
    try:
        run(json.loads(open(args.spec).read()), args.bitrate)
    except Exception as e:
        # Keep the full traceback in the job log, but ALSO print an "ERROR:"
        # line — engine_bridge surfaces the last such line in the UI instead
        # of the useless "finish.py exited 1".
        traceback.print_exc()
        if isinstance(e, subprocess.CalledProcessError):
            step = os.path.basename(str(e.cmd[0] if isinstance(e.cmd, (list, tuple)) else e.cmd))
            print(f"ERROR: {step} failed (exit {e.returncode}) — its own message is a few lines up in this log.",
                  flush=True)
        else:
            print(f"ERROR: {e}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
