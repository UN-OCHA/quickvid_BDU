#!/usr/bin/env python3
"""
Subtle subject-follow reframe for piece-to-camera.

Detects the speaker's face across the source take(s), builds a HEAVILY smoothed
path in OUTPUT time, and hands run.py a punched-in crop window per segment that
drifts slowly to keep the subject centered. Key properties:

  - Uses the 4K headroom: the crop (e.g. 3200x1800 at zoom 1.2) is DOWNSCALED to
    1080, never upscaled, so quality is preserved.
  - Smoothed in OUTPUT time and lerp'd within each segment between the global
    path's endpoints, so adjacent cuts join continuously (no per-segment jump).
  - Fail-safe: if cv2 is missing, or a take yields no detections, the segment
    falls back to a centred crop (or no crop) — never worse than a static frame.

run.py owns the ffmpeg crop; this module only decides WHERE to crop.
"""
import os
import subprocess
import json

import numpy as np

try:
    import cv2
    _FRONTAL = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    _PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    HAVE_CV2 = True
except Exception:
    HAVE_CV2 = False


def _detect(gray):
    """Largest face center as (cx, cy) normalized 0..1, or None. Tries frontal,
    then profile, then mirrored profile (catches the other side)."""
    h, w = gray.shape
    for casc in (_FRONTAL, _PROFILE):
        faces = casc.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
        if len(faces):
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            return (x + fw / 2) / w, (y + fh / 2) / h
    faces = _PROFILE.detectMultiScale(cv2.flip(gray, 1), 1.1, 5, minSize=(40, 40))
    if len(faces):
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        return 1 - (x + fw / 2) / w, (y + fh / 2) / h
    return None


