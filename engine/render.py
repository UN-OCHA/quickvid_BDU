#!/usr/bin/env python3
"""
OCHA Vid - branding pass (per-segment composite, FRAME-EXACT).

Architecture:
  1. Build all overlay PNGs (static look, caption cards, lower thirds) with Pillow.
  2. Grade the cut once into a CFR-30 intermediate (graded_v.mp4).
  3. Slice the timeline at every caption/lower-third boundary, SNAPPED TO THE
     30fps FRAME GRID. Composite each short interval as its own ffmpeg call,
     extracting an EXACT frame count with `-frames:v N` (never `-t seconds`).
  4. Concat the chunks (stream copy) and mux the ORIGINAL continuous audio back.
  5. Append the OCHA click ending.

Why per-segment: a single full-clip pass runs every frame through ALL ~45
overlay filters (45x the per-frame work) — too slow even with hardware encode.
Per-segment runs each frame through only the 1-2 overlays active at that moment.

Why frame-EXACT (`-frames:v`, not `-t`): the first per-segment version cut each
chunk by SECONDS, so every chunk's duration rounded to the frame grid and the
~1/3-frame losses compounded into ~1 s of audio/video drift across the clip.
Extracting an exact frame count makes the chunk frame counts sum to exactly the
source frame count, so the concatenated video matches the audio length with no
accumulating drift. Bonus: `-frames:v` bounds the output, so ffmpeg terminates
even with looped-PNG inputs — no runaway encodes if a parent process is killed.

Visual layers (all PNG via Pillow, composited with ffmpeg overlay):
  - static: vignette + bottom gradient + logo  (pre-composited, always on)
  - captions: one PNG per merged card (18 words / 5 s / 1.2 s gap limit)
  - lower thirds: name + title strips (hard cut on/off in this model; fade TODO)
  - ending: OCHA Logo click.mov on black, appended via concat
"""
import os, sys, json, argparse, subprocess, tempfile, shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


def modern_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()      # honors IMAGEIO_FFMPEG_EXE
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


FF = modern_ffmpeg()


def _has_vt(FF):
    r = subprocess.run([FF, "-hide_banner", "-encoders"], capture_output=True, text=True)
    return "h264_videotoolbox" in r.stdout


def enc_quality(FF, q):
    """Quality-targeted encoder opts (used for the high-q intermediate).
    q is 1-100 (higher = better); mapped to a CRF for the libx264 fallback."""
    if _has_vt(FF):
        return ["h264_videotoolbox"], ["-q:v", str(q)]
    crf = max(14, min(26, round(26 - (q / 100) * 12)))
    return ["libx264"], ["-crf", str(crf), "-preset", "veryfast"]


def enc_bitrate(FF, mbps):
    """Bitrate-targeted encoder opts (used for the deliverable) — predictable file
    size. ~7 Mbps is high-quality 1080p talking-head. maxrate/bufsize cap peaks."""
    vb = f"{int(round(mbps * 1000))}k"
    mr = f"{int(round(mbps * 1500))}k"
    bs = f"{int(round(mbps * 3000))}k"
    if _has_vt(FF):
        return ["h264_videotoolbox"], ["-b:v", vb, "-maxrate", mr, "-bufsize", bs]
    return ["libx264"], ["-b:v", vb, "-maxrate", mr, "-bufsize", bs, "-preset", "medium"]


