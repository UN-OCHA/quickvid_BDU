"""Paths, ffmpeg selection, and brand access for the backend."""
import os
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]      # .../ocha_quick_vid
ENGINE_DIR = ROOT / "engine"
WEB_DIR = ROOT / "app" / "web"                   # legacy desktop UI (retired; kept in git history)
UI_DIR = ROOT / "browser"                        # the single unified UI (browser + full mode)
WORKSPACE = ROOT / "app" / "workspace"          # per-job working dirs (gitignored)
BRAND_FILE = ROOT / "brand" / "brand.json"

VERSION = "0.2.0"
ENGINE_PORT = 17870                              # fixed port the web app pings to detect the engine

WORKSPACE.mkdir(parents=True, exist_ok=True)

# Whisper model is NOT user-chosen — one good default. "small" is the
# not-too-fast / not-too-slow middle (tiny|base are rough, medium|large slow on CPU).
DEFAULT_MODEL = "small"


def _adopt_static_ffmpeg():
    """Zero-admin fallback for Macs without Homebrew: the `static-ffmpeg` pip
    package fetches FULL static ffmpeg+ffprobe builds (all codecs incl.
    pcm_s24be, VideoToolbox linked) into site-packages on first use. We symlink
    the pair into .venv/bin because the engine derives ffprobe from the ffmpeg
    path via a naive `replace("ffmpeg","ffprobe")` — a directory named
    static_ffmpeg would break that; `.venv/bin/ffmpeg` is replace-safe."""
    try:
        from static_ffmpeg import run
        ffmpeg, ffprobe = run.get_or_fetch_platform_executables_else_raise()
        bin_dir = Path(sys.executable).parent            # .venv/bin
        for src, name in ((ffmpeg, "ffmpeg"), (ffprobe, "ffprobe")):
            link = bin_dir / name
            if not link.exists():
                link.symlink_to(src)
        return str(bin_dir / "ffmpeg")
    except Exception:
        return None


def _detect_ffmpeg():
    """Prefer Homebrew ffmpeg (VideoToolbox hw decode; decodes raw Sony
    pcm_s24be — imageio's minimal build is software-only and lacks that codec).
    Fall back to a previously-adopted portable build, PATH, then fetch the
    portable build (user-space, no admin — how colleague Macs get ffmpeg)."""
    for candidate in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg",
                      str(Path(sys.executable).parent / "ffmpeg")):
        if Path(candidate).exists():
            return candidate
    return shutil.which("ffmpeg") or _adopt_static_ffmpeg()


FFMPEG = _detect_ffmpeg()
# ffprobe lives beside ffmpeg; swap only the BASENAME (a path like
# .../static_ffmpeg/bin/ffmpeg would corrupt under a whole-string replace).
FFPROBE = str(Path(FFMPEG).with_name(Path(FFMPEG).name.replace("ffmpeg", "ffprobe"))) if FFMPEG else None
if FFMPEG:
    # The engine calls imageio_ffmpeg.get_ffmpeg_exe(), which honors this env
    # var — so we steer every engine subprocess to the same binary WITHOUT
    # touching engine code. Remove this and 4K decode falls back to imageio's
    # slow software build (and raw camera audio won't decode).
    os.environ["IMAGEIO_FFMPEG_EXE"] = FFMPEG


def brand() -> dict:
    return json.loads(BRAND_FILE.read_text())
