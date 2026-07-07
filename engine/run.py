#!/usr/bin/env python3
"""
OCHA Vid - runner: executes the LLM "video instruction" -> MP4.

This is the step the user pastes into the tool. The instruction is the contract
your LLM (Copilot / Claude) returns from the transcript. Schema:

{
  "keep": [1,2,5,6],                 # segment ids in playback order (required)
  "captions": true,                  # auto-captions from kept segments (later phase)
  "lower_thirds": [                  # optional name strips (later phase)
     {"at_segment": 1, "name": "TOM FLETCHER", "title": "USG ...", "seconds": 4}
  ],
  "formats": ["16:9", "9:16"]        # output formats (later phase; 16:9 now)
}

Phase-now: executes "keep" -> a clean MP4. captions/lower_thirds/formats are
parsed and echoed so the contract is stable, and wired in as those engines land.

Usage:
    python3 run.py --instruction instruction.json --segments segments.json \
                   --source-dir ../raw_video --out final.mp4
    # accepts pasted JSON via stdin too:
    pbpaste | python3 run.py --segments segments.json --source-dir ../raw_video
"""
import os, sys, json, re, argparse, subprocess, tempfile, shutil


def modern_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


FF = modern_ffmpeg()

try:
    import reframe                       # subject-follow (optional; needs cv2)
except Exception:
    reframe = None