def probe_duration(FF, path, fallback=0.0):
    """Real container duration — the cut can run a few seconds past the timeline's
    last out_end (breathing tails), so fades must key off this, not the timeline."""
    fp = FF.replace("ffmpeg", "ffprobe")
    r = subprocess.run([fp, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except (ValueError, AttributeError):
        return fallback


# ---------- text helpers ----------

def font(path, size):
    for p in (path, "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def text_w(draw, s, fnt):
    box = draw.textbbox((0, 0), s, font=fnt)
    return box[2] - box[0]


def wrap(draw, s, fnt, max_w):
    words, lines, cur = s.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if text_w(draw, trial, fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def merge_caption_cards(timeline, max_words=18, max_dur=5.0, max_gap=1.2):
    """Group per-segment lines into readable caption cards (fewer overlays = faster)."""
    cards = []
    for seg in timeline:
        txt = (seg.get("text") or "").strip()
        if not txt:
            continue
        if cards:
            c = cards[-1]
            if (seg["out_end"] - c["start"] <= max_dur
                    and len((c["text"] + " " + txt).split()) <= max_words
                    and seg["out_start"] - c["end"] <= max_gap):
                c["text"] = (c["text"] + " " + txt).strip()
                c["end"] = seg["out_end"]
                continue
        cards.append({"text": txt, "start": seg["out_start"], "end": seg["out_end"]})
    return cards


# ---------- layer renderers (each returns a full-canvas RGBA image) ----------

def layer_gradient(W, H, grad_h, max_alpha=200):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    band = Image.new("RGBA", (W, grad_h), (0, 0, 0, 0))
    px = band.load()
    for y in range(grad_h):
        a = int(max_alpha * (y / grad_h) ** 1.4)
        for x in range(W):
            px[x, y] = (0, 0, 0, a)
    img.alpha_composite(band, (0, H - grad_h))
    return img


def layer_vignette(W, H, strength):
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    inset = int(W * 0.08)
    d.ellipse([-inset, -inset, W + inset, H + inset], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(W // 7))
    alpha = mask.point(lambda v: int((255 - v) * 0.45 * strength))
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    img.putalpha(alpha)
    return img


def layer_logo(W, H, logo_path, height_px, margin):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if not Path(logo_path).exists():
        return img
    logo = Image.open(logo_path).convert("RGBA")
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)
    scale = height_px / logo.height
    logo = logo.resize((max(1, int(logo.width * scale)), height_px), Image.LANCZOS)
    img.alpha_composite(logo, (W - logo.width - margin, margin))
    return img


def layer_caption(W, H, text, brand):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = brand["captions"]
    fnt = font(brand["fonts"]["caption"], c["fontsize"])
    lines = wrap(d, text, fnt, int(W * 0.78))
    lh = int(c["fontsize"] * 1.32)
    total = lh * len(lines)
    y = H - c["bottom_margin_px"] - total
    for ln in lines:
        x = (W - text_w(d, ln, fnt)) // 2
        d.text((x + 2, y + 2), ln, font=fnt, fill=(0, 0, 0, 170))      # shadow
        d.text((x, y), ln, font=fnt, fill=(255, 255, 255, 255))
        y += lh
    return img


def layer_lower_third(W, H, name, title, brand):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lt = brand["lower_third"]
    name_f = font(brand["fonts"]["name"], lt["name_fontsize"])
    title_f = font(brand["fonts"]["title"], lt["title_fontsize"])
    pad_x, pad_y = 22, 12
    name = (name or "").upper()
    nw, nh = text_w(d, name, name_f), int(lt["name_fontsize"] * 1.2)
    tw, th = text_w(d, title, title_f), int(lt["title_fontsize"] * 1.2)
    name_box = (nw + 2 * pad_x, nh + 2 * pad_y)
    title_box = (tw + 2 * pad_x, th + 2 * pad_y)
    x = lt["x_px"]
    title_top = H - lt["bottom_margin_px"] - title_box[1]
    name_top = title_top - name_box[1]
    d.rectangle([x, name_top, x + name_box[0], name_top + name_box[1]], fill=lt["name_box_color"])
    d.text((x + pad_x, name_top + pad_y), name, font=name_f, fill=lt["name_text_color"])
    d.rectangle([x, title_top, x + title_box[0], title_top + title_box[1]], fill=lt["title_strip_color"])
    d.text((x + pad_x, title_top + pad_y), title, font=title_f, fill=lt["title_text_color"])
    return img


FPS = 30


def frame_intervals(caps, lts, n_frames):
    """Slice [0, n_frames) at every caption/lower-third edge, snapped to the frame
    grid. Returns [(f_start, f_end, cap_idx_or_None, lt_idx_or_None)]. Because the
    cuts are integer frame indices that tile [0, n_frames), the chunk frame counts
    sum to EXACTLY n_frames — the property that keeps audio and video in sync."""
    edges = {0, n_frames}
    for _, a, b in caps:
        edges.add(min(max(round(a * FPS), 0), n_frames))
        edges.add(min(max(round(b * FPS), 0), n_frames))
    for _, a, dur in lts:
        edges.add(min(max(round(a * FPS), 0), n_frames))
        edges.add(min(max(round((a + dur) * FPS), 0), n_frames))
    pts = sorted(edges)
    out = []
    for i in range(len(pts) - 1):
        fs, fe = pts[i], pts[i + 1]
        if fe <= fs:
            continue
        mid_t = ((fs + fe) / 2) / FPS
        ci = next((k for k, (_, a, b) in enumerate(caps) if a <= mid_t < b), None)
        li = next((k for k, (_, a, dur) in enumerate(lts) if a <= mid_t < a + dur), None)
        out.append((fs, fe, ci, li))
    return out


def render_chunk(FF, encoder, enc_opts, graded_v, f_start, count,
                 static_png, cap_png, lt_png, fade_out_dur, dst):
    """Composite one interval, emitting EXACTLY `count` frames (`-frames:v`).
    `-frames:v` — not `-t seconds` — is what guarantees the chunk is an exact
    frame count (no rounding drift) AND bounds the looped-PNG inputs so ffmpeg
    exits on its own. `fade_out_dur` > 0 fades this (final) chunk to black."""
    inputs = [FF, "-y", "-v", "error",
              "-ss", f"{f_start / FPS:.6f}", "-i", str(graded_v),
              "-loop", "1", "-i", str(static_png)]
    layers = ["[0:v][1:v]overlay=0:0[bg]"]
    prev, idx = "bg", 2
    if cap_png:
        inputs += ["-loop", "1", "-i", str(cap_png)]
        layers.append(f"[{prev}][{idx}:v]overlay=0:0[cap]")
        prev, idx = "cap", idx + 1
    if lt_png:
        inputs += ["-loop", "1", "-i", str(lt_png)]
        layers.append(f"[{prev}][{idx}:v]overlay=0:0[lt]")
        prev, idx = "lt", idx + 1
    if fade_out_dur > 0:
        st = max(count / FPS - fade_out_dur, 0)
        layers.append(f"[{prev}]fade=t=out:st={st:.3f}:d={fade_out_dur:.3f},format=yuv420p[vout]")
    else:
        layers.append(f"[{prev}]format=yuv420p[vout]")
    cmd = (inputs
           + ["-filter_complex", ";".join(layers),
              "-map", "[vout]", "-an",
              "-frames:v", str(count),     # EXACT frame count → no drift, bounded output
              "-c:v"] + encoder + enc_opts
           + ["-pix_fmt", "yuv420p", "-r", "30", str(dst)])
    subprocess.run(cmd, check=True)


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--instruction", default=None)
    ap.add_argument("--brand", default=str(Path(__file__).resolve().parents[1] / "brand" / "brand.json"))
    ap.add_argument("--root", default=None,
                    help="project root for resolving brand asset paths (default: brand file's parent's parent)")
    ap.add_argument("--out", default="final_branded.mp4")
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--bitrate", type=float, default=7.0,
                    help="target video bitrate in Mbps for the deliverable (~7 = high-quality 1080p)")
    args = ap.parse_args()

    brand    = json.loads(Path(args.brand).read_text())
    timeline = json.loads(Path(args.timeline).read_text())
    inst     = json.loads(Path(args.instruction).read_text()) if args.instruction else {}
    root     = Path(args.root) if args.root else Path(args.brand).resolve().parents[1]

    W = brand["canvas"]["width"]
    H = brand["canvas"]["height"]
    DUR = probe_duration(FF, args.video,
                         fallback=max((c["out_end"] for c in timeline), default=0))
    fade = 0.5
    encoder, enc_opts = enc_bitrate(FF, args.bitrate)   # final (chunks + ending), ~7 Mbps
    _, enc_hi = enc_quality(FF, 93)                     # graded intermediate (less gen-loss)
    tmp = Path(tempfile.mkdtemp(prefix="ocha_brand_"))
    print(f"OCHA Vid - branding pass  ({W}x{H}, {DUR:.1f}s, encoder={encoder[0]}, {args.bitrate} Mbps)")

    # --- always-on layer: vignette + gradient + logo, pre-composited to one PNG
    static = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    static.alpha_composite(layer_vignette(W, H, brand["vignette"]["strength"]))
    static.alpha_composite(layer_gradient(W, H, brand["captions"]["gradient_height_px"]))
    logo_path = root / brand["logo"]["file"]
    static.alpha_composite(layer_logo(W, H, logo_path, brand["logo"]["height_px"], brand["logo"]["margin_px"]))
    static_png = tmp / "static.png"
    static.save(static_png)

    # --- captions: merge segments into readable cards (fewer overlays = faster)
    caps = []
    if inst.get("captions", True):
        for i, card in enumerate(merge_caption_cards(timeline)):
            p = tmp / f"cap{i:03d}.png"
            layer_caption(W, H, card["text"], brand).save(p)
            caps.append((p, card["start"], card["end"]))
    print(f"  captions    : {len(caps)} card(s) from {len(timeline)} segment(s)")

    # --- lower thirds (name strips) -> map at_segment to its output start time
    start_of = {c["id"]: c["out_start"] for c in timeline}
    lts = []
    for lt in inst.get("lower_thirds", []):
        a = start_of.get(lt.get("at_segment"), 0.0)
        dur = lt.get("seconds", 4)
        p = tmp / f"lt{len(lts)}.png"
        layer_lower_third(W, H, lt.get("name", ""), lt.get("title", ""), brand).save(p)
        lts.append((p, a, dur))
    print(f"  lower_thirds: {len(lts)}")

    # --- grade once into a CFR-30 intermediate (the seek source for the chunks).
    look = inst.get("look") or brand.get("looks", {}).get("default")
    grade = brand.get("looks", {}).get("presets", {}).get(look, "")
    print(f"  look        : {look or 'none'}")
    graded_v = tmp / "graded_v.mp4"
    subprocess.run(
        [FF, "-y", "-v", "error", "-i", args.video]
        + (["-vf", grade] if grade else [])
        + ["-vsync", "cfr", "-r", "30", "-g", "30",    # CFR + 1 s GOP → clean per-chunk seek
           "-c:v"] + encoder + enc_hi                  # high-q intermediate (re-encoded by chunks)
        + ["-pix_fmt", "yuv420p", "-an", str(graded_v)],
        check=True)
    n_frames = int(round(probe_duration(FF, graded_v, fallback=DUR) * FPS))

    # --- composite each frame-snapped interval (exact frame count → no drift).
    intervals = frame_intervals(caps, lts, n_frames)
    print(f"  compositing : {len(intervals)} interval(s), {n_frames} frames @ {FPS}fps")
    chunks = []
    for k, (fs, fe, ci, li) in enumerate(intervals):
        cp = tmp / f"chunk{k:04d}.mp4"
        is_last = (k == len(intervals) - 1)
        render_chunk(
            FF, encoder, enc_opts, graded_v, fs, fe - fs,
            static_png,
            caps[ci][0] if ci is not None else None,
            lts[li][0] if li is not None else None,
            fade if is_last else 0.0,
            cp)
        chunks.append(cp)

    # --- concat chunks (identical params → stream copy), then mux ORIGINAL audio.
    concat_v = tmp / "concat_v.mp4"
    (tmp / "chunks.txt").write_text("".join(f"file '{p}'\n" for p in chunks))
    subprocess.run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", str(tmp / "chunks.txt"), "-c", "copy", str(concat_v)],
                   check=True)

    main_mp4 = tmp / "main.mp4"
    subprocess.run(
        [FF, "-y", "-v", "error",
         "-i", str(concat_v),      # branded video (no audio)
         "-i", args.video,          # original cut (continuous audio)
         "-map", "0:v", "-map", "1:a",
         "-c:v", "copy",
         "-af", f"afade=t=out:st={max(DUR - fade, 0):.2f}:d={fade}",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
         "-shortest", str(main_mp4)],
        check=True)

    # --- ending: OCHA click .mov centered on a black canvas, its own click audio
    ending_src = root / brand["ending"]["asset"]
    parts = [main_mp4]
    if ending_src.exists():
        edur = probe_duration(FF, ending_src, fallback=6.5)
        ending_mp4 = tmp / "ending.mp4"
        subprocess.run(
            [FF, "-y", "-v", "error", "-i", str(ending_src),
             "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r=30:d={edur:.2f}",
             "-filter_complex",
             "[1:v][0:v]overlay=(W-w)/2:(H-h)/2,fade=t=in:st=0:d=0.4,fps=30,format=yuv420p[ve]",
             "-map", "[ve]", "-map", "0:a",
             "-c:v"] + encoder + enc_opts + [
             "-pix_fmt", "yuv420p", "-r", "30",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
             str(ending_mp4)],
            check=True)
        parts.append(ending_mp4)
        print("  ending      : appended (with click audio)")

    # --- concat body + ending (identical params -> stream copy)
    listf = tmp / "list.txt"
    listf.write_text("".join(f"file '{p}'\n" for p in parts))
    subprocess.run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", str(listf), "-c", "copy", "-movflags", "+faststart", args.out],
                   check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"  -> {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
