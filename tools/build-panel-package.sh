#!/bin/bash
# ============================================================================
# Build the shareable OCHA QuickVid Premiere panel package.
#
#   bash tools/build-panel-package.sh
#
# Produces  premiere/cep/dist/ocha-quickvid-panel.zxp  — a plain zip of the
# panel WITH the MOGRTs bundled inside it. Two consumers:
#
#   1. A colleague installing for the first time (unzip into the CEP
#      extensions folder — see docs/PLUGIN_INSTALL.md).
#   2. The in-panel auto-updater, which downloads this exact file from GitHub
#      and unzips it over the installed folder after Premiere quits.
#
# WHY THE MOGRTS GO INSIDE: host.jsx looks for templates at
# <extension>/mogrts/... first and <extension>/../mogrts/... second. The second
# path only exists in a git checkout (this repo's layout). A colleague has just
# the extension folder, so the templates must travel INSIDE it or every "Add to
# timeline" fails with "MOGRT not found".
#
# The version comes from CSXS/manifest.xml, and the script refuses to build if
# manifest / version.json / main.js disagree — shipping a package whose version
# doesn't match version.json would make the updater offer it forever.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CEP="$ROOT/premiere/cep"
DIST="$CEP/dist"
OUT="$DIST/ocha-quickvid-panel.zxp"

manifest_v="$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$CEP/CSXS/manifest.xml" | head -1)"
version_v="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CEP/version.json" | head -1)"
panel_v="$(sed -n 's/.*PANEL_VERSION = "\([^"]*\)".*/\1/p' "$CEP/js/main.js" | head -1)"

echo "version — manifest:$manifest_v  version.json:$version_v  main.js:$panel_v"
if [ "$manifest_v" != "$version_v" ] || [ "$manifest_v" != "$panel_v" ]; then
  echo "REFUSING TO BUILD: the three version numbers disagree."
  echo "  They must match, or the updater will keep offering an update that never lands."
  exit 1
fi

rm -rf "$DIST"
mkdir -p "$DIST"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# The panel itself. dist/ is excluded so a rebuild never nests the previous
# package inside the new one. .debug MUST be excluded — it enables unsigned
# extension loading and must never travel inside a shipped/signed package (it is
# git-tracked as Javi's live-source DevTools setup, so exclude, don't delete).
rsync -a --exclude 'dist' --exclude '.DS_Store' --exclude '.debug' "$CEP/" "$STAGE/"

# The templates, bundled (see the note above).
mkdir -p "$STAGE/mogrts"
rsync -a --exclude '.DS_Store' "$ROOT/premiere/mogrts/" "$STAGE/mogrts/"

# --- package -----------------------------------------------------------------
# Sign the staged folder into a REAL .zxp when the signing config is present;
# otherwise fall back to a plain (unsigned) zip so the build still works for
# anyone without the cert. The config (cert path + password) lives in
# tools/sign.env, which is gitignored — no key or password enters this public
# repo. It reuses the shared OCHA BDU self-signed cert (same as the DataViz
# plugin), so the ZXP/UXP Installer accepts the file for a clean drag-drop
# install. (Self-signed still needs PlayerDebugMode to LOAD — see
# distribution/windows-setup.bat.)
SIGNED=0
[ -f "$ROOT/tools/sign.env" ] && . "$ROOT/tools/sign.env"
ZXPCMD="${QV_SIGN_ZXPCMD:-}"
CERT="${QV_SIGN_CERT:-}"
if [ -n "$CERT" ] && [ -f "$CERT" ] && [ -n "$ZXPCMD" ] && [ -x "$ZXPCMD" ]; then
  rm -f "$OUT"                                   # ZXPSignCmd won't overwrite
  "$ZXPCMD" -sign "$STAGE" "$OUT" "$CERT" "${QV_SIGN_PASS:-}" >/dev/null && SIGNED=1
fi
[ "$SIGNED" -eq 1 ] || ( cd "$STAGE" && zip -q -r -X "$OUT" . )

# Colleague-facing download folder (DataViz-style): keep the signed install file
# next to its guide + the Windows PlayerDebugMode helper, so BDU can share one
# folder that has everything.
DISTRIB="$ROOT/distribution"
mkdir -p "$DISTRIB"
cp "$OUT" "$DISTRIB/ocha-quickvid-panel.zxp"

n_mogrt="$(find "$STAGE/mogrts" -name '*.mogrt' | wc -l | tr -d ' ')"
echo "built $OUT"
echo "  version  : $manifest_v"
if [ "$SIGNED" -eq 1 ]; then
  echo "  signed   : yes"
  "$ZXPCMD" -verify "$OUT" 2>&1 | sed 's/^/  verify   : /'
else
  echo "  signed   : NO — unsigned zip (add tools/sign.env to sign)"
fi
echo "  size     : $(du -h "$OUT" | cut -f1)"
echo "  templates: $n_mogrt  (expected 24)"
echo "  copied   : distribution/ocha-quickvid-panel.zxp"
[ "$n_mogrt" -eq 24 ] || echo "  WARNING: expected 24 templates — run the AE builder?"
