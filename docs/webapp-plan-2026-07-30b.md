# QuickVid web app — feedback round 2 (2026-07-30)

14 items. Standing instruction for all of them: **both tabs, Mac and Windows.**
Nothing below is built yet. Where I've already found the cause, it says *Found*.

---

## Grouped by what they actually are

**A. Two real bugs I can already name** — 11, 6
**B. Straightforward build** — 1, 2, 3, 5, 10, 14
**C. Layout pass** — 4, 5
**D. One big feature wearing three hats** — 7, 9, 12
**E. Your call** — 8, 13

---

## 11. Ending logo not vertically centred — **FOUND, real**

There are **two implementations of the same thing, and they disagree**:

| Path | Where | Vertical position |
|---|---|---|
| Titles tab + `over_black` | `engine/ending.py:116` | `(H - lh) // 2` — exact centre |
| Edit tab `over_footage` | `engine/social_brand.py:419` | `H × 0.58` — **below centre** |

On a 1080×1920 reel that is **1114px vs 960px — 154px low**, which is exactly what
you're seeing, and why it looks wrong in reels most of all. The comment says
"below the face, above the caption zone", so 0.58 was deliberate once; it now
contradicts the standing ending spec (*modest, centred, over footage*).

**Propose:** default `logo_y_frac` to 0.5 so both paths agree, and check the logo
SVG has no padding skewing it (measured: it doesn't — ink fills the viewBox edge
to edge, so centring the PNG centres the artwork).

---

## 6. Framing sliders — **FOUND, one cause behind three complaints**

`stFrameHint()` (statement.js:499) writes a message under each slider that appears
and vanishes depending on whether the crop is locked to the frame edge:

> "Full height in use — drag sideways; zoom in to move up/down."

That is your "message below each slider that disappears at some point", and you're
right that it doesn't read clearly. Removing it also removes the height jump.

The **slider changing size** is a second, related thing: the slider is
`flex: 1 1 auto` inside a row as wide as the still above it, so switching format
(reels 9:16 → event 16:9) makes the image much wider and the slider with it.

