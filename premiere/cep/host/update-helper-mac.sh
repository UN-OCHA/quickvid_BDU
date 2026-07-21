#!/bin/bash
# OCHA QuickVid panel — update helper (macOS).
#
# Spawned detached by js/auto-updater.js when the user clicks "Update now". Waits
# for Premiere to quit, then unzips the staged package over the extension folder.
# A shell script rather than Node: CEP runs an embedded V8, there is no `node` on
# PATH to spawn, and /bin/bash is on every Mac.
#
#   $1 staged package   $2 extension folder   $3 marker file   $4 log   $5 version
set -u
STAGED="${1:-}"; PLUGIN_DIR="${2:-}"; MARKER="${3:-}"
LOG="${4:-/tmp/ocha-quickvid-update.log}"; VERSION="${5:-}"
SKIP_WAIT="${OCHA_QUICKVID_UPDATE_SKIP_WAIT:-0}"   # test harness only

log() { printf "[%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG" 2>/dev/null; }
abort() {
  log "ABORT: $1"
  [ -n "$MARKER" ] && [ -d "$(dirname "$MARKER")" ] &&
    printf '{"error":"%s","at":"%s"}' "$1" "$(date '+%FT%T')" \
      > "$(dirname "$MARKER")/__pendingUpdate.error.json" 2>/dev/null
  exit 1
}

log "==== OCHA QuickVid update helper started (v${VERSION:-?}) ===="
[ -n "$STAGED" ] || abort "missing staged package argument"
[ -n "$PLUGIN_DIR" ] || abort "missing extension folder argument"
[ -f "$STAGED" ] || abort "staged package not found"
[ -d "$PLUGIN_DIR" ] || abort "extension folder not found"

# Never unzip over a folder that isn't ours — this runs unattended and overwrites.
[ -f "$PLUGIN_DIR/CSXS/manifest.xml" ] || abort "not a CEP extension (no CSXS/manifest.xml)"
grep -q "org.unocha.branding" "$PLUGIN_DIR/CSXS/manifest.xml" 2>/dev/null ||
  abort "not the OCHA QuickVid extension"

if [ "$SKIP_WAIT" = "1" ]; then
  log "SKIP_WAIT=1 - not waiting for Premiere (test mode)"
else
  log "Waiting for Premiere to quit..."
  WAITED=0; MAX=1800                      # 30 min cap so an abandoned helper dies
  while pgrep -x "Adobe Premiere Pro" > /dev/null 2>&1; do
    sleep 1; WAITED=$((WAITED + 1))
    [ "$WAITED" -ge "$MAX" ] && abort "timed out waiting for Premiere to quit"
  done
  log "Premiere exited after ${WAITED}s"
  sleep 2                                  # let the OS release file handles
fi

log "Extracting into $PLUGIN_DIR ..."
/usr/bin/unzip -oq "$STAGED" -d "$PLUGIN_DIR" 2>>"$LOG" || abort "unzip failed (see $LOG)"
log "Extraction complete."

rm -f "$STAGED" "$MARKER" 2>/dev/null
printf '{"version":"%s","appliedAt":"%s"}' "$VERSION" "$(date '+%FT%T')" \
  > "$(dirname "$MARKER")/__pendingUpdate.applied.json" 2>/dev/null
log "==== finished cleanly ===="
exit 0
