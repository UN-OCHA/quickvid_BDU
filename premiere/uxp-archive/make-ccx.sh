#!/bin/bash
# Zip this plugin folder into OCHA-Branding.ccx (manifest.json at the archive root).
# NOTE: UDT's "Package" button is the sanctioned way to make an install-on-double-click
# .ccx (it self-signs, free). This zip is a convenience/starting point — some Creative
# Cloud versions require the signed UDT package to install via double-click.
set -e
cd "$(dirname "$0")"
OUT="OCHA-Branding.ccx"
rm -f "$OUT"
# always package the freshest MOGRTs (canonical copies live in ../mogrts)
rsync -a --delete ../mogrts/ ./mogrts/ 2>/dev/null || cp -R ../mogrts/. ./mogrts/
# exclude VCS noise + the output itself; keep manifest at root
zip -rq -X "$OUT" manifest.json index.html index.js styles.css icons mogrts \
  -x '*.DS_Store'
echo "wrote $(pwd)/$OUT ($(du -h "$OUT" | cut -f1))"
echo "To install: double-click it (Creative Cloud) — or share it. Prefer UDT → Package for a signed build."
