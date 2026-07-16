# OCHA Branding for Premiere Pro

The OCHA branding elements (lower third, location strip, bug, ending) as
**native Premiere Pro assets**: MOGRTs generated from the same brand JSONs the
QuickVid engine renders from, plus (next phase) a UXP panel that drops them on
the timeline. For editors who work in Premiere; QuickVid stays the tool for
everyone else.

## Folders

- `ae/` — the After Effects **builder**.
  - `src/builder_template.jsx` — the logic (edit this, never the generated file).
  - `make_assets.py` — bakes `browser/brand-lt.json` + `brand-pin.json`, renders
    the logo PNGs from the SVG sources, converts `assets/pin_location.svg` into
    AE bezier data, and emits `build_ocha_mogrts.jsx`.
  - `build_ocha_mogrts.jsx` — **generated**, self-contained; run it in AE
    (File → Scripts → Run Script File…). Builds 4 comps × 4 formats with
    Essential Graphics controls and exports every `.mogrt`.
  - `assets/` — generated logo PNGs + the click sound (build output; the SVGs in
    the repo root stay the source of truth).
  - `build_log.txt` — written live by the script; first place to look when a
    build misbehaves.
- `mogrts/<format>/` — the exported `.mogrt` files (reels 9:16, feed45 4:5,
  square 1:1, event 16:9).

## The elements (what QC should check in AE)

| Comp | Controls (Essential Graphics) | Motion |
|---|---|---|
| OCHA Lower Third | Name, Title, Title line 2 (optional), Centre align | name wipes in (0.5s), title bar follows (+0.26s) with the settle pan; exit reverse. Bar hides when both titles are empty. |
| OCHA Location | Place, Date, Pin colour (Red/Blue), Show pin icon | pin scales from its bottom tip with the ~3% rebound; two cyan bands wipe in staggered; icon off → text shifts left. |
| OCHA Bug | Opacity | static; top-right at the format's safe margins. |
| OCHA Ending | Over black | logo SNAPS on at 0.3s (hold keys — never a fade) with the click sound; place it so it ends at the video's end. |

All timings/geometry come from `browser/brand-lt.json` and `browser/brand-pin.json`
— change the look there, re-run `make_assets.py`, re-run the AE script.
Intro/outro are **protected regions**: trimming the clip in Premiere stretches
the hold, not the animations. (Known approximation: AE's easy-ease at 66.7%
influence stands in for the engine's cubic ease — visually identical at these
durations. The `CAP_CENTER` constant in the template nudges text baselines;
tweak it if a line sits a hair off versus an engine render.)

## Regenerate everything

```bash
./.venv/bin/python premiere/ae/make_assets.py     # bake data + assets
# then run premiere/ae/build_ocha_mogrts.jsx inside After Effects
```

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
