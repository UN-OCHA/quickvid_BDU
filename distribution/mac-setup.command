#!/bin/bash
# OCHA QuickVid - one-time Mac setup.
# Enables Adobe CEP "PlayerDebugMode" so the self-signed OCHA panel can load.
# Run once per computer (double-click). Safe to re-run.
echo "Enabling PlayerDebugMode for Adobe CEP (Premiere Pro)..."
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null
done
killall cfprefsd 2>/dev/null || true   # force the plist change to be re-read
echo "Done."
echo "Next: install ocha-quickvid-panel.zxp with the ZXP/UXP Installer,"
echo "then open Premiere Pro > Window > Extensions > OCHA QuickVid."
read -n 1 -s -r -p "Press any key to close."
echo
