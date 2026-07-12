#!/bin/bash
# ============================================================================
# OCHA QuickVid — Mac start script (double-click me).
#
# First run: sets everything up by itself — Python environment, a portable
# video engine (ffmpeg), the OCHA brand font, and the speech-recognition
# model. No Homebrew, no admin password. One-time, ~10 minutes on office wifi.
# Every run after that: starts in seconds and opens QuickVid in your browser.
#
# Your videos never leave this machine.
#
# macOS may say "can't be opened — unidentified developer" the FIRST time:
# that's normal for files from the internet. Right-click this file → Open →
# Open. You only do that once.
# ============================================================================
set -e
cd "$(dirname "$0")"
# 17870 is the fixed port the web app looks for the engine on — keep them equal
# or the page will say "engine not detected" even while this window is running.
PORT="${QV_PORT:-17870}"

echo "OCHA QuickVid — checking your setup…"

# 1) Python 3. macOS installs it with the Command Line Tools (guided, one-time).
#    Prefer a newer python3.x when present (Homebrew/python.org); the stock CLT
#    python3 (3.9) works too. 3.14+ is skipped — no faster-whisper wheels yet.
PY=""
for c in python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1; then
    v=$("$c" -c 'import sys; print(sys.version_info.minor)' 2>/dev/null || echo 0)
    if [ "$v" -ge 9 ] && [ "$v" -le 13 ]; then PY="$c"; break; fi
  fi
done
if [ -z "$PY" ]; then
  echo ""
  echo "Python 3 is missing. macOS will now offer to install its Command Line Tools —"
  echo "accept (it may ask for your Mac password), wait for it to finish, then"
  echo "double-click this file again."
  xcode-select --install >/dev/null 2>&1 || true
  read -r -p "Press Enter to close…"
  exit 1
fi

# 2) Python environment + dependencies (one-time; quick when already done)
if [ ! -d .venv ]; then
  echo "Setting up (one-time) — creating the Python environment…"
  "$PY" -m venv .venv
fi
./.venv/bin/pip install -q --upgrade pip >/dev/null 2>&1 || true
./.venv/bin/pip install -q -r requirements.txt

# 3) Video engine (ffmpeg). If the Mac already has one (e.g. via Homebrew) we
#    use it. Otherwise we fetch a PORTABLE build into the app's own environment:
#    user-space, no Homebrew, no admin password. (settings.py symlinks the pair
#    into .venv/bin so the whole engine picks it up.)
if [ ! -x /opt/homebrew/bin/ffmpeg ] && [ ! -x /usr/local/bin/ffmpeg ] \
   && ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x .venv/bin/ffmpeg ]; then
  echo "One-time: downloading the portable video engine (~80 MB, no admin needed)…"
  ./.venv/bin/python - <<'PY' || echo "(couldn't pre-download — QuickVid will fetch it on first use instead)"
from static_ffmpeg import run
ffmpeg, ffprobe = run.get_or_fetch_platform_executables_else_raise()
print("Video engine ready.")
PY
fi

# 4) OCHA brand font (Raleway). The engine carries its own copy for rendering,
#    but installing it for the user (no admin needed) keeps every other tool on
#    this Mac on-brand too. Quiet when already installed.
mkdir -p "$HOME/Library/Fonts"
copied=0
for f in engine/assets/fonts/Raleway-*.ttf; do
  base="$(basename "$f")"
  if [ ! -f "$HOME/Library/Fonts/$base" ]; then cp "$f" "$HOME/Library/Fonts/"; copied=1; fi
done
[ "$copied" = 1 ] && echo "Installed the OCHA brand font (Raleway) for your user."

# 5) Speech-recognition model (one-time, ~500 MB). Downloading it now means the
#    first transcription starts instantly instead of stalling mysteriously.
if [ ! -d "$HOME/.cache/huggingface/hub/models--Systran--faster-whisper-small" ]; then
  echo "One-time: downloading the speech-recognition model (~500 MB)."
  echo "This is the longest step — a few minutes on office wifi. Progress below…"
  ./.venv/bin/python - <<'PY' || echo "(couldn't pre-download — the first transcription will fetch it instead)"
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8")
print("Speech model ready.")
PY
fi

# 6) Launch and open the browser. 127.0.0.1 (not "localhost") on purpose — the
#    app treats it as its one canonical address so saved progress is never split
#    between the two.
echo ""
echo "Starting OCHA QuickVid at http://127.0.0.1:$PORT  (leave this window open)"
if [ -z "$QV_NO_OPEN" ]; then (sleep 2 && open "http://127.0.0.1:$PORT") & fi
exec ./.venv/bin/uvicorn app.backend.main:app --host 127.0.0.1 --port "$PORT"
