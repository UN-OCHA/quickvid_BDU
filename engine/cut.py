#!/usr/bin/env python3
"""
OCHA Vid - step 2: keep-list -> exported MP4 (no branding yet).

Reads the keep-list your Copilot returned (e.g. "KEEP: 1,2,5-7") plus segments.json,
assembles the kept segments in order, and exports a single MP4.

"Lightweight, highest quality" = H.264, visually near-lossless CRF, +faststart.
Resolution and CRF are configurable; default 1080p.

Usage:
    python3 cut.py --keep "KEEP: 1,2" --segments segments.json --source-dir ../raw_video --out cut.mp4
    python3 cut.py --keep-file edit.txt --segments segments.json --source-dir ../raw_video
"""
import os, sys, json, re, argparse, subprocess, tempfile, shutil


def modern_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


FF = modern_ffmpeg()


def parse_keep(spec):
    spec = re.sub(r"(?i)^\s*keep\s*:", "", spec).strip()
    ids = []
    for part in re.split(r"[,\s]+", spec):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-")
            ids += list(range(int(a), int(b) + 1))
        else:
            ids.append(int(part))
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", default=None)
    ap.add_argument("--keep-file", default=None)
    ap.add_argument("--segments", required=True)
    ap.add_argument("--source-dir", required=True)
    ap.add_argument("--out", default="cut.mp4")
    ap.add_argument("--height", type=int, default=1080, help="output height (1080, 2160, ...)")
    ap.add_argument("--crf", type=int, default=18, help="lower = higher quality (18 ~ near-lossless)")
    args = ap.parse_args()

    spec = args.keep
    if args.keep_file:
        spec = open(args.keep_file).read()
    if not spec:
        sys.exit("Provide --keep or --keep-file")

    seg_by_id = {s["id"]: s for s in json.load(open(args.segments))}
    ids = parse_keep(spec)
    keep = [seg_by_id[i] for i in ids if i in seg_by_id]
    if not keep:
        sys.exit("No matching segments for: " + spec)

    tmp = tempfile.mkdtemp(prefix="ocha_cut_")
    parts = []
    for k, s in enumerate(keep):
        src = os.path.join(args.source_dir, s["file"])
        part = os.path.join(tmp, f"p{k:03d}.mp4")
        # normalise each segment to common params so concat is clean
        subprocess.run([
            FF, "-y", "-v", "error", "-ss", str(s["in"]), "-to", str(s["out"]), "-i", src,
            "-vf", f"scale=-2:{args.height},fps=30,setsar=1,format=yuv420p",
            "-c:v", "libx264", "-crf", str(args.crf), "-preset", "medium", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", part], check=True)
        parts.append(part)

    listfile = os.path.join(tmp, "list.txt")
    with open(listfile, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    # same codecs -> concat by stream copy (fast, lossless join)
    subprocess.run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", listfile, "-c", "copy", "-movflags", "+faststart", args.out],
                   check=True)
    shutil.rmtree(tmp, ignore_errors=True)

    kept = ",".join(str(s["id"]) for s in keep)
    print(f"Kept segments {kept} -> {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
