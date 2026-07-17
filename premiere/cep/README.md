# OCHA QuickVid — Premiere Pro panel

Docked panel that drops the OCHA branding MOGRTs (lower third, location, OCHA
logo, ending) into a sequence — **auto-picking the variant matching the
sequence format** (9:16 / 4:5 / 1:1 / 16:9) and **applying every setting from
the panel**: name, titles, centre align, place, date, pin colour, pin icon,
over black, plus **Size & Position** (via the clip's Motion). Users never open
Essential Graphics.

Look & feel matches the OCHA DataViz plugin (shared tokens, Roboto, light/dark
toggle). On insert, each `.mogrt` is copied into a folder next to the .prproj —
**"OCHA Branding Elements - do not delete"** — so the graphic's template travels
with the project and survives an extension uninstall or a moved repo.

Built on CEP because its ExtendScript API can write MOGRT text controls
(`clip.getMGTComponent().properties[i].setValue(str, true)`), which UXP cannot —
measured findings in [`../../docs/decisions.md`](../../docs/decisions.md), the
parked UXP panel in [`../uxp-archive`](../uxp-archive).

## Layout

- `CSXS/manifest.xml` — extension manifest (id `org.unocha.branding`, host PPRO ≥ 14).
- `index.html` + `styles.css` — the panel (2×2 element cards → per-element fields → Add).
- `js/main.js` — panel logic; talks to the host via `evalScript`. User text is
  embedded with `JSON.stringify` (safe for quotes/unicode) and values cross as a
  `\u001E`/`\u001F`-delimited blob (untypeable control chars).
- `jsx/host.jsx` — ExtendScript (ES3: `var` only, no arrows/JSON): format detect,
  MOGRT path resolve, `seq.importMGT(path, ticks, vTrack, aTrack)` with a
  track ladder, poll `getMGTComponent()` (it can attach a beat after insert),
  `setValue` each control, select the clip.
- MOGRTs resolve from `<ext>/mogrts/…` (bundled, future ZXP) with fallback to
  `<ext>/../mogrts/…` (this repo's canonical `premiere/mogrts` via the dev symlink).

## Dev install (this Mac)

Symlinked, so edits are live — close/reopen the panel to reload HTML+JSX;
restart Premiere only when `manifest.xml` changes:

```bash
ln -s "$(pwd)/premiere/cep" \
  "$HOME/Library/Application Support/Adobe/CEP/extensions/org.unocha.branding"
```

Unsigned extensions load because PlayerDebugMode is on
(`defaults write com.adobe.CSXS.<v> PlayerDebugMode 1`, set for 9–14).
Open via **Window ▸ Extensions ▸ OCHA Branding**.

## Distribution (later)

Self-signed **ZXP** — free, no Marketplace, no paid certificate; same release
path as the Illustrator DataViz tool (`ocha-dataviz-release` skill). Bundle the
`mogrts/` folder inside the extension before packaging.

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