**Propose:**
- Delete the hint entirely (you asked, and it's the cause of the jumping).
- Fix the frame figures to a stable grid column so the sliders stop resizing.
- **Stepped zoom** instead of free movement: `step` on the range, snapping to
  1.0 / 1.25 / 1.5 / 1.75 / 2.0 with tick marks, so it can't be nudged to 1.03.
- **Drag affordance:** a hand cursor plus a brief FA `fa-hand-pointer` badge over
  each still on first show, fading after ~3s (and again whenever the shot changes).

---

## 14. Windows icon — **half-found, needs one test on Windows**

- The icon file exists and is a **valid multi-size Windows resource** (7 sizes,
  16px → 256px). Not the problem.
- `assets/` ships: the installer pulls the whole repo zip.
- The shortcut sets `$s.IconLocation = $ico`. The documented form is
  **`"<path>,0"`** — an index is expected, and without it Windows quietly falls
  back to the target's icon, which for a `.bat` is the console icon. That matches
  your screenshot exactly.

**Propose:** set `"$ico,0"`, and refresh the icon cache after creating the
shortcut. **Note:** an existing install won't change until the installer is re-run
— the `.lnk` is only written at install time.

---

## 1. Picked file gets copied into `source/`

Right now the source can live anywhere and the project just records the path.

**Propose:** on pick, copy the file into `<job>/source/` and use that copy. Both
tabs. Specifics:
- **Copy, never move** — the user's original is never touched.
- A **progress bar**: these are multi-GB files, and a silent 40-second freeze
  reads as a crash (the same lesson as the sync bake).
- **Skip the copy if the file is already inside the job folder** (re-opening a
  project must not copy it again).
- Windows: same-volume copies are fast, cross-volume are not — hence the bar.

---

## 2. Magnifier on the Look previews

**Propose:** an FA `fa-magnifying-glass-plus` button on each look card, opening the
still large in a modal. Cheap — the endpoint already takes a `width`.

---

## 3. Waiting messages

**Propose:** rotate a short line every ~8s under the progress bar during
transcription and rendering, e.g. *"Good time for a coffee."* / *"This one takes a
few minutes."* / *"Still going — nothing has gone wrong."*
Dry and calm, never jokey. **Only on the long steps** (transcribe, render, bake) —
never on an error, and never on anything under ~10s.

---

## 4 + 5. Layout pass

**5 — Format cards.** Four `.end-opt` cards in a `flex-wrap` row with
`flex: 1 1 12rem`, so Event ends up alone on a full-width second line.
**Propose:** a real grid, `repeat(auto-fit, minmax(11rem, 1fr))` → 4-up wide,
**2×2** when it doesn't fit, never one stranded card. Plus an FA shape icon each:
reels `fa-rectangle-vertical`, square `fa-square`, feed 4:5
`fa-rectangle-vertical`, event `fa-rectangle-wide`.

**4 — Loose elements.** Confirmed: "Translate to English" is a bare `st-check`
floating under the range rows, and step 1's project name / choose folder / open
folder are separate rows rather than one grid. **Propose:** sweep every step,
put each cluster in an `.opt-grid` / grid with `gap`, no stacked margins. I'll
list what I changed rather than describe it up front — it's a look-at-it job.

---

## 7 + 9 + 12. Preview over the real footage — **one feature, not three**

All three ask the same thing: *show me this element on a real frame of my video.*
7 = lower third, 9 = subtitles / OCHA logo / text on screen, 12 = the ending logo
(plus a vertical slider).

There are two ways to build it, and the difference matters:

| | How | Risk |
|---|---|---|
| **Fake it** | Redraw the LT/captions in HTML+CSS over a still | Fast, but it is a *second* implementation of the brand. It WILL drift from the render — that is precisely the bug class we keep hitting (`brand-lt.json` exists because of it). |
| **Render it** | Run the REAL overlay graph for **one frame** | One graph, one truth — the preview cannot lie. More work, and the graph has many time-shifted overlays to get right. |

**I recommend rendering it**, and doing 7, 9 and 12 as one endpoint
(`/api/statement/brand-preview?t=…`) that every section calls with different
elements switched on. It is the largest piece in this list — but three CSS
mock-ups of the OCHA brand is exactly the thing your own standing rules forbid.

**Live update as you type the name:** yes, but debounced (~400ms) and cancellable,
same as the Look preview. If it feels heavy I'll drop it to a "Preview" button —
your instinct not to add bug surface is right.

**12's vertical slider:** `logo_y_frac` already exists in the spec and is already
plumbed through — the slider is genuinely small once the preview exists.

---

## 8. Force two-line subtitles — **your call**

Today the renderer wraps to a **two-line budget** and splits anything longer; a
short cue merges forward only if it fits. So one-liners happen when a sentence is
simply short.

**Could do:** raise the merge threshold so a short cue pulls the next one in more
eagerly, aiming for two full lines.
**Cost, honestly:** merging joins cues across sentence boundaries, so it can put
the end of one sentence and the start of the next in one box, and it shifts
timing. It trades a cosmetic inconsistency for a comprehension risk.

**My recommendation: don't force it.** Instead make it *visible* — the caption
editor now shows the real two-line shape, so you can merge the ones you want by
hand where it reads better. Happy to do it if you disagree.

---

## 13. Analytics — **my recommendation: the sheet, not Google Analytics**

- QuickVid's whole promise is **"your video never leaves the machine."** Adding a
  Google beacon to it is a promise you'd then have to qualify, and it would need a
  privacy/consent line in the UI.
- You **already have the pattern**: the DataViz and QuickVid *plugins* both ping an
  Apps Script web app you own, and there's already a dashboard reading it.
- One sheet, one dashboard, one story for both plugins and the web app — versus a
  second, third-party system that only covers the web app.

**Propose:** a `webapp` tab on the existing QuickVid analytics sheet, pinging on
engine start with version + OS + a random install id. No video data, no filenames,
no paths. Opt-out in Extra settings.

---

## Suggested order

1. **11** (ending logo centre) — a one-line default, and it's shipping wrong today.
2. **14** (Windows icon) — one-line fix, needs a reinstall to confirm.
3. **6** (framing sliders) — removes three complaints at once.
4. **5 + 4** (layout pass) — visible everywhere, low risk.
5. **1** (copy source into the folder) — real robustness win.
6. **2 + 3 + 10** (magnifier, waiting lines, Open folder CTA) — quick.
7. **7 + 9 + 12** (real preview) — the big one, on its own.
8. **13** (analytics) — after you pick the route.
9. **8** — only if you want it.
