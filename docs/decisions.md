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

## 2026-07-09 — Captions + animated lower third + OCHA logo-click ending (social branding)
**Decision:** Lock the recipe for social captioning + branding of a **finished** clip (from the
USG Tom Fletcher Venezuela job — Spanish captions + bilingual lower third) and generalize it into a
config-driven renderer + a reusable skill.
**What it produces:** social subtitles (Raleway Medium, white on `#3F3F3F` @0.75, 16px rounded box,
centred, ~44px on a 1080 canvas) + an animated bilingual lower third + OCHA-logo-over-black ending
with the OCHA logo-click sound. Worked example lives in `temp/usg_es/` (`render.py` + `USG_es_FULL.mp4`).
Generalized, config-driven engine + playbook: **`~/.claude/skills/ocha-social-subtitles/`**
(`scripts/render_social_video.py` reads a `job.json`; `scripts/transcribe.py` scaffolds cue timings).
**Locked rules:**
- Captions **hard-cut, no fade** — overlay `enable='gte(t,s)*lt(t,e)'` (half-open interval, instant swap).
- Captions **lift** to a higher row while a lower third is on screen, standard position otherwise —
  *this resolves the "caption-vs-name-strip" open item that used to sit below.*
- Lower-third motion = `engine/lower_third.py` (no fade; left-anchored wipe reveal; NAME first, ORG
  follows + pans; reverse exit; cubic ease-in-out). Rendered as a **PNG sequence** — ffmpeg `enable=`
  can only hard-cut, so a static overlay cannot animate. Extended to 1–2 org lines (bilingual) + centre/left.
- Ending = OCHA logo **snaps** onto black (no fade) and holds; the OCHA logo-click sound
  (`brand.json → ending.asset` = "OCHA Logo click.mov", click peak @0.30s) mixed so its peak lands on
  the snap-on: `atrim=0:0.7`, `adelay=(footage_end−0.30)·1000`, `amix inputs=2:duration=first:normalize=0`
  (normalize=0 keeps speech at full level). **No caption under the logo** (all cues end by `footage_end`).
- Fonts = **Raleway via cairosvg + fontconfig** — `font-family="Raleway"` + weight (700=Bold, 500=Medium);
  verified by matching cairosvg glyph widths to the TTF metrics (no `@font-face` needed).
- Punctuation: cues are running-speech fragments → **capital after a sentence-ending `.`/`?`/`!`**
  (Spanish `y…` → `Y…` is the common trap).
**Why a script + skill, not (yet) a QuickVid mode:** the captioning UI/flow isn't in the app; this is the
proven engine to fold into a future QuickVid "Subtitles" capability. Confirmed with Javier.

## 2026-07-10 — Statement clips become a QuickVid Edit video type (self-service)
**Decision:** The "statement clip" pipeline (SC / member-states briefings, PTC video
messages) is now **in the tool**, not a Claude-only workflow. Edit tab → "Statement
clip" wizard (full mode only): UN Web TV link or file → lip-sync check (offset chips
+ 5s previews) → windowed Whisper transcribe → tick-the-sentences (auto punch-in
plan) → format/framing (destination presets + subject sliders + live crop stills) →
branding (LT, captions on/off, ending) → render + thumbnail picker.
**Engine:** `engine/webtv.py` (Kaltura resolve → finished-MP4, or same-day live-HLS
fallback with the "ina"/Interlingua floor track), `engine/social_brand.py` (library
port of the ocha-social-subtitles renderer: boxed vs event-gradient captions,
bilingual LT, SVG-rasterized logo ending over footage/black + click at the snap),
`engine/statement.py` (sync bake, windowed transcribe, punch-in cut builder,
presets, stills). API: `/api/statement/*` on the engine server, same job pattern.
**The craft encoded:** shots toggle close↔general only across a GAP between kept
sentences (a real cut needs hiding; contiguous = one take); cues auto-split >7s at
word boundaries; sentence-case enforced across cues; ending bed = 2.6s of footage
after the last word (falls back to over_black if the tail is too short); no fades.
**Division of labour:** the tool covers the standard case; Claude stays for
translation (e.g. UN Spanish captions), bespoke editorial work, room-cutaway
inserts, and the 4-folder packaged hand-off. Confirmed with Javier ("Do it!").

