#!/bin/bash
# Regenerate the Mac installer/starter .zip files from the .command files in
# this folder. Run this after editing either "Install QuickVid.command" or
# "Start QuickVid.command" — the .zip is what the web page actually links to.
#
# WHY THE ZIPS EXIST: a .command file downloaded straight over HTTP loses its
# executable bit (HTTP carries no Unix permissions), so double-clicking it in
# Finder fails with "you lack the necessary access privileges" — no amount of
# right-click -> Open works around THAT specific error (that trick only clears
# the separate Gatekeeper quarantine flag). A .zip's central directory stores
# the Unix mode, and macOS Archive Utility (including Safari's automatic
# "open safe downloads" unzip) restores it on extraction — verified by round-
# trip testing the exact browser-download path. See docs/decisions.md.
set -e
cd "$(dirname "$0")"
for name in "Install QuickVid" "Start QuickVid"; do
  chmod 755 "$name.command"
  rm -f "$name.zip"
  zip -q -X "$name.zip" "$name.command"
  echo "wrote $name.zip"
done
