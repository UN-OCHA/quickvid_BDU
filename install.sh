#!/bin/bash
# ============================================================================
# OCHA QuickVid — Mac installer, run via the copy-paste command on the
# OCHA QuickVid page:
#
#   curl -fsSL https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/install.sh | bash
#
# WHY A TERMINAL COMMAND INSTEAD OF A DOUBLE-CLICK FILE:
# macOS Gatekeeper blocks any *downloaded* unsigned app/script with a scary
# "…could not verify … free of malware" dialog that, on macOS 15 (Sequoia),
# only offers "Move to Trash" / "Done" — a dead end for non-technical users.
# A script fetched by `curl` and piped to bash is NOT quarantined and is run
# at your own explicit request, so Gatekeeper never fires. This is the same
# pattern Homebrew, rustup and nvm use. (Windows is unaffected and unchanged.)
#
# What it does, all by itself, no admin password:
#   1. Download OCHA QuickVid into ~/Library/Application Support/OCHA QuickVid.
#   2. Set everything up (Python env, video engine, brand font, speech model)
#      — ~10 minutes the first time.
#   3. Install a "OCHA QuickVid" app into your Applications folder (shows
#      in Launchpad + Spotlight) AND on your Desktop. Both are WRITTEN locally,
#      so they open with no security prompt, ever.
#   4. Start the engine and open OCHA QuickVid in your browser.
#
# Re-running the same command later = UPDATE (your setup is kept, so it's quick)
# and it also puts the Start app back if it was deleted.
#
#   …/install.sh | bash -s -- --fresh
# does the same but ALSO throws away the Python environment and rebuilds it from
# scratch (~10 min). Use it when an install is behaving strangely; the big speech
# model and the fonts live outside the app folder, so they are never re-downloaded.
# Questions: ochavisual@un.org
# ============================================================================
set -e
DEST="$HOME/Library/Application Support/OCHA QuickVid"
APP="$DEST/app"
PORT="${QV_PORT:-17870}"
ZIP_URL="https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip"

FRESH="${QV_FRESH:-0}"
for a in "$@"; do [ "$a" = "--fresh" ] && FRESH=1; done

# Stop a running engine BEFORE touching any file. This is the single most
# important step in the script. The engine is detached and stays up until logout,
# so it survives an "update": we would replace the code on disk under a live
# process that keeps serving the OLD version from memory, and the user sees the
# install succeed while the app stubbornly reports the previous version. (That is
# exactly how colleagues ended up stranded on v0.6.2.) Failure-tolerant
# throughout — a missing pid must never abort an install.
qv_stop_engine() {
  local pids i
  pids="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping the running OCHA QuickVid engine…"
    kill $pids 2>/dev/null || true
  fi
  i=0
  while [ "$i" -lt 20 ]; do                      # ~6s for the port to come free
    curl -s -m 1 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q quickvid || return 0
    sleep 0.3
    i=$((i + 1))
  done
  # Still up: escalate, then give it a moment. Better a hard kill than a silent
  # half-updated install.
  pids="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
  return 0
}

echo "OCHA QuickVid — installing to a system folder (you never need to open it)."
qv_stop_engine
mkdir -p "$DEST"

echo "Downloading OCHA QuickVid (~1 MB)…"
TMPD="$(mktemp -d)"
if ! curl -fL -o "$TMPD/quickvid.zip" "$ZIP_URL"; then
  echo "Download failed — check your internet connection, then run this again."
  rm -rf "$TMPD"; exit 1
fi
# Both of these are allowed to fail: a truncated or corrupt zip is caught by the
# VERSION check below, which gives the user a sentence instead of a `ditto` error.
ditto -x -k "$TMPD/quickvid.zip" "$TMPD" >/dev/null 2>&1 || true
NEW="$TMPD/quickvid_BDU-main"
# Never wipe anything on the strength of a download we haven't checked.
if [ ! -f "$NEW/VERSION" ]; then
  echo "The download looks incomplete — nothing on your Mac was changed."
  echo "Try again in a minute. If it keeps happening, email ochavisual@un.org."
  rm -rf "$TMPD"; exit 1
fi

# Keep the existing Python setup across updates — makes re-installs fast. With
# --fresh we deliberately drop it so the next launch rebuilds the environment.
if [ -d "$APP/.venv" ]; then
  if [ "$FRESH" = 1 ]; then
    echo "Fresh install — rebuilding the Python environment from scratch (~10 min)."
  elif mv "$APP/.venv" "$NEW/.venv" 2>/dev/null; then
    echo "Updating (keeping your existing setup)…"
  else
    # Half-moved is worse than not moved: a broken environment would be carried
    # into the new install. Bin the remains — the next launch rebuilds it.
    rm -rf "$NEW/.venv"
    echo "(couldn't carry your setup over — it will be rebuilt)"
  fi
