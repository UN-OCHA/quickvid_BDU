#!/usr/bin/env python3
"""
Statement clip engine — the QuickVid pipeline for clips of a UN/OCHA principal's
remarks (Security Council / member-states briefings, pieces to camera).

The craft rules come from the ASG Ukraine reference build (July 2026):
  * cut on the WORDS, hide every speech-edit with a shot change (punch-in
    between a "general" crop and a ~1.5x "close" crop — hard cut, no motion);
  * contiguous segments = one continuous take = no shot change needed; only
    toggle shots across a GAP (a real cut);
  * no fade in / no fade out — hard cuts top and tail;
  * ending: 2.6s of footage after the last segment becomes the bed the OCHA
    logo snaps onto (over_footage), or a black card (over_black).

Actions (CLI: python3 statement.py --do <action> --spec spec.json):
  applysync   {src, offset, out}                       bake an A/V offset (+ = audio later)
  transcribe  {src, start?, end?, model?, out_json}    windowed word-level transcript
  still       {src, t, crop:[w,h,x,y], out, width?}    one framed still (jpg)
  render      {src, segments:[{in,out,shot?,text?}], subject:{x,y}, preset|canvas,
               lower_third?, ending{style}, captions?, out}
Progress prints to stdout (the backend streams it to the UI); `RESULT {json}`
is the last line.
"""
import argparse
import json
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import social_brand  # noqa: E402  (same engine dir; shares fonts/logo/click plumbing)
import lower_third   # noqa: E402  (shared LT animation timing constants — same brand-lt.json spec)

FF = os.environ.get("IMAGEIO_FFMPEG_EXE") or "/opt/homebrew/bin/ffmpeg"

# Destination presets — the numbers we actually shipped (Ukraine 9:16, Venezuela 1:1).
# Captions: boxed for social feeds; the EVENT look is no-box white over a bottom gradient.
# Caption rows: bottom_hi/bottom_lo — captions sit at LO and LIFT to HI while a lower
# third is up. Tall canvases (reels/4:5) have room for BOTH, so hi == lo there: one
# constant position that clears the LT — no caption jump when the LT leaves (ASG Yemen
# feedback). Square + event genuinely collide, so they keep the lift.
PRESETS = {
    "reels":  {"canvas": [1080, 1920], "sub": {"box": True,  "size": 46, "max_w": 920,  "bottom_hi": 1430, "bottom_lo": 1430},
               "lt": {"bottom": 1620, "name_size": 46, "org_size": 30}},
    "square": {"canvas": [1080, 1080], "sub": {"box": True,  "size": 44, "max_w": 800,  "bottom_hi": 806,  "bottom_lo": 900},
               "lt": {"bottom": 972,  "name_size": 40, "org_size": 23}},
    "feed45": {"canvas": [1080, 1350], "sub": {"box": True,  "size": 44, "max_w": 860,  "bottom_hi": 1050, "bottom_lo": 1050},
               "lt": {"bottom": 1215, "name_size": 42, "org_size": 26}},
    "event":  {"canvas": [1920, 1080], "sub": {"box": False, "size": 46, "max_w": 1500, "bottom_hi": 880,  "bottom_lo": 1000},
               "lt": {"bottom": 960,  "name_size": 44, "org_size": 26}},
}
END_BED = 2.6            # default footage kept after the last sentence (ending.tail overrides, 0-4s)
LOGO_LEAD = 0.5          # logo snaps this long into the bed (a beat after the last word)
JUMP_GAP = 1.5           # skipped source time (s) that counts as a real JUMP: new take + punch-in
                         # + "[...]" caption marker. Below this it's just a pause — same take,
                         # pause kept. (0.25s was wrong: natural pauses are 0.3-1.0s.)
                         # Mirrored in browser/statement.js stAutoShots — keep in sync.


def _probe(src):
    return social_brand.probe(src)


