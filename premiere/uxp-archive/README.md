# UXP panel — ARCHIVED (reference only)

**Status: parked 2026-07-17.** The live plugin is CEP → [`../cep`](../cep).
Nothing here is loaded by Premiere any more. Kept because the findings are hard-won
and because this is the code we come back to **when Adobe exposes text params in
UXP** — at which point this is ~90% of a working plugin.

## Why we left UXP

The panel must manage every setting itself; users must never touch Essential
Graphics. **UXP cannot write MOGRT text controls**, so that requirement is
impossible on UXP today. Measured live in Premiere Beta 26.5 / UXP 9.3 — full
detail in [`../../docs/decisions.md`](../../docs/decisions.md).

CEP's ExtendScript has the one API UXP lacks:

```js
clip.getMGTComponent().properties[i].setValue("MARÍA GARCÍA", true);   // CEP only
```

## What actually works in UXP (don't re-derive this)

The capsule **is** reachable. An inserted MOGRT's track item exposes:

```
trackItem.getComponentChain() -> 3 components
  [0] AE.ADBE Opacity  — Opacity, Blend Mode
  [1] AE.ADBE Motion   — Position, Scale, Rotation, Anchor Point, Crop…
  [2] AE.ADBE Capsule  — "Graphic Parameters"  ← the Essential Graphics controls
        LT   0:Name 1:Title 2:Title line 2 3:Centre align 4:Size
        Loc  0:Place 1:Date 2:Pin colour 3:Show pin icon 4:Size
        End  0:Over black 1:Size
```

- **The capsule attaches a beat AFTER `insertMogrtFromPath` returns.** Probing
  immediately shows only Motion+Opacity — that single timing bug is what made us
  wrongly conclude the params were unreachable and burn days on value-baking.
  **Poll for `matchName === "AE.ADBE Capsule"`** (`findCapsule()` in `index.js`).
- Grab component/param handles **synchronously inside `project.lockedAccess`**;
  the handles stay valid for use in later `lockedAccess` calls.
- **Booleans and numbers set cleanly** — confirmed `Centre align = true`,
  `Size = 50`. Pattern: `createSetTimeVaryingAction(false)` (best-effort) →
  `createKeyframe(value)` → `createSetValueAction(kf, true)` inside
  `executeTransaction`. See `applyCapsuleValues()` / `setCapParam()`.
- **Text is impossible**: `areKeyframesSupported() === false`,
  `createKeyframe("str")` → *"Illegal Parameter type"*, `getStartValue()` → null
  (even after forcing `setTimeVarying(true)`), `getValueAtTime()` → "not supported
  for these value types", and `ComponentParam` has no string setter.
  `ppro.TextSegments` exists but is Transcript/caption-only (`ppro.Transcript.*`)
  and every JSON shape → "Not Enough Parameters".

Other UXP gotchas baked into this code:
- `[hidden]` isn't styled → panes toggle via classes (`.is-open`).
- Inline `<svg>` doesn't render → card icons are PNGs (`icons/el-*.png`).
- No `:checked` CSS → toggle state is JS-driven classes.
- `insertMogrtFromPath` does **not** auto-create tracks; an index one past the top
  throws "Invalid parameter" → track-index ladder `[vCount, vCount-1, 0]`.
- `Component.getParam()` may return a Promise on 26.x; `getStartValue()` is async.
- Premiere caches capsules by **`capsuleID`** *and* by **file path** — a rewritten
  temp file at the same path resolves to the first-ever cached content.

## The value-baking detour (dead end — do not retry without new evidence)

`rifx.js` + `tools/rifx_patch.py` patch a `.mogrt` in place:

```
capsule.mogrt (zip)
  └── project.aegraphic (zip)
        └── <name>.aep      RIFX, big-endian, XMP trailer AFTER the root
              Utf8[control GUID] → CTyp[type] → CVal/CDef (bool/f64/i32)
                                              → Utf8 value+default (text)
              + rendered text-engine strings:  "(" \xFE\xFF <UTF-16BE> ")"
```

The patcher is **correct** — validated three ways: byte-identical rebuild,
JS output byte-identical to the Python patcher, and **After Effects opens the
patched project and reads back the new text** (accents intact). Premiere still
renders the DEFAULTS, tested with a fresh `capsuleID`, a unique temp path,
randomized XMP DocumentID/InstanceIDs, and in a brand-new empty project.
Premiere resolves capsule instantiation from something the file doesn't control.

Still useful if you ever need to author/patch `.aep` or `.mogrt` files offline:

```bash
python3 tools/rifx_patch.py in.mogrt out.mogrt \
  '{"controls": {"<guid>": "MARÍA GARCÍA"}, "texts": {"NAME SURNAME": "MARÍA GARCÍA"}}'
```

## What carries over to CEP

- **`index.html` + `styles.css`** — the 2×2 card UI. CEP runs real Chromium, so it
  renders *better* there: inline SVG works, `:checked` works, no `[hidden]` quirk.
- **The capsule param order** (above) — same controls, same order in ExtendScript.
- **`premiere/mogrts`** — all 16 MOGRTs are unchanged and still the source of truth.
  (The bundled duplicate that lived in `./mogrts` was dropped from this archive;
  `make-ccx.sh` used to rsync it in.)
- The insert logic (format detect → playhead → top track) maps 1:1 onto
  ExtendScript's `sequence.importMGT()`.

## Reviving this

If Adobe ships text-param writing in UXP: restore this folder, load it in the UXP
Developer Tool (`manifest.json`), and the only change needed is putting the text
entries back into the `entries` array in `addElement()` — the plumbing
(`findCapsule` → `applyCapsuleValues` → `setCapParam`) already handles them.
Re-run the capsule probe first to confirm the param indices still match.

---
_Original panel: docked UXP panel that dropped the OCHA MOGRTs (lower third,
location, bug, ending) into a sequence, auto-picking the variant matching the
sequence format (9:16 / 4:5 / 1:1 / 16:9) so the user never chose among 16 files.
manifestVersion 5, host premierepro ≥ 25.6.0._
