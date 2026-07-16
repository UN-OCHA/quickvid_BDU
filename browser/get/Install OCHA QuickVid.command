#!/bin/bash
# ============================================================================
# OCHA QuickVid — one-time INSTALLER for Mac (downloaded from the OCHA QuickVid page).
#
# Double-click me (the FIRST time macOS says "unidentified developer":
# right-click → Open → Open — that's normal for internet downloads).
#
# What I do, all by myself, no admin password:
#   1. Download OCHA QuickVid into a system folder you never need to touch
#      (~/Library/Application Support/OCHA QuickVid).
#   2. Set everything up (Python environment, video engine, brand font,
#      speech-recognition model) — ~10 minutes the first time.
#   3. Start the engine and open OCHA QuickVid in your browser.
#
# Running me again later = UPDATE OCHA QuickVid (your setup is kept, so it's quick).
# ============================================================================
set -e
DEST="$HOME/Library/Application Support/OCHA QuickVid"
APP="$DEST/app"
ZIP_URL="https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip"

echo "OCHA QuickVid — installing to a system folder (you never need to open it)."
mkdir -p "$DEST"

echo "Downloading OCHA QuickVid (~1 MB)…"
TMPD="$(mktemp -d)"
curl -fL -o "$TMPD/quickvid.zip" "$ZIP_URL"
ditto -x -k "$TMPD/quickvid.zip" "$TMPD"

# Keep the existing Python setup across updates — makes re-installs fast.
if [ -d "$APP/.venv" ]; then
  echo "Updating (keeping your existing setup)…"
  mv "$APP/.venv" "$TMPD/quickvid_BDU-main/.venv"
fi
rm -rf "$APP"
mv "$TMPD/quickvid_BDU-main" "$APP"
rm -rf "$TMPD"
echo "$APP" > "$DEST/home"

echo ""
echo "Setting up and starting OCHA QuickVid…"
export QV_DETACH=1
exec bash "$APP/Start OCHA QuickVid.command"
