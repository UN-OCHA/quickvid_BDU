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
#   3. Install a "Start OCHA QuickVid" app into your Applications folder (shows
#      in Launchpad + Spotlight) AND on your Desktop. Both are WRITTEN locally,
#      so they open with no security prompt, ever.
#   4. Start the engine and open OCHA QuickVid in your browser.
#
# Re-running the same command later = UPDATE (your setup is kept, so it's quick)
# and it also puts the Start app back if it was deleted.
# Questions: ochavisual@un.org
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

# ---------------------------------------------------------------------------
# The launcher = a proper .app bundle. It carries the OCHA "Film" icon, shows as
# "Start OCHA QuickVid" (no extension), and because it is WRITTEN HERE on the Mac
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
  <key>CFBundleName</key><string>Start OCHA QuickVid</string>
  <key>CFBundleDisplayName</key><string>Start OCHA QuickVid</string>
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
if [ ! -f "$APP/Start OCHA QuickVid.command" ]; then
  osascript -e 'display dialog "OCHA QuickVid is not installed on this Mac yet. Open the OCHA QuickVid page and run the one-line install command it shows at the top. Questions? ochavisual@un.org" buttons {"OK"} default button "OK" with icon caution with title "OCHA QuickVid"'
  exit 1
fi
export QV_DETACH=1
exec bash "$APP/Start OCHA QuickVid.command"
RUN
  chmod +x "$appdir/Contents/MacOS/startocha"
  [ -f "$ICNS" ] && cp "$ICNS" "$appdir/Contents/Resources/AppIcon.icns"
  touch "$appdir"                           # nudge Finder to pick up the icon
}

mkdir -p "$HOME/Applications"
rm -f "$HOME/Desktop/Start OCHA QuickVid.command"    # sweep away the old plain-script launcher, if any
build_launcher "$HOME/Applications/Start OCHA QuickVid.app"
build_launcher "$HOME/Desktop/Start OCHA QuickVid.app"
echo "Installed 'Start OCHA QuickVid' in your Applications folder (Launchpad + Spotlight) and on your Desktop."

echo ""
echo "Setting up and starting OCHA QuickVid…"
export QV_DETACH=1
exec bash "$APP/Start OCHA QuickVid.command"
