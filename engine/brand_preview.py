"""OCHA QuickVid — one branded still, rendered by the REAL overlay graph.

Answers "show me this element on a frame of MY video" for the lower third, the
captions, the OCHA logo watermark, text on screen, the location strip and the
ending logo.

WHY IT IS BUILT THIS WAY
------------------------
The obvious way to preview a lower third is to redraw it in HTML and CSS over a
still. Do not. That is a SECOND implementation of the OCHA brand, and it will
drift from the render — `browser/brand-lt.json` exists precisely because two
implementations of one thing had already drifted once. A preview that lies is
worse than none.

So this module renders the preview with `social_brand.render()` — the same
function, the same filter graph, the same PNG element renderers that produce the
finished video. It gets there without touching that file at all:

    1. pull ONE frame from the source at time `t` (with the same colour
       normalization and Look the render would apply);
    2. make a short silent CLIP out of that single frame;
    3. run the ordinary render over that clip, with every element starting at 0;
    4. take the frame once the entrance animations have settled.

Step 2 is what makes step 3 free: `social_brand.render()` wants a video, and a
looped still IS a video. Nothing in the graph needs to know it is a preview, so
the preview cannot disagree with the render — there is only one graph.

Cost is two extra ffmpeg passes over a ~2-second still-clip: fractions of a
second. Results are cached by the caller.

The Look is baked into the still in step 1, so the preview spec carries
`look: None` — otherwise it would be applied twice and the preview would be
darker/punchier than the export.
"""

from __future__ import annotations

import os
import subprocess
import tempfile

import lower_third as LT
import mediakit
import pin_locator as PIN
import social_brand
import text_on as TX

# Long enough that every entrance animation has finished and nothing has begun to
# leave. The elements report their own timings, so this follows them automatically
# if an animation is ever retimed.
SETTLE = round(max(LT.ENTER_END, PIN.ENTER_END, TX.ENTER) + 0.25, 2)
CLIP_SECONDS = round(SETTLE + 1.0, 2)      # a little tail so no overlay is at its edge
CLIP_FPS = 25


def _ff() -> str:
    return mediakit.ffmpeg_hdr()


def _still(video: str, t: float, look: dict | None, phone_fix: bool, dest: str) -> None:
    """One frame at `t`, colour-corrected exactly as the render would correct it.

    PNG, not JPEG: this frame is re-encoded twice more downstream, and JPEG
    artefacts would compound into something the export never shows.
    """
    import look as look_engine

    vf = []
    why = mediakit.needs_709(video)
    if why:
        vf.append(mediakit.to_709_vf(why))
    elif phone_fix:
        vf.append(mediakit.to_709_vf("gamut", assume_p3=True))
    chain = look_engine.chain(look)
    if chain:
        vf.append(chain)
    cmd = [_ff(), "-y", "-v", "error", "-ss", str(max(0.0, float(t))), "-i", video]
    if vf:
        cmd += ["-vf", ",".join(vf)]
    cmd += ["-frames:v", "1", str(dest)]
    subprocess.run(cmd, check=True)


def _clip(still: str, dest: str) -> None:
    """Turn the still into a short silent clip the real render can consume."""
    subprocess.run(
        [_ff(), "-y", "-v", "error",
         "-loop", "1", "-framerate", str(CLIP_FPS), "-i", still,
         "-t", str(CLIP_SECONDS), "-c:v", "libx264", "-preset", "ultrafast",
         "-pix_fmt", "yuv420p", str(dest)],
        check=True)


def _at_zero(spec: dict) -> dict:
    """Re-time every element to start immediately.

    A preview is one instant, so "when" is meaningless here — the user is judging
    position, size and colour. Everything is placed at 0 and read at SETTLE.
    """
    out = dict(spec)

    # NOTE the key is `in`, not `t_in` — LT.build/PIN.build read `in` and RETURN
    # `t_in`. Setting `t_in` here would be silently ignored and the lower third
    # would sit at its 1.5s default, past the frame this preview reads.
    out["lower_thirds"] = [{**lt, "in": 0.0, "hold": max(float(lt.get("hold", 3.6)), CLIP_SECONDS)}
                           for lt in (spec.get("lower_thirds") or [])]
    out["texts"] = [{**tx, "start": 0.0, "duration": CLIP_SECONDS}
                    for tx in (spec.get("texts") or [])]
    out["pins"] = [{**p, "start": 0.0, "duration": CLIP_SECONDS}
                   for p in (spec.get("pins") or [])]
    # one caption, on screen for the whole clip
    cue = (spec.get("cues") or [])
    out["cues"] = [[0.0, cue[0][1]]] if cue else []

    end = dict(spec.get("ending") or {"style": "none"})
    if end.get("style") == "over_footage":
        end["at"] = 0.0        # logo already snapped on, so it can be seen and positioned
        end["click"] = False   # the preview is silent; no click asset needed
    else:
        # over_black is a black card the body graph never draws, so previewing it
        # over footage would show nothing. The body is what this preview is for.
        end = {"style": "none"}
    out["ending"] = end

    out["look"] = None                     # already baked into the still (see module docstring)
    out["footage_end"] = CLIP_SECONDS
    return out


def render(video: str, t: float, spec: dict, out_jpg: str,
           phone_fix: bool = False, width: int = 720) -> str:
    """Render `spec`'s elements over the frame of `video` at `t`. Returns out_jpg."""
    work = tempfile.mkdtemp(prefix="ocha_brandprev_")
    try:
        still = os.path.join(work, "frame.png")
        clip = os.path.join(work, "clip.mp4")
        branded = os.path.join(work, "branded.mp4")

        _still(video, t, spec.get("look"), phone_fix, still)
        _clip(still, clip)

        prev = _at_zero(spec)
        prev["src"] = clip
        prev["out"] = branded
        prev["fps"] = CLIP_FPS
        prev["bitrate"] = "8M"                     # a still compresses to nothing; keep it clean
        social_brand.render(prev, log=lambda *a, **k: None)

        w = max(160, min(1920, int(width or 720)))
        subprocess.run(
            [_ff(), "-y", "-v", "error", "-ss", str(SETTLE), "-i", branded,
             "-vf", f"scale={w}:-2", "-frames:v", "1", "-q:v", "3", str(out_jpg)],
            check=True)
        return out_jpg
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
