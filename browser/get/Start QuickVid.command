#!/bin/bash
# ============================================================================
# OCHA QuickVid — STARTER for Mac (downloaded from the QuickVid page).
#
# Double-click me to start the QuickVid engine. It runs quietly in the
# background and stays on until you shut down or log out — the QuickVid page
# unlocks by itself a few seconds later.
#
# (First double-click of a downloaded file: right-click → Open → Open.
#  Tip: keep me in your Downloads or Desktop — I work every time.)
# ============================================================================
DEST="$HOME/Library/Application Support/OCHA QuickVid"
APP=""
[ -f "$DEST/home" ] && APP="$(cat "$DEST/home")"
[ -f "$APP/Start QuickVid.command" ] || APP="$DEST/app"

if [ ! -f "$APP/Start QuickVid.command" ]; then
  echo "QuickVid isn't installed on this Mac yet."
  echo "Go back to the QuickVid page and download the INSTALLER (first-time) instead."
  read -r -p "Press Enter to close…"
  exit 1
fi

export QV_DETACH=1
exec bash "$APP/Start QuickVid.command"
