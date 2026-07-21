#!/bin/bash
# OCHA QuickVid - doctor.
#
# READ-ONLY. Changes nothing; just prints what's installed, what's running and what
# GitHub says, so we can see WHY an install isn't updating. Run it and paste the
# whole output back to ochavisual@un.org.
#
#   bash <(curl -fsL https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/tools/qv-doctor.sh)

PORT="${QV_PORT:-17870}"
RAW="https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main"

echo "===== OCHA QuickVid doctor ====="
echo "when   : $(date)"
echo "macOS  : $(sw_vers -productVersion 2>/dev/null || echo '?')"
echo "user   : $(whoami)"
echo

echo "--- 1. where is it installed? ---"
HOMEFILE="$HOME/Library/Application Support/OCHA QuickVid/home"
QV=""
if [ -f "$HOMEFILE" ]; then
  QV="$(cat "$HOMEFILE" 2>/dev/null)"
  echo "registered path : $QV"
else
  echo "registered path : MISSING  ($HOMEFILE)"
  echo "                  -> the app has never been started from its folder, or it was moved."
fi

if [ -n "$QV" ] && [ -d "$QV" ]; then
  echo "folder exists   : yes (writable=$([ -w "$QV" ] && echo yes || echo NO))"
  echo "VERSION file    : $(cat "$QV/VERSION" 2>/dev/null || echo '(none)')"
  if [ -d "$QV/.git" ]; then
    echo "'.git' folder   : PRESENT  <-- self-update is deliberately SKIPPED for dev checkouts"
  else
    echo "'.git' folder   : no (good)"
  fi
  L="$QV/Start OCHA QuickVid.command"
  if [ -f "$L" ]; then
    echo "launcher size   : $(wc -c < "$L" | tr -d ' ') bytes (exec=$([ -x "$L" ] && echo yes || echo NO))"
    echo "launcher fixed  : $(awk '/# --- Self-update\./{u=NR} /^# Already running\?/{a=NR} END{ if(u&&a&&u<a) print "YES - update runs before the early exit"; else print "NO  - still the OLD launcher (this is the bug)" }' "$L")"
  else
    echo "launcher        : MISSING at $L"
  fi
else
  [ -n "$QV" ] && echo "folder exists   : NO  -> $QV"
fi
echo

echo "--- 2. other copies of the launcher on this Mac ---"
echo "(if you double-click one of THESE instead of the registered folder above, you'd"
echo " still be running an old copy)"
find "$HOME/Desktop" "$HOME/Downloads" "$HOME/Documents" "$HOME/Applications" \
     "$HOME/Library/Application Support/OCHA QuickVid" \
     -maxdepth 3 -name "Start OCHA QuickVid.command" 2>/dev/null \
  | while read -r f; do
      echo "  $(wc -c < "$f" | tr -d ' ') bytes  $f"
    done
echo

echo "--- 3. is the engine running? ---"
H="$(curl -s -m 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"
if [ -n "$H" ]; then
  echo "health : $H"
else
  echo "health : not responding on port $PORT (engine not running)"
fi
echo "pids   : $(lsof -ti tcp:"$PORT" 2>/dev/null | tr '\n' ' ')"
echo

echo "--- 4. can this Mac reach GitHub? ---"
R="$(curl -fsL -m 10 "$RAW/VERSION" 2>/dev/null | tr -d '[:space:]')"
if [ -n "$R" ]; then
  echo "latest published VERSION : $R"
else
  echo "latest published VERSION : COULD NOT REACH GitHub"
  echo "  -> office VPN/proxy or a firewall is blocking raw.githubusercontent.com."
  echo "     Nothing can auto-update until that host is reachable."
fi
echo

# The classic stranded install: the engine on disk is new, the RUNNING engine is
# old, because it was never restarted. Installers stop it now, but an install
# from before that fix leaves this exact mismatch — so name it explicitly.
echo "--- 5. is the RUNNING engine the one on disk? ---"
DISK_V="$(cat "$HOME/Library/Application Support/OCHA QuickVid/app/VERSION" 2>/dev/null || echo '?')"
LIVE_V="$(printf '%s' "$H" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
echo "on disk : $DISK_V"
echo "running : ${LIVE_V:-not running}"
if [ -n "$LIVE_V" ] && [ "$DISK_V" != "?" ] && [ "$LIVE_V" != "$DISK_V" ]; then
  echo "  -> MISMATCH. The engine is still running the old code from memory."
  echo "     Fix: quit it and start again, or re-run the install command —"
  echo "     it now stops the engine before replacing any files."
fi
echo
echo "If anything above looks wrong, the reset that fixes almost everything is:"
echo "  curl -fsSL $RAW/install.sh | bash -s -- --fresh"
echo "(keeps your projects and the speech model; rebuilds the Python setup)"
echo
echo "===== end - please paste everything above ====="
