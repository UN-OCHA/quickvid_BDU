# Decisions log

Decisions locked during the build, with the reasoning, so the next person
(or future me) doesn't relitigate them. Append-only.

## 2026-06-25 — Runtime: local web app
**Decision:** Build `app/` as a **local web app** — FastAPI backend on the Mac +
a static single-page browser UI — running on a Python 3.11 venv.
**Why:** reuses `engine/` with zero rewrite; 4K source files never leave the
machine (matters for senior-official footage / data residency); browser UI is
approachable for non-technical staff; packages into a desktop app (Tauri/
Electron, Node 20 present) later if the team wants a double-click install.
**Rejected:** packaged desktop app now (more build/signing work upfront, not
needed for v1); internal hosted web app (multi-GB 4K uploads + would need a UN
data-residency review). Confirmed with Javier.

## 2026-06-25 — Text & graphics: PNG layers, not `drawtext`
**Decision:** Render every text/graphic element (lower thirds, captions,
location title, ending text) as a **transparent PNG via Pillow**, composited
with ffmpeg `overlay`. Do not use the `drawtext` filter.
**Why:** (1) this Mac's ffmpeg has no libfreetype, so `drawtext` is unavailable;
(2) it's the better approach anyway — pixel-accurate OCHA fonts, one ffmpeg
binary instead of two, and each PNG maps 1:1 onto a **hideable Premiere XML
track**, which is exactly the layered-export model; (3) per-format re-layout
becomes "reposition the PNGs on a new canvas." See `environment.md`.

## 2026-06-25 — v1 target formats: all four
**Decision:** v1 layout templates cover **16:9, 9:16, 1:1, and 4:5**
(landscape master, vertical reels/stories, square feed, portrait feed). Seeded
in `brand/brand.json` → `formats`. Confirmed with Javier.

## 2026-06-25 — Scope v1 to "piece to camera" (PTC)
**Decision:** Target ONE content type first — the *piece to camera*: a single
speaker addressing the camera directly (USG remarks/statements), shot as one or
more sequential takes of the same talk, static framing, branded backdrop — the
common, high-volume USG format. More produced types (multi-shot field pieces,
B-roll, music, montage — see `references/videos/`, all short-form vertical/square
social pieces ~1 min) are OUT of scope for now and stay in Premiere. Revisit
whether some can follow the same workflow after PTC ships.
**Why:** PTC is the lowest-variance, most templatable video OCHA makes — its edit
decisions live in the *words*, exactly what the transcript model drives. It also
matches what's already built (ordered-concatenation cut engine, not multicam/
B-roll; branding set = logo, name strip, captions, ending). The complex pieces'
value is in visual/timeline choices the transcript can't express.
**Boundary rule:** edit lives in the words -> QuickVid; edit lives in the visuals/
timeline (B-roll, music, motion graphics, maps) -> Premiere. Confirmed with Javier.

## Brand assets — received 2026-06-25
OCHA blue **#009EDB**; font **Raleway** (name=Bold, title=Medium, caption=SemiBold;
installed at `/Library/Fonts/Raleway`); logo = **white vertical lockup**
(`assets/OCHA_logo_vertical_white.*`). All wired into `brand/brand.json`.

## 2026-06-25 — UI built on the OCHA Common Design System
`app/web/` uses the real design system, not an approximation: vendored
`tokens/brand.css` + component CSS (`cd-button`, `cd-card`, `cd-form`, `cd-alert`,
`cd-flow`, page/block titles) under `app/web/vendor/`; Roboto via Google Fonts
(Arial fallback offline); WCAG-AA tokens (`--brand-primary--text` #0077B8 for text
on white); no drop shadows. Status messages render as `cd-alert`. Header uses the
blue horizontal lockup with "QuickVid" as a separate product name (One OCHA rule).
`[hidden]{display:none!important}` is required — `cd-card` sets `display`, which
otherwise overrides the HTML `hidden` attribute. Re-vendor if the DS repo updates.

## 2026-07-05 — Titles & branding mode + standardized "OCHA app kit" tokens
Two things, confirmed with Javier:
- **Second mode** in the same local app: **"Titles & branding"** (add lower thirds
  + an ending to an already-edited video — CapCut/Canva/Premiere exports). Engine:
  `engine/finish.py` + `engine/lower_third.py` (resolution-independent, ported from
  the Venezuela build). Format-aware placement from the video's dimensions + social
  safe areas; **auto HDR→SDR** (imageio ffmpeg has zscale; Homebrew's doesn't) so
  OCHA blue stays correct; crisp SVG logo ending sized by frame height (~5.4%),
  rough cut (no fade), cuts 1.5s after the logo. Backend: `/api/pick-file`,
  `/api/finish`, `engine_bridge.finish`. UI: mode tabs (`Edit` | `Titles & branding`).
- **Standardized tokens.** `app/web/style.css` now opens with a documented **OCHA app
  kit** `:root` — short names (`--ocha-cyan` #009EDB, `--ocha-blue` #0077B8,
  `--ink`, `--muted`, `--line` #E2E5E8, `--bg`, `--card`, radii) matching the Photos
  metadata tool so BDU apps read as one system. Signature look: 8px cyan top bar,
  flat 10px hairline cards (no shadow), small UPPERCASE section headers, understated
  18–20px h1, cyan buttons (radius 7px). **This block is the seed to promote into the
  shared design system** (`…/OCHA_design_system`; its `tokens/brand.css` is the full
  `--cd-*` ramp — the short set is a clean app-facing subset). The vendored `cd-*`
  component CSS still loads under it; `style.css` (loaded last) overrides the look.
- **Static no-cache:** `NoCacheStatic` in `main.py` sends `Cache-Control: no-cache`
  so CSS/JS edits show on reload (a stale `style.css` cache wasted real time). The
  launch config has no `--reload`, so **restart the server for backend changes**.

## Still open
- Location pins (feature 3 of Titles & branding) — new SVG animation, same framework.
- Promote the `style.css` OCHA app kit token block into `…/OCHA_design_system` as the
  shared app starter, so new tools don't re-derive it.
- Confirm `name_navy` (#0A1E3F placeholder) for the name-strip text color.
- Crisp logo from SVG: `brew install librsvg` then rasterize (Quick Look flattens
  the white logo onto white). The PNG used now is identical at 70px height.
- Caption-vs-name-strip rule: suppress / lift captions while a lower-third is up.
