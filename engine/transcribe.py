#!/usr/bin/env python3
"""
OCHA Vid - step 1: folder -> transcript (Whisper, no LLM, offline).

Scans a folder of raw clips, transcribes each with faster-whisper, and writes:
  * segments.json  - machine-readable segments (id, source file, in/out, text)
  * transcript.txt - paste-ready transcript + instruction block for Copilot

You paste transcript.txt into Copilot; it returns a keep-list like "KEEP: 1,2,5-7";
you feed that to cut.py.

Usage:
    python3 transcribe.py --folder ../raw_video --out . --model base
"""
import os, sys, json, glob, argparse, subprocess, tempfile, shutil


def modern_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


FF = modern_ffmpeg()
VIDEO_EXT = (".mp4", ".mov", ".mxf", ".mkv", ".m4v")


def tc(s):
    m, sec = divmod(s, 60)
    return f"{int(m):02d}:{sec:05.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", required=True, help="folder of raw clips")
    ap.add_argument("--out", default=".", help="output folder")
    ap.add_argument("--model", default="base", help="whisper model: tiny/base/small/medium")
    ap.add_argument("--lang", default=None, help="force language code, e.g. en")
    args = ap.parse_args()

    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    clips = sorted(f for f in glob.glob(os.path.join(args.folder, "*"))
                   if f.lower().endswith(VIDEO_EXT))
    if not clips:
        sys.exit("No video files found in " + args.folder)

    segments, sid = [], 0
    tmp = tempfile.mkdtemp(prefix="ocha_tr_")
    for clip in clips:
        wav = os.path.join(tmp, "a.wav")
        subprocess.run([FF, "-y", "-v", "error", "-i", clip, "-vn",
                        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
                       check=True)
        segs, info = model.transcribe(wav, language=args.lang, word_timestamps=True)
        PAD = 0.10  # small breath of padding around speech
        for s in segs:
            text = s.text.strip()
            if not text:
                continue
            # tighten to first/last spoken word so leading/trailing silence is dropped
            if getattr(s, "words", None):
                start, end = s.words[0].start, s.words[-1].end
            else:
                start, end = s.start, s.end
            sid += 1
            segments.append({"id": sid, "file": os.path.basename(clip),
                             "in": round(max(start - PAD, 0), 2),
                             "out": round(end + PAD, 2),
                             "text": text})
    shutil.rmtree(tmp, ignore_errors=True)

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "segments.json"), "w") as f:
        json.dump(segments, f, indent=2)

    lines = [
        "# OCHA Vid - transcript for cut selection",
        "# Paste this whole file into Copilot, then follow the instruction at the bottom.",
        "",
    ]
    for s in segments:
        lines.append(f"[{s['id']}] ({s['file']} {tc(s['in'])}-{tc(s['out'])}) {s['text']}")
    lines += [
        "",
        "Speaker (optional, fill in for a name strip):  NAME, TITLE",
        "",
        "--- INSTRUCTION FOR YOUR LLM (Copilot / Claude) ---",
        "You are preparing an edit instruction for the OCHA Vid tool.",
        "From the numbered transcript above, build the cleanest version of the talk:",
        "  - select the segments to KEEP, in playback order;",
        "  - remove filler words, false starts, repetition and off-topic chatter;",
        "  - do NOT reword anything, only choose segment numbers.",
        "Return ONLY this JSON, nothing else:",
        "{",
        '  "keep": [<segment numbers in order>],',
        '  "captions": true,',
        '  "lower_thirds": [{"at_segment": <id>, "name": "NAME", "title": "TITLE", "seconds": 4}],',
        '  "formats": ["16:9"]',
        "}",
        "If no speaker is given above, use \"lower_thirds\": [].",
    ]
    with open(os.path.join(args.out, "transcript.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Transcribed {len(segments)} segments from {len(clips)} clip(s).")
    print("Wrote transcript.txt and segments.json to", os.path.abspath(args.out))


if __name__ == "__main__":
    main()
