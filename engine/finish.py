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
import traceback
import shutil

from svgpng import svg2png as _svg2png   # cairosvg, or portable resvg on Macs without Homebrew
from PIL import Image
import lower_third
import pin_locator

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "brand", "brand.json")
LOGO_SVG = os.path.join(ROOT, "assets", "OCHA_logo_horizontal_white.svg")
BUG_SVG = os.path.join(ROOT, "assets", "OCHA_logo_vertical_white.svg")
BUG_HEIGHT_FRAC = 0.065    # corner watermark, mainly for EVENT (landscape) videos — sized to
                           # match a real reference (references/videos/HNPW2026_USG_remarks.mp4,
                           # measured ~6.67% of frame height); still bigger than the ending logo's
                           # 0.054 since it has to read as a persistent mark, not a closing beat.
                           # (First cut at 0.032 was too small — tuned for reels, never checked
                           # against actual event-video usage.) Mirrored in social_brand.py, keep in sync.
COLOR = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]


def _ffmpeg():
    """Homebrew ffmpeg (VideoToolbox, fast) — honours IMAGEIO_FFMPEG_EXE."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


def _ffmpeg_hdr():
    """The BUNDLED imageio ffmpeg — it has zscale/tonemap (Homebrew's build may
    not). Ignore the IMAGEIO_FFMPEG_EXE override to reach the bundled binary."""
    import imageio_ffmpeg
    saved = os.environ.pop("IMAGEIO_FFMPEG_EXE", None)
    try:
        return imageio_ffmpeg.get_ffmpeg_exe()
    finally:
        if saved is not None:
            os.environ["IMAGEIO_FFMPEG_EXE"] = saved


FF = _ffmpeg()
FP = FF.replace("ffmpeg", "ffprobe") if FF.endswith("ffmpeg") else "ffprobe"


def probe(video):
    meta = json.loads(subprocess.run(
        [FP, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,color_transfer,color_primaries,r_frame_rate",
         "-show_entries", "format=duration", "-of", "json", video],
        capture_output=True, text=True).stdout)
    s = meta["streams"][0]
    num, den = (s.get("r_frame_rate") or "30/1").split("/")
    fps = round(float(num) / float(den or 1))
    hdr = (s.get("color_transfer") in ("arib-std-b67", "smpte2084")
           or s.get("color_primaries") == "bt2020")
    return {"W": int(s["width"]), "H": int(s["height"]),
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
    if r > 1.25:                                     # 16:9-ish landscape
        return {"orient": "landscape",
                # right=.06 (not .045 like left/LT) — matches the bug's real-world
                # margin in references/videos/HNPW2026_USG_remarks.mp4 (measured ~6.6%);
                # "right"/"top" here are consumed only by the bug, not by LT placement.
                "safe": {"top": .06, "bottom": .09, "left": .045, "right": .06}}
    if r < 0.85:                                     # 9:16 / 4:5 portrait
        return {"orient": "portrait",
                "safe": {"top": .11, "bottom": .20, "left": .06, "right": .06}}
    return {"orient": "square",                       # 1:1
            "safe": {"top": .08, "bottom": .10, "left": .08, "right": .08}}


def to_sdr(video, tmp):
    """HDR (HLG/PQ, BT.2020) → SDR bt709, so overlaid sRGB graphics read correctly."""
    out = os.path.join(tmp, "sdr.mp4")
    ff = _ffmpeg_hdr()
    subprocess.run(
        [ff, "-y", "-v", "error", "-i", video,
         "-vf", "zscale=t=linear:npl=203,tonemap=hable:desat=0,"
                "zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p",
         "-c:v", "libx264", "-crf", "16", "-preset", "medium"] + COLOR
        + ["-c:a", "copy", out], check=True)
    return out


def place(g, W, H, prof, align):
    """Overlay x,y for a rendered LT block. Bottom-anchored in the lower band,
    just above the bottom safe line; centred or at the left safe margin."""
    bottom = H - prof["safe"]["bottom"] * H - 0.02 * H
    y = round(bottom - g["H"])
    if align == "left":
        x = round(prof["safe"]["left"] * W - g["block_left"])
    else:
        x = round((W - g["W"]) / 2)
    return x, y


def render_logo(W, H, tmp):
    """The OCHA horizontal white lockup, rendered CRISP from the SVG. Sized by
    frame HEIGHT (~5.4%), so it looks the same weight in every format — that keeps
    the approved portrait size but shrinks it on the wider square/landscape frames."""
    logo_h = round(H * 0.054)
    png = os.path.join(tmp, "logo.png")
    _svg2png(url=LOGO_SVG, write_to=png, output_height=logo_h)
    im = Image.open(png)
    return png, im.size[0], im.size[1]


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


def add_ending(FF_, video, brand, style, darken, bitrate, tmp, out):
    """style 'over_black' | 'over_footage'. The logo is the crisp SVG; it SNAPS on
    (no fade — a rough cut) and HOLDS to the end. The darken (over_footage) and the
    cut to black (over_black) are hard too. Click SOUND from the logo-click .mov."""
    info = probe(video)
    dur, W, H = info["dur"], info["W"], info["H"]
    silent = not has_audio(video)                    # e.g. a screen recording
    logo, lw, lh = render_logo(W, H, tmp)
    lx, ly = (W - lw) // 2, (H - lh) // 2
    mov = os.path.join(ROOT, brand["ending"]["asset"])
    click = os.path.exists(mov)

    inputs = ["-i", video, "-loop", "1", "-i", logo]
    if click:
        inputs += ["-i", mov]                        # input 2 — for the click sound only

    HOLD = 1.5                                        # video cuts 1.5s after the logo appears
    if style == "over_footage":
        at = max(0.0, dur - HOLD)                     # logo snaps in over the last 1.5s of footage
        out_dur = dur
        dk = (f"color=black:s={W}x{H}:r=30:d={dur:.2f},format=rgba,"
              f"colorchannelmixer=aa={darken}[dk];"                     # hard darken (no fade)
              f"[0:v][dk]overlay=enable='gte(t,{at:.2f})'[bg];") if darken > 0 else "[0:v]null[bg];"
        vfilt = (dk +
                 f"[1:v]format=rgba[lg];"
                 f"[bg][lg]overlay={lx}:{ly}:enable='gte(t,{at:.2f})',format=yuv420p[v]")
        aud_main = (f"anullsrc=r=48000:cl=stereo:d={out_dur:.2f}[va];" if silent
                    else "[0:a]anull[va];")
        adur = "first"
    else:                                            # over_black — hard cut to black, logo snaps on
        at = dur                                       # logo on the first black frame
        out_dur = at + HOLD                            # cuts 1.5s after the logo appears
        vfilt = (f"[0:v]tpad=stop_duration=3:color=black[bv];"          # footage → hard cut to black
                 f"[1:v]format=rgba[lg];"
                 f"[bv][lg]overlay={lx}:{ly}:enable='gte(t,{at:.2f})',format=yuv420p[v]")
        aud_main = (f"anullsrc=r=48000:cl=stereo:d={out_dur:.2f}[va];" if silent
                    else f"[0:a]afade=t=out:st={dur - 0.06:.2f}:d=0.06[va];")  # tiny fade only to avoid a pop
        adur = "longest"

    if click:
        delay = int(max(0, at - 0.30) * 1000)          # .mov click (@0.3s) lands as the logo snaps on
        fc = (vfilt + ";" + aud_main +
              f"[2:a]atrim=0:0.7,asetpts=PTS-STARTPTS,adelay={delay}|{delay}[ca];"
              f"[va][ca]amix=inputs=2:duration={adur}:normalize=0[a]")
    else:
        fc = vfilt + ";" + aud_main.replace("[va]", "[a]")

    subprocess.run([FF_, "-y", "-v", "error"] + inputs + [
        "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
        "-t", f"{out_dur:.2f}",
        "-c:v", "h264_videotoolbox", "-b:v", f"{bitrate}M"] + COLOR
        + ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
           "-pix_fmt", "yuv420p", "-r", "30", out], check=True)


def run(spec, bitrate=12.0):
    brand = json.loads(open(BRAND).read())
    video = spec["video"]
    out = spec["out"]
    info = probe(video)
    W, H, fps = info["W"], info["H"], info["fps"]
    prof = profile(W, H)
    print(f"finish: {W}x{H} {prof['orient']} @ {fps}fps, {info['dur']:.1f}s"
          f"{' (HDR→SDR)' if info['hdr'] else ''}")
    tmp = tempfile.mkdtemp(prefix="ocha_finish_")

    if info["hdr"]:
        video = to_sdr(video, tmp)

    # --- render + place each lower third ---
    inputs = ["-i", video]
    filt = []
    prev = "0:v"
    idx = 1

    if (spec.get("bug") or {}).get("on"):                # persistent corner watermark, on for the whole clip
        bug_png, bw, bh = render_bug(H, tmp)
        bx, by = bug_pos(W, H, prof, bw, bh)
        inputs += ["-loop", "1", "-i", bug_png]
        filt.append(f"[{idx}:v]format=rgba[bug]")
        filt.append(f"[{prev}][bug]overlay={bx}:{by}[v{idx}]")
        prev = f"v{idx}"
        idx += 1
        print(f"  bug: OCHA vertical logo → {bx},{by}")

    pin = spec.get("pin") or {}                          # location strip, top-left (animated)
    if pin.get("on") and (pin.get("place") or pin.get("date")):
        pdur = float(pin.get("duration", 5.0))
        phold = max(0.4, pdur - pin_locator.ENTER_END - pin_locator.EXIT_DUR)
        seqdir = os.path.join(tmp, "pin")
        r = pin_locator.render(pin.get("place", ""), pin.get("date", ""), H, fps, phold, seqdir,
                               icon=pin.get("icon", True), color=pin.get("color", "red"),
                               orient=prof["orient"])
        px = round(prof["safe"]["left"] * W)
        py = round(prof["safe"]["top"] * H)
        pstart = float(pin.get("start", 1.2))
        inputs += ["-framerate", str(fps), "-start_number", "0", "-i", os.path.join(seqdir, "%04d.png")]
        filt.append(f"[{idx}:v]setpts=PTS+{pstart}/TB[pn{idx}]")
        filt.append(f"[{prev}][pn{idx}]overlay={px}:{py}:eof_action=pass:enable='gte(t,{pstart})'[v{idx}]")
        prev = f"v{idx}"
        idx += 1
        print(f"  pin: '{pin.get('place')}' / '{pin.get('date')}' ({pin.get('color', 'red')}, icon={pin.get('icon', True)}) → {px},{py}")

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

    body = os.path.join(tmp, "body.mp4")
    if filt:
        filt.append(f"[{prev}]null[vout]")
        subprocess.run([FF, "-y", "-v", "error"] + inputs + [
            "-filter_complex", ";".join(filt), "-map", "[vout]", "-map", "0:a?",
            "-t", f"{info['dur']:.3f}",
            "-c:v", "h264_videotoolbox", "-b:v", f"{bitrate}M"] + COLOR
            + ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
               "-pix_fmt", "yuv420p", "-r", str(fps), body], check=True)
    else:
        body = video

    # --- ending ---
    ending = spec.get("ending", {"style": "none"})
    style = ending.get("style", "none")
    if style in ("over_black", "over_footage"):
        print(f"  ending: {style}")
        add_ending(FF, body, brand, style, float(ending.get("darken", 0.0)),
                   bitrate, tmp, out)
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