## 2026-07-10 — Statement wizard: job folder + in-app scrubber (test feedback)
From Javi testing the Edit tab:
- **Pick a job folder on step 1.** The download saves into `<folder>/source/`, the
  finished clip into `<folder>/export/` (named `<folder>_<canvas>.mp4`), the thumbnail
  into `export/`, and `info/script.txt` + `segments_selected.json` + a root `README.md`
  are written — the standard OCHA 4-folder job structure, realised in the tool. No
  folder picked → falls back to the hidden `app/workspace` (unchanged). Plumbed via a
  `dir` field on download/render + `dir` query on the still endpoint; `_job_dirs()` in
  `engine_bridge`. Uses the existing native `/api/pick-folder` (now takes a `prompt`).
- **In-app scrubber** on "Find the words": the full recording streams from
  `GET /api/statement/file?src=…` (Starlette `FileResponse` is range-enabled → the
  browser seeks without downloading the whole file), so the user finds *when the
  speaker talks* without leaving the app. **Set "From"/"To"** buttons read the
  scrubber's current time into the window.
- **Compact time selector** — From/To are now the `.timefield` mm:ss steppers (arrows
  ±15s), not full-width boxes.
- **Footer reworded + mode-aware** — no longer implies a separate "Mac app"; it says
  the full editor runs *in this same page* once ffmpeg + Python are installed, and it's
  hidden entirely once the engine is connected (`body.is-full .footer-unlock`).

## 2026-07-12 — QuickVid Lite/Full naming + Windows-ready engine
- **Chip renamed** (Javier's call): "QuickVid Lite — runs in your browser" vs
  "QuickVid Full — engine connected, no limits". One page, two power levels; no
  separate apps.
- **Windows engine shipped** (untested on real hardware yet — needs one UN laptop):
  - `Start QuickVid.bat` mirrors the Mac launcher: user-space Python check
    (3.9–3.13 via `py`/`python`), venv, pip, portable ffmpeg via static-ffmpeg,
    Whisper prefetch, launch on 127.0.0.1:17870. ASCII-only, quoted paths.
  - `settings._adopt_static_ffmpeg`: symlink→**copy** fallback (Windows symlinks
    need admin) and `.exe`-aware names; verified by simulating symlink failure.
  - Pickers: darwin keeps AppleScript; elsewhere a **tkinter dialog in a
    subprocess** (tkinter must own its main thread or it wedges uvicorn).
  - `engine_bridge._run`: forced UTF-8 both directions (`encoding="utf-8"` +
    `PYTHONIOENCODING`) — Windows cp1252 would mangle engine output.
  - Fonts need NO install on Windows: engine measures/renders from the bundled
    TTFs (svgpng.font_path + resvg font_dirs); cairosvg simply isn't importable
    there → resvg path always.
  - E0 card is **OS-aware**: auto-detects from the user agent, manual Mac|Windows
    toggle; SmartScreen ("More info → Run anyway") documented as the Windows
    Gatekeeper-equivalent. README got a matching Windows quick start.
  - Engine code audit: no filter-embedded paths (all media via `-i`), no manual
    "/" joins, no unix-only runtime paths beyond the guarded Homebrew candidates.

## 2026-07-12 — Published (Javier's explicit go)
- Repo: **github.com/UN-OCHA/quickvid_BDU** (public). Web app on Pages:
  **https://un-ocha.github.io/quickvid_BDU/** (Actions workflow deploys `browser/`
  on every push to main).
- Pre-publish pass: `video_editing/` + `temp/` added to .gitignore (real footage
  stays local); secret scan clean; staged tree 2.6 MB.
- **Click sound now ships**: the ending's click lived in gitignored `references/`
  as a 25 MB ProRes — fresh clones would have rendered silent endings. Extracted
  the audio losslessly to `brand/OCHA_logo_click.wav` (284 KB) and repointed
  brand.json; render-verified.
- **Load-race fix found on the live page**: with the engine already running, the
  hosted page detected it BEFORE statement.js loaded → the unlock callback hit the
  typeof-guard and Edit stayed locked until reload. statement.js now self-syncs
  (`stModeChanged(state.mode === "full")`) at the end of its load.