def load_instruction(args):
    raw = None
    if args.instruction:
        raw = open(args.instruction).read()
    elif not sys.stdin.isatty():
        raw = sys.stdin.read()
    if not raw or not raw.strip():
        sys.exit("No instruction provided (use --instruction or pipe JSON via stdin).")
    # tolerate the LLM wrapping JSON in prose / code fences
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        sys.exit("Could not find a JSON object in the instruction.")
    return json.loads(m.group(0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instruction", default=None, help="instruction JSON file (or pipe via stdin)")
    ap.add_argument("--segments", required=True)
    ap.add_argument("--source-dir", required=True)
    ap.add_argument("--out", default="final.mp4")
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--crf", type=int, default=16,
                    help="x264 CRF for the cut mezzanine (lower = higher quality)")
    ap.add_argument("--breath", type=float, default=0.7,
                    help="max pause (s) kept between sentences / breath added at cuts")
    ap.add_argument("--brand", default=str(os.path.join(os.path.dirname(os.path.dirname(
                    os.path.abspath(__file__))), "brand", "brand.json")),
                    help="brand.json (for the reframe / subject-follow config)")
    ap.add_argument("--no-reframe", action="store_true", help="disable subject-follow")
    args = ap.parse_args()

    inst = load_instruction(args)
    seg_by_id = {s["id"]: s for s in json.load(open(args.segments))}
    try:
        brand = json.load(open(args.brand))
    except Exception:
        brand = {}

    keep_ids = inst.get("keep") or []
    keep = [seg_by_id[i] for i in keep_ids if i in seg_by_id]
    if not keep:
        sys.exit("Instruction 'keep' selected no valid segments.")

    # ---- echo the resolved plan (the contract, made human-readable) ----
    print("OCHA Vid - executing instruction")
    print(f"  keep        : {keep_ids}")
    print(f"  captions    : {inst.get('captions', False)}  (engine: pending)")
    print(f"  lower_thirds: {len(inst.get('lower_thirds', []))} (engine: pending)")
    print(f"  formats     : {inst.get('formats', ['16:9'])} (engine: 16:9 now)")

    # ---- execute the cut ----
    FPS, SR = 30, 48000
    SPF = SR // FPS                      # 1600 audio samples per video frame (exact)

    # Reconcile the boundary BETWEEN each pair of adjacent kept segments into a
    # single cut time, so we neither replay an overlap nor lose the breath:
    #   - OVERLAP (Whisper's per-word PAD made next.in < cur.out): both segments
    #     would otherwise include [next.in, cur.out] and the cut plays it twice —
    #     that's the "everywhere-where" duplicated-word bug. Join at the midpoint.
    #   - SHORT pause (gap <= breath): stay contiguous, keep the whole pause.
    #   - LONG pause (gap > breath): keep `breath` (split across the cut), drop the
    #     excess dead air. At a real scene cut / the final segment: trailing breath.
    cut_in  = [s["in"]  for s in keep]
    cut_out = [s["out"] for s in keep]
    for k, s in enumerate(keep):
        nxt = keep[k + 1] if k + 1 < len(keep) else None
        adjacent = bool(nxt) and nxt["file"] == s["file"] and nxt["id"] == s["id"] + 1
        if not adjacent:
            cut_out[k] = s["out"] + args.breath
        else:
            gap = nxt["in"] - s["out"]
            if gap < 0:                                   # overlap -> one shared point
                mid = (s["out"] + nxt["in"]) / 2
                cut_out[k] = mid
                cut_in[k + 1] = mid
            elif gap <= args.breath:                      # short pause -> keep all of it
                cut_out[k] = nxt["in"]
            else:                                         # long pause -> keep `breath`
                half = args.breath / 2
                cut_out[k] = s["out"] + half
                cut_in[k + 1] = nxt["in"] - half

    # Per-segment exact frame counts + their output spans (needed before the crop
    # analysis, which works in OUTPUT time).
    total_frames  = [max(round((cut_out[k] - cut_in[k]) * FPS), 1) for k in range(len(keep))]
    speech_frames = [max(round((min(keep[k]["out"], cut_out[k]) - cut_in[k]) * FPS), 1)
                     for k in range(len(keep))]
    o0, acc = [], 0
    for k in range(len(keep)):
        o0.append(acc / FPS); acc += total_frames[k]
    o1 = [o0[k] + total_frames[k] / FPS for k in range(len(keep))]

    # Subtle subject-follow: a heavily-smoothed crop that drifts to keep the
    # speaker centred, using the 4K headroom (crop -> downscale, never upscale).
    crops = [None] * len(keep)
    rcfg = brand.get("reframe", {})
    if reframe is not None and rcfg.get("enabled", True) and not args.no_reframe:
        meta = [{"file": keep[k]["file"], "cut_in": cut_in[k], "cut_out": cut_out[k],
                 "o0": o0[k], "o1": o1[k]} for k in range(len(keep))]
        try:
            crops = reframe.compute_segment_crops(FF, meta, args.source_dir, rcfg)
            n = sum(1 for c in crops if c)
            print(f"  reframe     : subject-follow on {n}/{len(keep)} segs (zoom {rcfg.get('zoom',1.3)})")
        except Exception as e:
            print(f"  reframe     : skipped ({e})")
            crops = [None] * len(keep)
    else:
        print("  reframe     : off")

    # Lock audio AND video to an IDENTICAL, EXACT frame count per segment so they
    # can't drift when the parts are concatenated (per-segment fps=30 with an exact
    # audio length is what made the old cut creep ~1s out of sync). trim=end_frame
    # fixes the video count; atrim=end_sample (N*1600 @ 48k/30fps) matches the audio;
    # tpad/apad guarantee enough source even at a clip's EOF.
    tmp = tempfile.mkdtemp(prefix="ocha_run_")
    parts, frames_total, timeline = [], 0, []
    for k, s in enumerate(keep):
        src = os.path.join(args.source_dir, s["file"])
        ci, co = cut_in[k], cut_out[k]
        nf = total_frames[k]
        timeline.append({"id": s["id"],
                         "out_start": round(frames_total / FPS, 3),
                         "out_end":   round((frames_total + speech_frames[k]) / FPS, 3),
                         "text": s["text"]})
        frames_total += nf
        part = os.path.join(tmp, f"p{k:03d}.mp4")
        # Optional moving crop (lerp the top-left across the segment so adjacent
        # cuts join continuously); applied on the 4K BEFORE the 1080 downscale.
        crop = ""
        c = crops[k]
        if c:
            seg = max(co - ci, 1e-3)
            crop = (f"crop={c['cw']}:{c['ch']}:"
                    f"x='{c['x0']}+({c['x1']}-{c['x0']})*min(1,t/{seg:.4f})':"
                    f"y='{c['y0']}+({c['y1']}-{c['y0']})*min(1,t/{seg:.4f})',")
        vf = (f"{crop}scale=-2:{args.height},fps={FPS},setsar=1,"
              f"tpad=stop_mode=clone:stop_duration=2,"
              f"trim=end_frame={nf},setpts=PTS-STARTPTS,format=yuv420p")
        af = (f"aresample={SR},apad,atrim=end_sample={nf * SPF},asetpts=PTS-STARTPTS")
        subprocess.run([
            FF, "-y", "-v", "error",
            "-ss", str(round(ci, 3)), "-to", str(round(co + 0.5, 3)), "-i", src,
            "-filter_complex", f"[0:v]{vf}[v];[0:a]{af}[a]",
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-crf", str(args.crf), "-preset", "medium", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), part], check=True)
        parts.append(part)
    print(f"  breath      : up to {args.breath}s kept; boundaries de-overlapped ({len(keep)} segs)")

    listfile = os.path.join(tmp, "list.txt")
    with open(listfile, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    subprocess.run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", listfile, "-c", "copy", "-movflags", "+faststart", args.out],
                   check=True)

    # captions timeline saved for the captions engine (next phase)
    json.dump(timeline, open(os.path.splitext(args.out)[0] + "_timeline.json", "w"), indent=2)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"  -> {os.path.abspath(args.out)}  ({round(frames_total / FPS, 1)}s)")


if __name__ == "__main__":
    main()