# ---------------- framing ----------------
def crop_rect(sw, sh, cw, ch, x=0.5, y=0.40, zoom=1.0):
    """ONE crop rect [w,h,x,y]: the largest source window at the target aspect,
    tightened by `zoom` (1.0 = largest possible, 2.0 = twice as tight), centred
    on the subject point (fractions of the source frame) and clamped inside it."""
    ar = cw / ch
    gw, gh = (sh * ar, sh) if sw / sh >= ar else (sw, sw / ar)
    z = max(1.0, min(2.5, float(zoom or 1.0)))         # sanity cap; UI caps at 2.0
    w, h = gw / z, gh / z
    px = min(max(float(x) * sw - w / 2, 0), sw - w)
    py = min(max(float(y) * sh - h / 2, 0), sh - h)
    return [int(round(w)) // 2 * 2, int(round(h)) // 2 * 2, int(round(px)), int(round(py))]


def crops(sw, sh, cw, ch, subject, framing=None):
    """(general, close) crop rects [w,h,x,y] of the source for a target canvas.
    New model: framing = {"general": {x,y,zoom}, "close": {x,y,zoom}} — each frame
    positioned and zoomed independently (close defaults to a 1.5x punch-in).
    Back-compat: legacy `subject` {x,y} alone drives both frames."""
    base = {"x": float((subject or {}).get("x", 0.5)), "y": float((subject or {}).get("y", 0.40))}
    f = framing or {}
    g = {**base, "zoom": 1.0, **{k: float(v) for k, v in (f.get("general") or {}).items()}}
    c = {**base, "zoom": 1.5, **{k: float(v) for k, v in (f.get("close") or {}).items()}}
    return (crop_rect(sw, sh, cw, ch, g["x"], g["y"], g["zoom"]),
            crop_rect(sw, sh, cw, ch, c["x"], c["y"], c["zoom"]))


def build_runs(segments, jump_gap=JUMP_GAP):
    """Group the SELECTED sentences into continuous RUNS. Consecutive sentences whose
    source gap is under `jump_gap` play as ONE take: overlapping Whisper boundaries are
    clamped (no repeated frames) and the speaker's natural pauses are KEPT (that's the
    breathing between sentences). A larger gap = skipped content = a real jump: new run,
    punch-in, and a "[...]" caption marker.
    Run shot: an explicit userShot on any sentence sets the whole run; otherwise runs
    alternate general → close (open on the wider, sharpest framing)."""
    runs = []
    for seg in sorted(segments, key=lambda s: s["in"]):
        if runs and seg["in"] - runs[-1]["out"] < jump_gap:
            r = runs[-1]
            r["out"] = max(r["out"], seg["out"])
            r["segs"].append(seg)
        else:
            runs.append({"in": seg["in"], "out": seg["out"], "segs": [seg]})
    shot = None
    for r in runs:
        user = next((s.get("userShot") for s in r["segs"] if s.get("userShot")), None)
        if user:
            r["shot"] = user
        elif shot is None:                              # first run: legacy per-seg shot or general
            r["shot"] = next((s.get("shot") for s in r["segs"] if s.get("shot")), None) or "general"
        else:
            r["shot"] = "close" if shot == "general" else "general"
        shot = r["shot"]
    return runs


# ---------------- captions from the cut ----------------
def two_line_chars(sub):
    """Character budget that fits TWO caption lines (the hard max on social — more reads
    as a block over the video). Raleway 500 averages ~0.55em per glyph."""
    return max(44, int(2 * sub["max_w"] / (sub["size"] * 0.55)))


def cues_from_runs(runs, sub, min_show=1.2):
    """Caption cues on the CUT timeline, from continuous runs.
    - text = the EXACT spoken words (Whisper) — never a pasted script
    - each cue fits two rendered lines; longer sentences split at word boundaries,
      timed by the word onsets
    - the first caption after a jump gets the "[...]" omission marker
    - blink-and-miss cues (<min_show s) merge forward while they still fit"""
    budget = two_line_chars(sub)
    cues, t = [], 0.0
    for ri, r in enumerate(runs):
        first_in_run = True
        for seg in r["segs"]:
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            mark = "[...] " if (ri and first_in_run) else ""
            first_in_run = False
            words = seg.get("words") or []
            if words and len(mark + text) > budget:
                chunks, cur, limit = [], [], budget - len(mark)
                for w in words:
                    if cur and len(" ".join(x["w"] for x in cur + [w])) > limit:
                        chunks.append(cur); cur, limit = [w], budget
                    else:
                        cur.append(w)
                if cur:
                    chunks.append(cur)
                for ci, ch in enumerate(chunks):
                    start = t + max(0.0, ch[0]["s"] - r["in"])
                    cues.append([round(start, 2), (mark if ci == 0 else "") + " ".join(w["w"] for w in ch)])
            else:
                start = t + max(0.0, (words[0]["s"] if words else seg["in"]) - r["in"])
                cues.append([round(start, 2), mark + text])
        t += r["out"] - r["in"]
    merged = []                                         # min display time: fold tiny cues forward
    for c in cues:
        if (merged and c[0] - merged[-1][0] < min_show
                and not c[1].startswith("[...]")
                and len(merged[-1][1]) + 1 + len(c[1]) <= budget):
            merged[-1][1] += " " + c[1]
        else:
            merged.append(c)
    return merged


def cues_real_timeline(segments, max_len=7.0):
    """Caption cues on the ORIGINAL video timeline — for a FINISHED clip (Titles &
    branding + subtitles): nothing is cut, so each segment's own time is the cue
    time. Long segments split at word boundaries at a ~7s cap."""
    cues = []
    for seg in segments:
        dur = seg["out"] - seg["in"]
        words = seg.get("words") or []
        text = (seg.get("text") or "").strip()
        if dur > max_len and len(words) > 3:
            parts = max(2, math.ceil(dur / (max_len * 0.9)))
            per = math.ceil(len(words) / parts)
            for i in range(0, len(words), per):
                chunk = words[i:i + per]
                cues.append([round(chunk[0]["s"], 2), " ".join(w["w"] for w in chunk)])
        elif text:
            cues.append([round(seg["in"], 2), text])
    return cues


# ---------------- actions ----------------
def do_applysync(spec):
    off = float(spec["offset"])
    src, out = spec["src"], spec["out"]
    print(f"Baking A/V offset {off:+.3f}s (audio {'later' if off > 0 else 'earlier'})…", flush=True)
    if off >= 0:
        af = f"adelay={int(off * 1000)}|{int(off * 1000)}"
    else:
        af = f"atrim=start={-off},asetpts=PTS-STARTPTS"
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", src, "-c:v", "copy",
                    "-af", af, "-c:a", "aac", "-b:a", "192k", out], check=True)
    print("RESULT " + json.dumps({"path": out}), flush=True)