def _probe_dims(ff, src):
    fp = ff.replace("ffmpeg", "ffprobe")
    meta = json.loads(subprocess.run(
        [fp, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", src],
        capture_output=True, text=True).stdout)["streams"][0]
    return int(meta["width"]), int(meta["height"])


def sample_file(ff, src, fps=4, det_w=640):
    """Decode the whole file once at low res/rate, detect the face per sampled
    frame. Returns (W, H, [(src_t, cx, cy), ...]) — gaps (misses) simply omitted."""
    W, H = _probe_dims(ff, src)
    det_h = int(round(det_w * H / W / 2) * 2)
    proc = subprocess.run(
        [ff, "-v", "error", "-i", src,
         "-vf", f"fps={fps},scale={det_w}:{det_h},format=gray",
         "-f", "rawvideo", "-"],
        capture_output=True)
    buf = np.frombuffer(proc.stdout, dtype=np.uint8)
    fsize = det_w * det_h
    nframes = len(buf) // fsize if fsize else 0
    samples = []
    for i in range(nframes):
        gray = buf[i * fsize:(i + 1) * fsize].reshape(det_h, det_w)
        d = _detect(gray)
        if d:
            samples.append(((i + 0.5) / fps, d[0], d[1]))
    return W, H, samples


def _deadzone(arr, dz):
    """Loose follow: the frame HOLDS its position while the subject stays within
    ±dz of where it last settled, and only re-anchors (lagging by dz) once they
    drift past it. So normal sway → no camera move; a real drift → gentle nudge,
    and it stops at the dead-zone edge rather than re-centring perfectly."""
    if dz <= 0:
        return arr
    out = arr.copy()
    anchor = arr[0]
    for i in range(len(arr)):
        f = arr[i]
        if f > anchor + dz:
            anchor = f - dz
        elif f < anchor - dz:
            anchor = f + dz
        out[i] = anchor
    return out


def _clamp_velocity(arr, max_step):
    """Limit per-step movement so the frame can never pan fast — it lags a quick
    move and eases in, which is what reads as 'subtle/slow'. max_step in the same
    (normalized) units per grid step."""
    if max_step <= 0:
        return arr
    out = arr.copy()
    for i in range(1, len(out)):
        d = out[i] - out[i - 1]
        if d > max_step:
            out[i] = out[i - 1] + max_step
        elif d < -max_step:
            out[i] = out[i - 1] - max_step
    return out


def _smooth_path(out_samples, total_dur, smooth_s, max_drift, dead_zone, grid_fps=10):
    """out_samples: [(out_t, cx, cy)] in OUTPUT time. Resample onto a uniform grid
    (np.interp fills gaps + holds the ends), apply a dead zone (hold unless the
    subject drifts past it), edge-padded moving-average smooth, THEN cap velocity.
    Returns (grid, sx, sy) or None. (cx/cy normalized over the source frame.)"""
    if not out_samples:
        return None
    out_samples = sorted(out_samples)
    ts = np.array([s[0] for s in out_samples])
    xs = np.array([s[1] for s in out_samples])
    ys = np.array([s[2] for s in out_samples])
    grid = np.arange(0, total_dur + 1e-6, 1.0 / grid_fps)
    gx = _deadzone(np.interp(grid, ts, xs), dead_zone)
    gy = _deadzone(np.interp(grid, ts, ys), dead_zone)
    win = max(int(smooth_s * grid_fps), 1)
    pad = win // 2
    k = np.ones(win) / win
    sx = np.convolve(np.pad(gx, pad, mode="edge"), k, mode="same")[pad:-pad or None][:len(grid)]
    sy = np.convolve(np.pad(gy, pad, mode="edge"), k, mode="same")[pad:-pad or None][:len(grid)]
    step = max_drift / grid_fps           # normalized units per grid step
    return grid, _clamp_velocity(sx, step), _clamp_velocity(sy, step)


def compute_segment_crops(ff, segs, source_dir, cfg):
    """
    segs: ordered list of dicts {file, cut_in, cut_out, o0, o1}  (o0/o1 = output
          start/end seconds of the segment's full span).
    Returns a same-length list; each entry is either None (no reframe -> run.py
    uses its plain centred scale) or a dict with the crop window + the top-left
    at the segment's start and end (run.py lerps between them):
        {cw, ch, x0, y0, x1, y1}
    """
    if not HAVE_CV2 or not cfg.get("enabled", True):
        return [None] * len(segs)

    zoom      = float(cfg.get("zoom", 1.3))
    smooth_s  = float(cfg.get("smooth_seconds", 2.2))
    face_v    = float(cfg.get("face_v", 0.45))    # face target height within crop (0=top)
    fps       = int(cfg.get("sample_fps", 4))
    max_drift = float(cfg.get("max_drift", 0.011))  # max frame travel, normalized/s (~28 px/s @1080)
    dead_zone = float(cfg.get("dead_zone", 0.06))   # subject can sway this far (norm) before the frame moves

    # --- detect each source file once (cache) ---
    cache = {}
    for s in segs:
        if s["file"] not in cache:
            src = os.path.join(source_dir, s["file"])
            cache[s["file"]] = sample_file(ff, src, fps=fps)

    # --- assemble OUTPUT-time samples by mapping each file detection into the
    #     segments that use it ---
    total_dur = max((s["o1"] for s in segs), default=0.0)
    out_samples = []
    for s in segs:
        W, H, fsamples = cache[s["file"]]
        span = max(s["cut_out"] - s["cut_in"], 1e-3)
        for (src_t, cx, cy) in fsamples:
            if s["cut_in"] <= src_t < s["cut_out"]:
                out_t = s["o0"] + (src_t - s["cut_in"])
                out_samples.append((out_t, cx, cy))

    path = _smooth_path(out_samples, total_dur, smooth_s, max_drift, dead_zone)
    if path is None:
        return [None] * len(segs)
    grid, sx, sy = path

    def q(t):
        return float(np.interp(t, grid, sx)), float(np.interp(t, grid, sy))

    crops = []
    for s in segs:
        W, H, fsamples = cache[s["file"]]
        cw = int(round(W / zoom / 2) * 2)
        ch = int(round(cw * H / W / 2) * 2)
        cw, ch = min(cw, W), min(ch, H)

        def topleft(t):
            cx, cy = q(t)
            x0 = cx * W - cw / 2
            y0 = cy * H - face_v * ch           # face sits `face_v` down the crop
            x0 = min(max(x0, 0), W - cw)
            y0 = min(max(y0, 0), H - ch)
            return x0, y0

        x0, y0 = topleft(s["o0"])
        x1, y1 = topleft(s["o1"])
        crops.append({"cw": cw, "ch": ch,
                      "x0": round(x0, 1), "y0": round(y0, 1),
                      "x1": round(x1, 1), "y1": round(y1, 1)})
    return crops
