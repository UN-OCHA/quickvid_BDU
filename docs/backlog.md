# PTC refinements backlog

Requested craft refinements for the piece-to-camera workflow, with approach +
effort. Ordered by when we plan to do them. (Locked scope/decisions live in
`decisions.md`; this is the "next" list.)

## A. Breathing room in the cut  — DONE 2026-06-26
**Want:** don't cut *all* pauses; leave natural breathing time so delivery
isn't rushed.
**Done:** `run.py --breath` keeps up to N seconds of each natural inter-sentence
pause (full pause preserved when it's ≤ breath; only longer dead air trimmed to
breath). Default raised **0.4 → 0.7s** after Javi said the cut felt too clipped
("leave a bit more silent"). For consecutive kept segments the tail extends to
the next segment's in-point, so the original pause survives with no artificial
gap. To loosen the room around EVERY word (not just inter-sentence) raise
`PAD` in transcribe.py (0.10s now) — but that needs a re-transcribe, so breath is
the cheap lever. `breath` is a `run.py` arg; surface it in the UI later.

## A2. Audio/video sync in the cut  — DONE 2026-06-26 (was a real bug)
**Symptom:** Javi: "good at the beginning but little by little becomes unsynced."
**Cause:** `run.py` cut each segment to its own file with `fps=30` applied
per-segment, while the audio kept its exact sub-frame length. Source is
**23.976fps** (4K HEVC), so every segment upsampled to 30 with a fractional
rounding; across 54 segments the video came out ~36 frames short (171.85s of
frames stretched over 171.82s of audio = 29.78fps avg) → video ran ~0.7% slow,
lips lagging progressively. The render pass was NOT the culprit (verified: graded
intermediate is clean CFR, `-ss` chunk seeks are frame-accurate via md5/PSNR).
**Fix:** lock each segment's audio AND video to an identical exact frame count
before concat — `trim=end_frame=N` (+ `tpad` clone guard for EOF) on video,
`atrim=end_sample=N*1600` (48000/30 = 1600 samples/frame, + `apad`) on audio.
Now the cut is true 30fps with frames == duration; final branded a/v differ by
**12 ms** (half a frame, was ~1200 ms). Residual is a tiny constant trailing
offset, not progressive — within lip-sync tolerance. If it ever needs to be
exactly 0: encode part audio as PCM (no per-segment AAC priming) and let
render.py do the single AAC encode.
**Effort:** done.

## A3. Duplicated word at segment joins  — DONE 2026-06-26 (was a real bug)
**Symptom:** Javi at ~2:10: "everywhere-where" — a word played twice.
**Cause:** Whisper gives each segment ±`PAD` (0.10s) around its words, so adjacent
segments can OVERLAP (e.g. seg 46 out=138.92, seg 47 in=138.72 → 0.2s overlap).
The cut played seg 46 to 138.92 AND seg 47 from 138.72, so [138.72,138.92] — the
tail of "everywhere" — was concatenated twice. **5 such overlapping pairs** in the
demo (5 latent duplicate-word artifacts), Javi caught one.
**Fix:** `run.py` now reconciles each adjacent boundary into ONE shared cut time
(`cut_in[]`/`cut_out[]` arrays computed before encoding): overlap → join at the
midpoint; short pause (≤breath) → contiguous, keep it all; long pause (>breath) →
keep `breath` split half/half across the cut, drop the excess dead air. Verified
0 remaining overlaps across all 54 segments.
**Effort:** done.

## B. Unifying color / lighting grade ("looks")  — next (with render rework)
**Want:** a generic grade to unify color + lighting across clips; later the UI
offers 2-3 looks to pick from.
**Approach:** deterministic grade applied to the base video BEFORE overlays —
`eq`/`curves`/`colorbalance` params or a `.cube` LUT (`lut3d`). Add a `looks`
block to `brand.json` (named presets); ship ONE good default tuned toward the
reference (`references/.../assets/example CLEAN.mp4`). Extend the instruction
contract with an additive `"look": "<name>"` field; UI picker later.
**Effort:** small (one look) → medium (curated set + picker).

