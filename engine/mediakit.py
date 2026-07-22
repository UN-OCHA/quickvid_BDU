"""Shared render primitives — the pieces finish.py and social_brand.py both need.

These used to be copy-pasted into both files, each carrying a "mirror the other,
keep in sync" comment. That is precisely the drift risk this module removes: the
brand constants (safe areas, the watermark size, the logo paths, the bt709 colour
tags) and the HDR/rotation helpers now live once.

Not moved: each file's own `probe()`. finish.py returns a dict (W/H/dur/fps/hdr)
and social_brand a tuple (w/h/fps/dur) — genuinely different shapes for different
call sites, so merging them would be a change, not a cleanup.
"""
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_SVG = os.path.join(ROOT, "assets", "OCHA_logo_horizontal_white.svg")
BUG_SVG = os.path.join(ROOT, "assets", "OCHA_logo_vertical_white.svg")
BRAND_JSON = os.path.join(ROOT, "brand", "brand.json")

# bt709 colour tags on every output, so OCHA blue stays correct end to end.
COLOR = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]

# Corner watermark ("bug") height as a fraction of frame height. Sized to a real
# reference (references/videos/HNPW2026_USG_remarks.mp4, measured ~6.67%); bigger
# than the ending logo's 0.054 because it must read as a persistent mark, not a
# closing beat.
BUG_HEIGHT_FRAC = 0.065

# Social safe-area insets for bug / lower-third placement, by orientation. landscape
# right=.06 matches the reference's ~6.6% margin (not .045 like the LT's left inset).
SAFE_AREA = {"landscape": {"top": .06, "right": .06, "left": .045},
             "portrait": {"top": .11, "right": .06, "left": .06},
             "square": {"top": .08, "right": .08, "left": .08}}


def rotation(s):
    """Display rotation of a video stream, as 0 or 90 (the only distinction that
    matters for placement: 90/270 swap width<->height, 0/180 don't). iPhones store
    PORTRAIT footage as landscape pixels + a rotation flag — an old-style `rotate`
    tag OR a newer displaymatrix side_data `rotation` (a float, often negative).
    ffmpeg auto-rotates the frames on decode, but ffprobe still reports the CODED
    (landscape) width/height — so without this a portrait clip is laid out as 16:9."""
    deg = None
    tags = s.get("tags") or {}
    if tags.get("rotate") is not None:
        try:
            deg = int(tags["rotate"])
        except (ValueError, TypeError):
            deg = None
    if deg is None:
        for sd in s.get("side_data_list") or []:
            if sd.get("rotation") is not None:
                try:
                    deg = int(round(float(sd["rotation"])))
                except (ValueError, TypeError):
                    deg = None
                break
    return 90 if abs(deg or 0) % 180 == 90 else 0


def ffmpeg_hdr():
    """The BUNDLED imageio ffmpeg — it has zscale/tonemap, which a Homebrew build
    set via IMAGEIO_FFMPEG_EXE may not. Ignore that override to reach the bundled
    binary for the HDR pass."""
    import imageio_ffmpeg
    saved = os.environ.pop("IMAGEIO_FFMPEG_EXE", None)
    try:
        return imageio_ffmpeg.get_ffmpeg_exe()
    finally:
        if saved is not None:
            os.environ["IMAGEIO_FFMPEG_EXE"] = saved


def color_tags(src):
    """(color_transfer, color_primaries) of the first video stream, '' when untagged."""
    import json as _json
    ff = ffmpeg_hdr()
    fp = ff.replace("ffmpeg", "ffprobe")
    if not os.path.exists(fp):
        fp = "ffprobe"
    try:
        meta = _json.loads(subprocess.run(
            [fp, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=color_transfer,color_primaries", "-of", "json", src],
            capture_output=True, text=True).stdout)
        s = (meta.get("streams") or [{}])[0]
        return s.get("color_transfer") or "", s.get("color_primaries") or ""
    except Exception:
        return "", ""


def needs_709(src):
    """Why this footage must be converted before sRGB brand graphics composite
    over it: "hdr" (HLG/PQ — tonemap), "gamut" (SDR but wide-gamut primaries:
    BT.2020 or Display P3, the iPhone OCHA-blue-shift case), or None (fine).
    Untagged wide-gamut files can't be detected — that's what the user-facing
    "Fix phone colours" option (look.phone_fix) forces."""
    trc, prim = color_tags(src)
    if trc in ("arib-std-b67", "smpte2084"):
        return "hdr"
    if prim in ("bt2020", "smpte432"):
        return "gamut"
    return None


def to_709_vf(mode="hdr", assume_p3=False):
    """The zscale chain (no format=) for a bt709 conversion — shared by to_sdr and
    the /api/look-preview stills, so the preview can never disagree with the render.
    mode "hdr": linearize + tonemap; "gamut": straight remap. assume_p3 must FULLY
    specify the input: with only `pin` on an untagged file zscale fails with
    "code 3074: no path between colorspaces" (it can't infer matrix/transfer)."""
    if mode == "hdr":
        return ("zscale=t=linear:npl=203,tonemap=hable:desat=0,"
                "zscale=p=bt709:t=bt709:m=bt709:r=tv")
    pin = "min=bt709:tin=bt709:rin=tv:pin=smpte432:" if assume_p3 else ""
    return f"zscale={pin}p=bt709:t=bt709:m=bt709:r=tv"


def normalize_709(src, work, spec_look=None, log=print):
    """ONE gate for the colour-correctness pre-pass, shared by every renderer
    (social_brand, finish, and the statement cut): HDR → tonemap; tagged
    wide-gamut (BT.2020 / Display-P3 SDR — the iPhone OCHA-blue shift) →
    straight remap; user-forced "Fix phone colours" (look.phone_fix) → remap
    assuming Display P3, for untagged files detection can't catch.
    Returns the src to keep using (converted or original)."""
    import look as _look
    why = needs_709(src)
    if why == "hdr":
        log("HDR source → converting to SDR (bt709) so brand colours match…")
        return to_sdr(src, work, mode="hdr")
    if why == "gamut":
        log("Wide-gamut source (phone) → remapping to bt709 so OCHA blue stays true…")
        return to_sdr(src, work, mode="gamut")
    if _look.phone_fix(spec_look):
        log("Fix phone colours is ON → remapping to bt709 (assuming Display P3)…")
        return to_sdr(src, work, mode="gamut", assume_p3=True)
    return src


def to_sdr(src, tmp, mode="hdr", assume_p3=False):
    """Normalize footage to SDR bt709, so overlaid sRGB graphics read correctly.
    mode "hdr"   — HLG/PQ: linearize + tonemap (the original iPhone-HDR fix).
    mode "gamut" — SDR wide-gamut (BT.2020 / Display P3): straight colour-space
                   remap, NO tonemap (tonemapping SDR would crush it).
    assume_p3    — untagged file forced by the user's "Fix phone colours": tell
                   zscale the input is Display P3, since the tags can't.
    ffmpeg auto-rotates on decode, so this also bakes any rotation upright."""
    out = os.path.join(tmp, "sdr.mp4")
    vf = to_709_vf(mode, assume_p3) + ",format=yuv420p"
    subprocess.run(
        [ffmpeg_hdr(), "-y", "-v", "error", "-i", src, "-vf", vf,
         "-c:v", "libx264", "-crf", "16", "-preset", "medium"] + COLOR
        + ["-c:a", "copy", out], check=True)
    return out