fi

# Guard the rm -rf. It only ever deletes the app folder we created ourselves. An
# empty or mangled variable is the realistic failure here — "$DEST/app" collapsing
# to "/app", or DEST ending up as $HOME — and any of those would take out a user's
# own files, so refuse instead of deleting.
if [ -z "$APP" ] || [ "$APP" != "$DEST/app" ] \
   || [ -z "$DEST" ] || [ "$DEST" = "/" ] || [ "$DEST" = "$HOME" ]; then
  echo "Refusing to delete an unexpected path: $APP"
  rm -rf "$TMPD"; exit 1
fi
rm -rf "$APP"
mv "$NEW" "$APP"
rm -rf "$TMPD"
echo "$APP" > "$DEST/home"

# ---------------------------------------------------------------------------
# The launcher = a proper .app bundle. It carries the OCHA "Film" icon, shows as
# "OCHA QuickVid" (no extension), and because it is WRITTEN HERE on the Mac
# (not downloaded) it is never quarantined → double-clicks with no Gatekeeper
# prompt. We put it in ~/Applications (Launchpad + Spotlight, no admin needed)
# AND on the Desktop (findable for everyone). Delete either — re-running this
# command puts it back.
# ---------------------------------------------------------------------------
ICNS="$APP/assets/StartOCHAQuickVid.icns"

build_launcher() {                          # $1 = full path of the .app to (re)create
  local appdir="$1"
  rm -rf "$appdir"
  mkdir -p "$appdir/Contents/MacOS" "$appdir/Contents/Resources"
  cat > "$appdir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>OCHA QuickVid</string>
  <key>CFBundleDisplayName</key><string>OCHA QuickVid</string>
  <key>CFBundleIdentifier</key><string>org.unocha.quickvid.starter</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>startocha</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
</dict>
</plist>
PLIST
  cat > "$appdir/Contents/MacOS/startocha" <<'RUN'
#!/bin/bash
# OCHA QuickVid — starts the local engine (headless; your browser opens a few
# seconds later). Made on your Mac at install, so it opens with no security prompt.
DEST="$HOME/Library/Application Support/OCHA QuickVid"
APP="$DEST/app"; [ -f "$DEST/home" ] && APP="$(cat "$DEST/home")"
if [ ! -f "$APP/OCHA QuickVid.command" ]; then
  osascript -e 'display dialog "OCHA QuickVid is not installed on this Mac yet. Open the OCHA QuickVid page and run the one-line install command it shows at the top. Questions? ochavisual@un.org" buttons {"OK"} default button "OK" with icon caution with title "OCHA QuickVid"'
  exit 1
fi
export QV_DETACH=1
exec bash "$APP/OCHA QuickVid.command"
RUN
  chmod +x "$appdir/Contents/MacOS/startocha"
  [ -f "$ICNS" ] && cp "$ICNS" "$appdir/Contents/Resources/AppIcon.icns"
  touch "$appdir"                           # nudge Finder to pick up the icon
}

# Prefer the all-users /Applications when we can write it without a password — true
# for admin accounts (most personal Macs; /Applications is group-writable by `admin`).
# Standard/managed accounts fall back to the per-user ~/Applications. No prompt either
# way: a plain cp/mkdir just fails on a locked /Applications, it never triggers the GUI
# admin dialog. Both show in Launchpad + Spotlight.
if [ -w "/Applications" ]; then
  APPS_DIR="/Applications"
  rm -rf "$HOME/Applications/OCHA QuickVid.app"   # drop any stale per-user duplicate
else
  APPS_DIR="$HOME/Applications"; mkdir -p "$APPS_DIR"
fi
rm -f "$HOME/Desktop/OCHA QuickVid.command"        # sweep away the old plain-script launcher, if any
# Pre-rename cleanup (the launcher was called "Start OCHA QuickVid" until
# 2026-07-23): remove old-named copies so users don't end up with two apps.
rm -rf "$HOME/Applications/Start OCHA QuickVid.app" "$HOME/Desktop/Start OCHA QuickVid.app"
[ -w "/Applications" ] && rm -rf "/Applications/Start OCHA QuickVid.app"
rm -f "$HOME/Desktop/Start OCHA QuickVid.command" "$APP/Start OCHA QuickVid.command"
build_launcher "$APPS_DIR/OCHA QuickVid.app"
build_launcher "$HOME/Desktop/OCHA QuickVid.app"
echo "Installed 'OCHA QuickVid' in $APPS_DIR (Launchpad + Spotlight) and on your Desktop."

echo ""
echo "Setting up and starting OCHA QuickVid…"
export QV_DETACH=1
exec bash "$APP/OCHA QuickVid.command"
