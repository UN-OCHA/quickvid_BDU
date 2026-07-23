#!/usr/bin/env python3
"""
OCHA QuickVid — video compressor (Toolbox).

Turn a heavy video into the lightest H.264/AAC MP4 that still looks right —
H.264 because it plays EVERYWHERE (every OS, browser, WhatsApp/Teams/PowerPoint,
no codec installs), which is the whole point of a distribution copy.

CRF encoding (constant QUALITY, not bitrate): the encoder spends bits where the
picture needs them, which is exactly "best quality, lowest weight". Three named
levels — by OUTCOME, not compression jargon (nobody knows if "high" means high
quality or high squeeze):

  best      CRF 18, keeps resolution   — nearly indistinguishable; archive/edit
  balanced  CRF 23, caps at 1080p      — the recommended share/upload copy
  smallest  CRF 28, caps at 1080p      — email / chat-app limits

Also: HDR / wide-gamut phone footage is normalized to SDR bt709 first (the
shared mediakit gate) — a distribution copy must look right on every screen;
`+faststart` so streaming/preview starts instantly; audio AAC 160k.

CLI:  python3 compress.py --spec spec.json
Spec: {"src": "...", "level": "best|balanced|smallest", "out": "...?"}
      out defaults to <src folder>/<name>_compressed.mp4 (never overwrites —
      a numbered suffix is added if needed).
Progress prints to stdout (PROGRESS n); `RESULT {json}` is the last line.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mediakit                      # noqa: E402 — shared colour gate + bt709 tags
import ending as ending_mod          # noqa: E402 — its ff_progress drives the % bar
import social_brand                  # noqa: E402 — its probe() (w, h, fps, dur)

FF = os.environ.get("IMAGEIO_FFMPEG_EXE") or "/opt/homebrew/bin/ffmpeg"

LEVELS = {
    "best":     {"crf": 18, "max_short": None},
    "balanced": {"crf": 23, "max_short": 1080},
    "smallest": {"crf": 28, "max_short": 1080},
}


def _unique_out(src):
    base = os.path.splitext(src)[0] + "_compressed"
    out = base + ".mp4"
    n = 2
    while os.path.exists(out):
        out = f"{base}_{n}.mp4"
        n += 1
    return out


def _target_dims(w, h, max_short):
    """Cap the SHORT side (1080p semantics that work for portrait too:
    3840x2160 → 1920x1080, 2160x3840 → 1080x1920). Even dimensions for yuv420p."""
    if not max_short or min(w, h) <= max_short:
        return None
    f = max_short / min(w, h)
    return (int(round(w * f / 2)) * 2, int(round(h * f / 2)) * 2)


def has_audio(src):
    return bool(subprocess.run(
        [FF.replace("ffmpeg", "ffprobe") if FF.endswith("ffmpeg") else "ffprobe",
         "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type",
         "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip())


def run(spec):
    src = spec["src"]
    level = LEVELS.get(spec.get("level") or "balanced", LEVELS["balanced"])
    out = spec.get("out") or _unique_out(src)
    in_bytes = os.path.getsize(src)

    tmp = tempfile.mkdtemp(prefix="ocha_compress_")
    try:
        # Distribution copies must look right on every screen: HDR is tonemapped,
        # tagged wide-gamut remapped (same shared gate as every render).
        work = mediakit.normalize_709(src, tmp, None, log=lambda m: print(m, flush=True))
        w, h, fps, dur = social_brand.probe(work)

        vf = []
        dims = _target_dims(w, h, level["max_short"])
        if dims:
            vf += [f"scale={dims[0]}:{dims[1]}"]
            print(f"Downscaling {w}x{h} → {dims[0]}x{dims[1]} (1080p cap)…", flush=True)
        ow, oh = dims or (w, h)

        print(f"Compressing at CRF {level['crf']} (H.264, this can take a while on long videos)…", flush=True)
        print("PROGRESS 0", flush=True)
        cmd = [FF, "-y", "-v", "error", "-i", work]
        if vf:
            cmd += ["-vf", ",".join(vf)]
        cmd += ["-c:v", "libx264", "-crf", str(level["crf"]), "-preset", "slow",
                "-pix_fmt", "yuv420p"] + mediakit.COLOR
        if has_audio(work):
            cmd += ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
        cmd += ["-movflags", "+faststart", out]
        ending_mod.ff_progress(cmd, dur, 0, 100)
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

    out_bytes = os.path.getsize(out)
    saved = round((1 - out_bytes / in_bytes) * 100, 1) if in_bytes else 0.0
    print(f"…{in_bytes / 1e6:.1f} MB → {out_bytes / 1e6:.1f} MB ({saved:.0f}% smaller)", flush=True)
    print("RESULT " + json.dumps({
        "path": out, "in_bytes": in_bytes, "out_bytes": out_bytes,
        "saved_pct": saved, "width": ow, "height": oh, "duration": round(dur, 2),
    }), flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    args = ap.parse_args()
    try:
        run(json.loads(open(args.spec).read()))
    except Exception as e:                                  # noqa: BLE001
        import traceback
        traceback.print_exc()
        print(f"ERROR: {e}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