## C. Subtle auto-reframe / subject centering  — DONE (v1) 2026-06-26
**Want:** slow, subtle virtual camera move that keeps the subject centered when
they sway while speaking. (= Premiere's Auto Reframe.)
**Built:** `engine/reframe.py` (uses opencv-python-headless, Haar frontal+profile
cascade — no model download). Pipeline:
  1. Sample each source take once at 4fps/640px, detect the largest face → path.
  2. Map detections into OUTPUT time, resample to a 10fps grid, **dead-zone**
     (`dead_zone` 0.06 norm — frame HOLDS until the subject drifts past it, so it
     needn't be perfectly centred), moving-average smooth (`smooth_seconds` 2.2s),
     then **velocity-cap** (`max_drift` 0.011 norm/s ≈ 28 px/s) so a sustained
     sway can't read as a pan.
  3. Per segment, lerp the crop top-left between the global path's value at the
     segment's start and end — so adjacent cuts join continuously (no jump).
  4. run.py applies the moving `crop` on the **4K** before the 1080 downscale
     (zoom 1.3 → 2954x1662 crop, downscaled — never upscaled).
Config in `brand.json.reframe` (enabled/zoom/smooth_seconds/face_v/max_drift/
dead_zone/sample_fps); `run.py --no-reframe` to disable.
**Tuning history:** v1 had no dead zone, faster cap (worst pan 86→35 px/s after
cap). Javi: "a bit more subtle, doesn't need to be always centered." → added the
dead zone + slower cap (worst 27 px/s, only ~28/54 segs move at all). **Fail-safe:** no cv2, or a take
with no detections → that segment falls back to the plain centred scale (never
worse than before). Verified on the demo: subject was drifting to cx≈0.68 by
2:10; now held near centre. Detection 54/54 segs. Adds ~70s (one 4K sample pass).
**Still open:** (a) zoom 1.3 can't fully follow extreme drift (>±13%) — clamps;
raise zoom to follow further at the cost of a tighter shot. (b) Multi-format
(9:16/1:1/4:5) reuses the SAME path with a different crop aspect — not wired yet.
(c) Could swap Haar for opencv DNN/YuNet if a future clip has tougher detection.

## Also queued
- **Output quality / bitrate** — DONE 2026-06-26. The deliverable encodes to a
  BITRATE target (`render.py --bitrate`, default **7 Mbps** ≈ 147 MB for 3 min),
  not a quality value — predictable file size. The graded intermediate stays
  near-lossless (`enc_quality` q93) so the per-chunk re-encode doesn't compound.
  History: q65 ≈ 2.4 Mbps felt over-compressed → q82 ≈ 11 Mbps (247 MB) → Javi
  "a bit lighter, 7 Mbps" → bitrate-targeted 7 Mbps. Vignette (strength 0.9) and
  the `broadcast` grade (eq contrast 1.06 / sat 1.10 / bright 0.01) ARE applied
  every render; both intentionally gentle — push in brand.json if more wanted.
- ~~**Render speed + audio sync:**~~ **DONE 2026-06-26.** `render.py` grades the
  cut once into a CFR-30 intermediate, then composites each caption/lower-third
  interval as its own short ffmpeg call (each frame hits only the 1-2 overlays
  active then, not all ~45), concats the chunks, and muxes the ORIGINAL
  continuous audio back. 168s demo renders in **~49 s**. Three bugs found and
  fixed, in order:
  1. **Runaway encodes** — looped-PNG inputs (`-loop 1`) with no output bound
     kept ffmpeg encoding past EOF forever; killing the Python parent orphaned
     the ffmpeg child, which ran for HOURS at 200% CPU. Five such zombies had
     pushed load average to 50 and were starving every render. Fixed by bounding
     output with `-frames:v N` (ffmpeg exits on its own) — and always
     `pkill -9 -f ffmpeg` after killing a render.
  2. **Too slow** — a single full-clip pass runs every frame through all ~45
     overlays (45× the work); even with hardware encode it never finished.
     Per-segment composite is the fix. (libx264 → `h264_videotoolbox` also helps.)
  3. **Audio out of sync** — the first per-segment cut chunks by SECONDS
     (`-t {dur}`), so each chunk rounded to the frame grid and the ~1/3-frame
     losses compounded to ~1 s of drift (body video came out ~30 frames short of
     the audio). Fixed by extracting an EXACT frame count (`-frames:v`, with
     frame-snapped boundaries) so chunk frame counts sum to the source frame
     count — video length matches audio, no accumulation. Verified: 5156 body
     frames = round(171.85s × 30); video 178.437s vs audio 178.425s.
  Wired into the app: `engine_bridge.render()` runs run.py (cut) → render.py
  (branding); preview/export serve `final_branded.mp4`.
- Caption-vs-name-strip rule (suppress/lift captions while a lower-third is up).
- Crisp logo from SVG (`brew install librsvg`).
- Lower-third fade in/out: the per-chunk model hard-cuts the name strip on/off
  (the single-pass version had fades, but that path was too slow). Re-add by
  splitting the LT's boundary intervals to carry alpha ramps, or accept the
  hard cut (it reads fine at speed).
