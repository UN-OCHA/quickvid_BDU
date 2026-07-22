"""THE OCHA ending — one implementation for every pipeline.

Both tabs end a video the same way, so both must run the same code:
  * finish.py (Titles & branding) calls add_ending() as its second pass.
  * social_brand.py (Edit tab / subtitled Titles) renders its body pass and then
    calls add_ending() for over_black.

History, so nobody re-inlines this: social_brand used to composite its ending
inside the SAME ffmpeg graph as the captions/lower-thirds/pins. The over_black
branch needed a `trim`, and a trim combined with 2+ time-shifted overlays (two
location strips) silently drops frames — while every trim-free variant deadlocks
the graph. That forced an artificial "no over_black with 2+ strips" refusal that
users read as "over black doesn't work". Running the ending as a SECOND pass over
the finished body sidesteps the whole class of problem: the ending graph has one
input video, one logo, at most one click — nothing to fight framesync over.

House rules baked in (docs/decisions.md): the logo SNAPS on (no fade), the cut to
black is hard, the click sound peaks as the logo lands, never a scrim behind the
logo, and the logo is rasterized from the SVG at render time.
"""
import json
import os
import subprocess
import threading

from svgpng import svg2png as _svg2png
from PIL import Image

import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_SVG = os.path.join(ROOT, "assets", "OCHA_logo_horizontal_white.svg")
BRAND_JSON = os.path.join(ROOT, "brand", "brand.json")
COLOR = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
HOLD = 1.5           # video cuts this long after the logo appears (both styles)


def ffprobe_of(ff):
    """ffprobe next to the given ffmpeg — the sibling settings.py's symlink layout
    puts there ("ffmpeg.exe" -> "ffprobe.exe"). But the imageio ffmpeg build has NO
    ffprobe sibling (its folder is imageio_ffmpeg only), so when the derived path
    doesn't exist, fall back to a system `ffprobe`. Missing this made finish.py's
    over_black crash: its FF is the imageio binary."""
    cand = ff.replace("ffmpeg", "ffprobe")
    return cand if cand != ff and os.path.exists(cand) else "ffprobe"


def vcodec_args(bitrate):
    """Encoder args for THIS platform. h264_videotoolbox exists only on macOS —
    hardcoding it (as finish.py once did) makes every render fail on Windows with
    "Unknown encoder". libx264 is in every build the engine installs."""
    if sys.platform == "darwin":
        return ["-c:v", "h264_videotoolbox", "-b:v", f"{bitrate}M"]
    return ["-c:v", "libx264", "-preset", "medium", "-b:v", f"{bitrate}M"]


def ff_progress(cmd, total_dur, p_lo=0, p_hi=100):
    """Run ffmpeg translating its `-progress` stream into `PROGRESS n` tokens,
    scaled into [p_lo, p_hi] so multi-pass renders share one 0-100 bar.
    Raises on a non-zero exit with the tail of stderr."""
    full = [str(c) for c in cmd] + ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(full, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    err = []
    et = threading.Thread(target=lambda: err.append(proc.stderr.read()), daemon=True)
    et.start()
    last = -1
    for line in proc.stdout:                      # out_time_us ticks ~every frame
        k, _, v = line.strip().partition("=")
        if k in ("out_time_us", "out_time_ms") and v.isdigit():   # both are µs (ffmpeg quirk)
            frac = min(1.0, (int(v) / 1e6) / total_dur) if total_dur > 0 else 0
            p = int(p_lo + frac * (p_hi - p_lo))
            if p != last:
                last = p
                print(f"PROGRESS {p}", flush=True)
    proc.wait()
    et.join(timeout=1)
    if proc.returncode != 0:
        raise RuntimeError("ending ffmpeg failed: " + ("".join(err))[-500:])
    return proc.returncode


def _probe(video, fp):
    j = json.loads(subprocess.run(
        [fp, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-show_entries", "format=duration", "-of", "json", video],
        capture_output=True, text=True).stdout)
    s = (j.get("streams") or [{}])[0]
    return float(j["format"]["duration"]), int(s.get("width", 0)), int(s.get("height", 0))


def _has_audio(video, fp):
    return bool(subprocess.run(
        [fp, "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", video],
        capture_output=True, text=True).stdout.strip())


def render_logo(W, H, tmp):
    """The OCHA horizontal white lockup, rendered CRISP from the SVG. Sized by
    frame HEIGHT (~5.4%), so it reads the same weight in every format."""
    logo_h = round(H * 0.054)
    png = os.path.join(tmp, "logo.png")
    _svg2png(url=LOGO_SVG, write_to=png, output_height=logo_h)
    im = Image.open(png)
    return png, im.size[0], im.size[1]


def add_ending(FF_, video, style, darken, bitrate, tmp, out, p_lo=0, p_hi=100):
    """style 'over_black' | 'over_footage'. The logo is the crisp SVG; it SNAPS on
    (no fade — a rough cut) and HOLDS to the end. The darken (over_footage) and the
    cut to black (over_black) are hard too. Click SOUND from brand.json's asset."""
    fp = ffprobe_of(FF_)
    dur, W, H = _probe(video, fp)
    silent = not _has_audio(video, fp)               # e.g. a screen recording
    logo, lw, lh = render_logo(W, H, tmp)
    lx, ly = (W - lw) // 2, (H - lh) // 2
    asset = json.loads(open(BRAND_JSON).read()).get("ending", {}).get("asset", "")
    mov = os.path.join(ROOT, asset) if asset else ""
    click = bool(mov) and os.path.exists(mov)

    inputs = ["-i", video, "-loop", "1", "-i", logo]
    if click:
        inputs += ["-i", mov]                        # input 2 — for the click sound only

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
        delay = int(max(0, at - 0.30) * 1000)          # click peak (@0.3s) lands as the logo snaps on
        fc = (vfilt + ";" + aud_main +
              f"[2:a]atrim=0:0.7,asetpts=PTS-STARTPTS,adelay={delay}|{delay}[ca];"
              f"[va][ca]amix=inputs=2:duration={adur}:normalize=0[a]")
    else:
        fc = vfilt + ";" + aud_main.replace("[va]", "[a]")

    ff_progress([FF_, "-y", "-v", "error"] + inputs + [
        "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
        "-t", f"{out_dur:.2f}"] + vcodec_args(bitrate) + COLOR
        + ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
           "-pix_fmt", "yuv420p", "-r", "30", out], out_dur, p_lo, p_hi)
    return out
