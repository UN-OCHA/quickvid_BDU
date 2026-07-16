# OCHA Branding — Premiere UXP panel

A docked panel that drops the OCHA MOGRTs (lower third, location, bug, ending)
into a Premiere sequence, **auto-picking the variant that matches the sequence
format** (9:16 / 4:5 / 1:1 / 16:9) so the user never chooses among the 16 files.
The 16 `.mogrt`s are bundled in `mogrts/` (built by `../ae/make_assets.py` →
run in After Effects → committed under `../mogrts/`, then copied here).

Requires **Premiere Pro 25.6+** (the UXP DOM API this uses — `insertMogrtFromPath`,
`getFrameSize`, component params — is *Since 25.6*).

## Test it (no packaging) — UXP Developer Tool

1. Install **UXP Developer Tool** (UDT) from the Creative Cloud app (free).
2. Open UDT → **Add Plugin** → select `premiere/plugin/manifest.json`.
3. With Premiere open, click **Load** (the ••• menu → *Load*). The panel appears
   under **Window → Extensions → OCHA Branding** (or the panel picker).
4. Edit → reload from UDT to see changes instantly.

## Share it — package a `.ccx` (no Marketplace, no paid certificate)

UDT self-signs the package for free; double-clicking the `.ccx` installs it via
Creative Cloud — exactly the "send a file, they install it" flow we want:

1. In UDT, the plugin row → ••• menu → **Package**.
2. It writes `OCHA Branding.ccx`. Send that file.
3. Recipient double-clicks it → Creative Cloud installs it → the panel shows up
   in Premiere (25.6+). No Marketplace submission, no Adobe developer certificate.

(If you prefer a script, `make-ccx.sh` zips the folder as a starting point, but
UDT's **Package** is the sanctioned, install-on-double-click route.)

## Updating the graphics

The MOGRTs are the source of truth for the look. To change them:
1. Edit `../ae/src/builder_template.jsx`, run `../ae/make_assets.py`, run the
   generated `../ae/build_ocha_mogrts.jsx` in After Effects (rebuilds all 16).
2. `cp -R ../mogrts/. ./mogrts/` to refresh the bundled copies.
3. Reload / re-package.

## v1 status

- **Insert**: solid — detects the sequence format and inserts the matching MOGRT
  at the playhead on a fresh top video track (ending's click goes to a new audio
  track). This is the confirmed, reliable core.
- **Text autofill**: best-effort — after inserting, it matches the panel fields
  to the MOGRT's Essential Graphics controls by name and sets them in one undo
  step. If a name doesn't resolve on your Premiere build, the panel still inserts
  and tells you which controls it *did* see, so we can lock the mapping — then you
  finish the text in **Essential Graphics**.
- **Size / position / colour / toggles**: adjust per-video with the MOGRT's own
  **Size** slider + native **Effect Controls → Motion** (position) and the
  Essential Graphics controls (colour, alignment, over-black). The panel focuses
  on *insert + text*; everything else is one click in Premiere.

## Contacts
Maintained by **OCHA Brand and Design Unit (BDU)** — ochavisual@un.org · Javier Cueto (cuetoj@un.org)
