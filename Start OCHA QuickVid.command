#!/bin/bash
# ============================================================================
# OCHA QuickVid — Mac start script (double-click me).
#
# First run: sets everything up by itself — Python environment, a portable
# video engine (ffmpeg), the OCHA brand font, and the speech-recognition
# model. No Homebrew, no admin password. One-time, ~10 minutes on office wifi.
# Every run after that: starts in seconds and opens OCHA QuickVid in your browser.
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

# Self-register this install's location so the tiny "Start OCHA QuickVid" starter the
# web page hands out can find the engine wherever it lives (no buried folders).
QV_SUPPORT="$HOME/Library/Application Support/OCHA QuickVid"
mkdir -p "$QV_SUPPORT"
pwd > "$QV_SUPPORT/home"

# Already running? Then there's nothing to do — just open the page.
if curl -s -m 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q quickvid; then
  echo "OCHA QuickVid is already running — opening it in your browser."
  [ -z "$QV_NO_OPEN" ] && open "http://127.0.0.1:$PORT"
  exit 0
fi

# --- Self-update: if GitHub has a newer version, refresh the app code before starting,
#     so nobody has to re-download anything. Skipped for developer checkouts (a .git dir),
#     and never allowed to block startup: any hiccup falls through to the current version.
if [ -z "$QV_NO_UPDATE" ] && [ ! -d .git ]; then
  LOCAL_V="$(cat VERSION 2>/dev/null || echo 0.0.0)"
  REMOTE_V="$(curl -fsL -m 3 "https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/VERSION" 2>/dev/null | tr -d '[:space:]')"
  case "$REMOTE_V" in
    [0-9]*.[0-9]*)
      if [ "$REMOTE_V" != "$LOCAL_V" ] \
         && [ "$(printf '%s\n%s\n' "$LOCAL_V" "$REMOTE_V" | sort -V | tail -1)" = "$REMOTE_V" ]; then
        echo "Updating OCHA QuickVid  $LOCAL_V → $REMOTE_V …"
        UTMP="$(mktemp -d)"
        if curl -fsL -m 180 -o "$UTMP/qv.zip" "https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip" \
           && ditto -x -k "$UTMP/qv.zip" "$UTMP" && [ -f "$UTMP/quickvid_BDU-main/VERSION" ]; then
          # Mirror the new code over this install: keep the Python env (.venv) and this
          # running launcher (a file can't safely replace itself mid-run). --delete clears
          # anything dropped upstream; -c (checksum) avoids the same-size/same-mtime skip
          # that would strand VERSION and make it re-update every launch. rsync ships with macOS.
          if rsync -ac --delete --exclude='.venv' --exclude='Start OCHA QuickVid.command' \
                   "$UTMP/quickvid_BDU-main/" "./"; then
            cp -f "$UTMP/quickvid_BDU-main/VERSION" ./VERSION   # guarantee the marker (belt + suspenders)
            echo "Updated to $REMOTE_V."
          else
            echo "(update copy interrupted — starting your current version)"
          fi
        else
          echo "(couldn't download the update — starting your current version)"
        fi
        rm -rf "$UTMP"
      fi ;;
  esac
fi

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
  ./.venv/bin/python - <<'PY' || echo "(couldn't pre-download — OCHA QuickVid will fetch it on first use instead)"
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
#    between the two. With QV_DETACH=1 (the web-downloaded starter/installer) the
#    engine runs in the BACKGROUND: the window can close; it stays on until the
#    Mac shuts down or logs out.
echo ""
if [ -n "$QV_DETACH" ]; then
  nohup ./.venv/bin/uvicorn app.backend.main:app --host 127.0.0.1 --port "$PORT" \
    >> "$QV_SUPPORT/engine.log" 2>&1 &
  disown
  sleep 2
  [ -z "$QV_NO_OPEN" ] && open "http://127.0.0.1:$PORT"
  echo "OCHA QuickVid is running in the background — you can CLOSE this window."
  echo "It stays on until you shut down or log out. (Log: $QV_SUPPORT/engine.log)"
  exit 0
fi
echo "Starting OCHA QuickVid at http://127.0.0.1:$PORT  (leave this window open)"
if [ -z "$QV_NO_OPEN" ]; then (sleep 2 && open "http://127.0.0.1:$PORT") & fi
exec ./.venv/bin/uvicorn app.backend.main:app --host 127.0.0.1 --port "$PORT"
