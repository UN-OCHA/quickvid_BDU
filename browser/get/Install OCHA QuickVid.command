#!/bin/bash
# ============================================================================
# OCHA QuickVid — one-time INSTALLER for Mac.
#
# NOT the path the web page offers any more: the page shows a copy-paste
# Terminal command instead, because a *downloaded* .command file trips macOS
# Gatekeeper ("unidentified developer") while a curl-piped script does not.
# This file is kept for anyone who still has it, and for offline use.
#
# It is deliberately a THIN WRAPPER around install.sh — the one real installer.
# It used to carry its own copy of the download/replace logic, which then missed
# fixes that landed in install.sh (notably: stopping the running engine before
# replacing its files, without which an "update" leaves the old version running).
# Keep it a wrapper.
#
# Running me again later = UPDATE OCHA QuickVid (your setup is kept, so it's quick).
# Add --fresh to also rebuild the Python environment from scratch.
# Questions: ochavisual@un.org
# ============================================================================
set -e
echo "OCHA QuickVid — fetching the installer…"
curl -fsSL "https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/install.sh" \
  | bash -s -- "$@"
