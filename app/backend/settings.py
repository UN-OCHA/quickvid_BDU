"""Paths, ffmpeg selection, and brand access for the backend."""
import os
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]      # .../ocha_quick_vid
ENGINE_DIR = ROOT / "engine"
WEB_DIR = ROOT / "app" / "web"
WORKSPACE = ROOT / "app" / "workspace"          # per-job working dirs (gitignored)
BRAND_FILE = ROOT / "brand" / "brand.json"

WORKSPACE.mkdir(parents=True, exist_ok=True)

# Whisper model is NOT user-chosen — one good default. "small" is the
# not-too-fast / not-too-slow middle (tiny|base are rough, medium|large slow on CPU).
DEFAULT_MODEL = "small"


def _detect_ffmpeg():
    """Prefer Homebrew ffmpeg: it has VideoToolbox hw decode AND decodes the raw
    Sony pcm_s24be audio. imageio's bundled static build is software-decode only
    and lacks that codec (it timed out on 4K in the Cowork sandbox)."""
    for candidate in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if Path(candidate).exists():
            return candidate
    return shutil.which("ffmpeg")


FFMPEG = _detect_ffmpeg()
if FFMPEG:
    # The engine calls imageio_ffmpeg.get_ffmpeg_exe(), which honors this env
    # var — so we steer the engine to Homebrew ffmpeg WITHOUT touching engine
    # code. Subprocesses inherit os.environ. Remove this and 4K decode falls
    # back to imageio's slow software build (and the raw audio won't decode).
    os.environ["IMAGEIO_FFMPEG_EXE"] = FFMPEG


def brand() -> dict:
    return json.loads(BRAND_FILE.read_text())