def do_transcribe(spec):
    src = spec["src"]
    _, _, _, dur = _probe(src)
    # One or more [start, end] windows. Back-compat: fall back to a single start/end
    # (or the whole video). Multiple windows let a principal who speaks in two separate
    # blocks be transcribed together — timestamps are made absolute (w.start + start),
    # so step 5 shows a single sentence list in timeline order.
    ranges = spec.get("ranges") or [[spec.get("start"), spec.get("end")]]
    from faster_whisper import WhisperModel
    model = WhisperModel(spec.get("model") or "small", device="cpu", compute_type="int8")
    out, lang = [], None
    for i, r in enumerate(ranges):
        start = max(0.0, float(r[0] or 0))
        end = min(dur, float(r[1] or dur))
        if end <= start:
            continue
        wav = f"{spec['out_json']}.{i}.wav"
        print(f"Extracting audio {start:.0f}s–{end:.0f}s…", flush=True)
        subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(start), "-t", str(end - start),
                        "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
        print(f"Transcribing window {i + 1}/{len(ranges)} with Whisper — a few minutes for a long window…", flush=True)
        print("PROGRESS 0", flush=True)
        segs, info = model.transcribe(wav, language=spec.get("lang"), beam_size=5, word_timestamps=True)
        lang = lang or info.language
        wdur = info.duration or (end - start) or 1       # window audio length, for the % bar
        lastp = -1
        for s in segs:
            # Whisper yields segments in order; how far into this window we are,
            # spread across all windows → overall percent.
            pct = int(min(100, (i + min(1.0, (s.end or 0) / wdur)) / len(ranges) * 100))
            if pct != lastp:
                lastp = pct
                print(f"PROGRESS {pct}", flush=True)
            text = s.text.strip()
            if not text:
                continue
            words = [{"w": w.word.strip(), "s": round(w.start + start, 2), "e": round(w.end + start, 2)}
                     for w in (s.words or [])]
            a = words[0]["s"] if words else round(s.start + start, 2)
            b = words[-1]["e"] if words else round(s.end + start, 2)
            out.append({"in": round(max(a - 0.10, 0), 2), "out": round(b + 0.12, 2),
                        "text": text, "words": words})
        os.remove(wav)
    out.sort(key=lambda x: x["in"])                          # windows may be entered out of order
    for sid, seg in enumerate(out, 1):
        seg["id"] = sid
    print("PROGRESS 100", flush=True)
    print(f"…{len(out)} segments", flush=True)
    json.dump(out, open(spec["out_json"], "w"), ensure_ascii=False)
    print("RESULT " + json.dumps({"segments": len(out), "language": lang}), flush=True)