- Verified live: the HTTPS page at un-ocha.github.io detects the local engine
  (CORS + Private-Network-Access working as designed).

## 2026-07-12 — Zero-admin onboarding (fresh-Mac colleagues)
Goal: a colleague with a brand-new Mac gets from the web page to a working Edit
tab with no admin password, no Homebrew, and honest warnings about the scary bits.
- **No more Homebrew requirement.** ffmpeg resolution order (settings.py):
  Homebrew → previously-adopted portable → PATH → fetch `static-ffmpeg` (pip,
  user-space) and symlink ffmpeg+ffprobe into `.venv/bin`. The symlink location
  matters: engine code derives ffprobe by replacing "ffmpeg" in the path, and the
  static package's own dir (`static_ffmpeg/bin/…`) would corrupt under that
  replace. Verified: the portable build has pcm_s24be + VideoToolbox (the two
  things imageio's minimal build lacked).
- **SVG rasterization without Homebrew's cairo**: new `engine/svgpng.py` shim —
  cairosvg when importable (pixel-identical, this Mac), else `resvg_py`
  (self-contained Rust wheel) with the bundled fonts. Side-by-side render check:
  LT strips identical, logo within 2px rounding (overlay code reads actual PNG
  size, so it self-corrects). Full statement render passed with cairo blocked +
  portable ffmpeg forced ("fresh Mac" simulation).
- **Fonts ship with the app**: `engine/assets/fonts/` (Raleway Medium/SemiBold/
  Bold/Regular + OFL license). `svgpng.font_path()` resolves bundled-first, so
  every machine measures AND renders with the same TTF; the launcher also copies
  them to ~/Library/Fonts (user-space) for the cairosvg-present-but-no-Raleway
  case. Hardcoded /Library/Fonts paths removed from social_brand + lower_third.
- **Launcher (`Start QuickVid.command`)**: port fixed 8000→17870 (the app pings
  17870 — a colleague following instructions would have installed everything and
  still seen a locked tab); opens 127.0.0.1 not localhost (canonical origin);
  picks python3.9–3.13 (3.14 has no faster-whisper wheels); pre-fetches the
  portable ffmpeg and the ~500 MB Whisper model with honest "one-time" messages.
- **Guided install in the app**: the locked Edit tab is now a 3-step card —
  Download button → right-click→Open (the "unidentified developer" warning
  explained as normal) → "come back here". app.js polls /api/health every 4 s in
  browser mode so the tab **unlocks by itself** when setup finishes (verified
  live: page flipped to full mode within one poll tick, no reload). Footer
  points at the Edit tab; Windows honesty note included. README rewritten to
  match ("The full tool on your Mac").

## 2026-07-11 — Pre-user-test hardening (colleague tests Monday)
Full copy review + a per-step help system, then a real end-to-end run of the app.
- **Step help (?)**: new kit component `.cd-help__btn`/`.cd-help__panel` (App Kit v0.1.1,
  synced; Storybook handoff h4 pending). Every step on both tabs (3 Titles + 8 Edit) has a
  round ? that toggles a plain-language explainer written for a first-time user — incl. the
  "meeting's own page, NOT the 24/7 channel" warning on the recording step.
- **apps.json fix**: the kit registry still pointed at the retired `app/web/vendor/` copy;
  syncs never reached the live `browser/vendor/`. Retargeted.
- **Canonical host**: `localhost` and `127.0.0.1` are different origins → autosave written
  on one is invisible on the other (found when resume "vanished" mid-test). app.js now
  redirects localhost → 127.0.0.1 on load. Folder-based resume covered the gap as designed.
- **Sentence list keeps its scroll** when ticking (it re-renders on every change and yanked
  the user back to the top of 31 rows).
- **E2E result** (real Ukraine master, 27:56–30:30 window): 31 sentences transcribed; 12
  ticked (0:57); caption edit + forced close-up honoured; punch-in verified across the gap;
  Raleway boxed captions + centered bilingual-capable LT + logo-over-footage ending with
  click all frame-checked; export/ + info/script.txt + README + thumbnail 1080×1920 all
  written to the job folder. Render of the 60s reel took ~16 s.

## 2026-07-10 — Statement wizard: autosave & resume
Two complementary layers, same JSON snapshot of the wizard state (type, folder, source,
sync offset, ranges, transcript+selections+shot choices, framing, preset, titles, ending,
captions):
- **Browser localStorage** (`quickvid.project.v1`) — debounced autosave on every change +
  `pagehide`. On load, once the engine connects, a **resume banner** offers "Pick up where
  you left off?" and auto-switches to the Edit tab. Instant refresh/crash recovery, no engine
  roundtrip.
- **`<job folder>/quickvid-project.json`** — mirrored on each save when a folder is set (via
  `POST/GET /api/statement/save-project|load-project`). Durable + portable; picking a folder
  that already holds a project offers to reopen it.
- **Never clobber a real save with an empty one** — `stSaveNow`/`pagehide` write only when the
  snapshot `stWorthResuming` (has src/segments/jobDir). This was a real bug: refresh-without-
  resuming would otherwise overwrite the good save with a blank one and lose the project.
- The source **video** is referenced by path, not embedded (too big) — it lives in `source/`,
  so folder + project.json travel together. Restore assumes the file still exists at its path.

## 2026-07-10 — Statement wizard: multiple windows + framing/label polish (test round 2)
- **Multiple transcription windows.** "Find the words" is now a list of `[from,to]`
  ranges (add/remove rows, or "Set From/To" from the scrubber) — for a principal who
  speaks in more than one block. `do_transcribe` loops the windows, keeps timestamps
  absolute (`w.start + start`), then sorts + re-ids into one timeline list. Wire:
  `ranges` on the transcribe req; back-compat single `start/end` preserved. Proven with
  real `say` speech: windows `[11,17],[1,7]` → 2 segments at 2.44s & 12.54s, ordered.
- **"Try another frame"** on step 6 — the framing preview defaults to the first kept
  sentence; the button jumps to a random point in a random kept sentence, so a wide/
  in-between opening shot isn't the only crop reference. Resets on selection change.
- **Preset label** "Reels / TikTok" → **"Reels"**.
- **Title-field bug fixed.** The kit's `.field-row .cd-form__input{flex:1 1 18rem}`
  set an 18rem *flex-basis*, which became input **height** (288px!) inside our
  `flex-direction:column` labels. Fixed with `.field-row label .cd-form__input{flex:0 0 auto}`.

## 2026-07-10 — UN Web TV downloader hardening (`engine/webtv.py`)
Learned from real failures on live / just-ended events:
- **Live HLS muxes audio into the video** (no separate `#EXT-X-MEDIA:TYPE=AUDIO`
  track like a VOD). `_hls_urls` now returns `audio_url=None` for that shape (and
  for a master that's already a media playlist); `_download_hls` then pulls a
  single input instead of mapping a non-existent audio track. VOD path (separate
  floor audio → mux) unchanged.
- **Reject 0-width MP4 flavors** — a rolling/live channel entry advertises a
  placeholder flavor (e.g. `0x540`) that downloads broken. The finished-MP4 picker
  now requires width>0 *and* height>0.
- **24/7 live-channel guard** — the "24 Hour Live and pre-recorded Programming"
  page isn't a meeting (≈30s DVR of whatever's on air). The CLI detects it by name
  and exits with a clean `ERROR:` telling the user to open the meeting's own page;
  `engine_bridge._run` surfaces that message verbatim in the UI.
- No server restart for any of this — `webtv.py` runs as a subprocess per job.

## Still open
- Location pins (feature 3 of Titles & branding) — new SVG animation, same framework.
- Promote the `style.css` OCHA app kit token block into `…/OCHA_design_system` as the
  shared app starter, so new tools don't re-derive it.
- Confirm `name_navy` (#0A1E3F placeholder) for the name-strip text color.
- Crisp logo from SVG: `brew install librsvg` then rasterize (Quick Look flattens
  the white logo onto white). The PNG used now is identical at 70px height.
- ~~Caption-vs-name-strip rule~~ — **resolved 2026-07-09** (captions lift while a lower
  third is up; see the social-branding entry above).