def do_still(spec):
    w, h, x, y = spec["crop"]
    scale = f",scale={spec['width']}:-2" if spec.get("width") else ""
    subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(spec["t"]), "-i", spec["src"],
                    "-vf", f"crop={w}:{h}:{x}:{y}{scale}", "-frames:v", "1", "-q:v", "3",
                    spec["out"]], check=True)
    print("RESULT " + json.dumps({"path": spec["out"]}), flush=True)


def do_render(spec):
    src, out = spec["src"], spec["out"]
    sw, sh, sfps, sdur = _probe(src)
    preset = PRESETS.get(spec.get("preset") or "reels", PRESETS["reels"])
    cw, ch = spec.get("canvas") or preset["canvas"]
    fps = 30
    runs = build_runs(sorted(spec["segments"], key=lambda s: s["in"]))
    general, close = crops(sw, sh, cw, ch, spec.get("subject") or {}, spec.get("framing"))
    rects = {"general": general, "close": close}
    ending = spec.get("ending") or {"style": "over_footage"}
    style = ending.get("style", "over_footage")
    workdir = os.path.dirname(os.path.abspath(out))
    base = os.path.join(workdir, "base_cut.mp4")

    print(f"Cutting {len(runs)} continuous take(s) → {cw}x{ch}…", flush=True)
    inputs, fc, pairs = [], [], []
    for i, r in enumerate(runs):
        inputs += ["-ss", f"{r['in']:.2f}", "-t", f"{r['out'] - r['in']:.2f}", "-i", src]
        w, h, x, y = rects.get(r["shot"], close)
        fc.append(f"[{i}:v]crop={w}:{h}:{x}:{y},scale={cw}:{ch},setsar=1,fps={fps},setpts=PTS-STARTPTS[v{i}]")
        pairs.append(f"[v{i}][{i}:a]")
    n = len(runs)
    footage_end = sum(r["out"] - r["in"] for r in runs)
    tail = ending.get("tail")                          # UI "footage after the last sentence" (0-4s)
    tail = END_BED if tail is None else max(0.0, min(4.0, float(tail)))
    bed_len = 0.0
    if style == "over_footage":                        # bed: footage right after the last word,
        bed_in = runs[-1]["out"]                       # SAME framing as the last take (no free punch)
        bed_len = min(tail, max(0.0, sdur - bed_in))
        if bed_len < 0.8:                              # not enough tail for the logo beat — black card
            style, bed_len = "over_black", 0.0
        else:
            inputs += ["-ss", f"{bed_in:.2f}", "-t", f"{bed_len:.2f}", "-i", src]
            w, h, x, y = rects.get(runs[-1]["shot"], general)
            fc.append(f"[{n}:v]crop={w}:{h}:{x}:{y},scale={cw}:{ch},setsar=1,fps={fps},setpts=PTS-STARTPTS[v{n}]")
            # the tail's SOUND fades to silence — whoever speaks next in the room must
            # never be heard under our logo (the "Je remercie…" bug)
            fc.append(f"[{n}:a]afade=t=out:st=0.1:d={min(0.6, max(0.2, bed_len - 0.2)):.2f}[abed]")
            pairs.append(f"[v{n}][abed]")
            n += 1
    fc.append("".join(pairs) + f"concat=n={n}:v=1:a=1[v][a]")
    r = subprocess.run([FF, "-y", "-loglevel", "error"] + inputs +
                       ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]",
                        "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p",
                        "-r", str(fps), "-c:a", "aac", "-b:a", "192k", base],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("cut ffmpeg failed: " + (r.stderr or "")[-500:])

    print("Branding — captions, lower third, OCHA ending…", flush=True)
    # Lower thirds: the multi-row UI sends lower_thirds[] with per-LT start/duration.
    # Back-compat: an old single `lower_third` still works.
    lts_in = spec.get("lower_thirds")
    if lts_in is None:
        one = spec.get("lower_third") or {}
        lts_in = [{"name": one.get("name"), "org": one.get("title"), "org2": one.get("title2"),
                   "align": one.get("align"), "start": 1.5, "duration": 3.6 + lower_third.ENTER_END + lower_third.EXIT_DUR}] if one.get("name") else []
    lts = []
    for l in lts_in:
        if not (l.get("name") or "").strip():
            continue
        titles = [t for t in [l.get("org") or l.get("title"), l.get("org2") or l.get("title2")] if t]
        hold = max(0.5, float(l.get("duration", 5)) - lower_third.ENTER_END - lower_third.EXIT_DUR)
        lts.append({**preset["lt"], "name": l["name"], "titles": titles,
                    "align": l.get("align", "center"), "in": float(l.get("start", 1.5)), "hold": hold})
    # Subtitles: {"on": bool, "style": "box"|"gradient"} — style overrides the
    # preset default (boxed social vs clean-over-gradient event look).
    sub_cfg = {**preset["sub"],
               **({"box": (spec.get("subtitles") or {}).get("style") == "box"}
                  if (spec.get("subtitles") or {}).get("style") else {})}
    bspec = {
        "src": base, "out": out, "canvas": [cw, ch], "fps": fps,
        "bitrate": "12M",                              # 6M default reads soft on 1080x1920
        "footage_end": round(footage_end, 2),
        "subtitle": sub_cfg,
        "cues": cues_from_runs(runs, sub_cfg)
                if (spec.get("subtitles") or {}).get("on", spec.get("captions", True)) else [],
        "lower_thirds": lts,
        "bug": spec.get("bug") or {},
        "ending": {"style": style, "at": round(footage_end + (LOGO_LEAD if style == "over_footage" else 0), 2),
                   "hold": float(ending.get("hold", 2.0)), "click": ending.get("click", True)},
    }
    if style == "none":
        bspec["ending"] = {"style": "none"}
    social_brand.render(bspec, log=lambda m: print(m, flush=True))
    print("RESULT " + json.dumps({"path": out, "base": base, "footage_end": round(footage_end, 2),
                                  "duration": round(footage_end + (bed_len if style == 'over_footage' else
                                                                   (float(ending.get("hold", 2.0)) if style == "over_black" else 0.0)), 2)}),
          flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--do", required=True, choices=["applysync", "transcribe", "still", "render"])
    ap.add_argument("--spec", required=True)
    args = ap.parse_args()
    spec = json.loads(open(args.spec).read())
    {"applysync": do_applysync, "transcribe": do_transcribe,
     "still": do_still, "render": do_render}[args.do](spec)


if __name__ == "__main__":
    main()
