# Decisions log

Decisions locked during the build, with the reasoning, so the next person
(or future me) doesn't relitigate them. Append-only.

## 2026-07-16 — Engine crashed on Python 3.9 / PEP 604 unions (v0.6.2)
Surfaced BY the v0.6.1 fix: a colleague's launcher now printed the real
traceback instead of a false success — `TypeError: unsupported operand
type(s) for |: 'type' and 'NoneType'` at `app/backend/jobs.py:32`,
`def get(jid: str) -> Job | None:`.
**Root cause:** `X | None` (PEP 604) is Python **3.10+**; it's evaluated when
the `def` runs, so it crashes at import on 3.9. The **stock macOS Command Line
Tools Python is 3.9** (`/Library/Developer/CommandLineTools/.../3.9`), and the
Start script deliberately accepts 3.9–3.13 — so the engine MUST run on 3.9.
Reproduced exactly on this Mac's `/usr/bin/python3` (also 3.9).
**Fix:** `Optional[...]` from `typing` (bulletproof — evaluates on every
version and survives `get_type_hints`) in the two spots that had it: jobs.py
(return type + the `percent` field) and webtv.py (`aurl`, which was quoted so
merely latent). Chose explicit `Optional` over `from __future__ import
annotations` so it can't be re-broken by anything that introspects the hints
at runtime (Pydantic, FastAPI). Verified: the exact crash reproduced then
gone; all 17 backend/engine files compile on 3.9; grep confirms no remaining
unquoted `|` unions; and a full `import app.backend.main` in a fresh 3.9 venv
loads clean.
**Propagation (contrast with 0.6.1):** this fix IS in the engine code, which
self-update mirrors — it is NOT the excluded Start script. So a colleague on
0.6.1 only needs to **launch again**: the Start script self-updates the engine
(pulling fixed jobs.py) before starting uvicorn, and it comes up. No re-install
needed this time.
**Standing guard:** keep engine code 3.9-clean. No `X | Y` unions in evaluated
positions, no `match`/`case`. (`list[...]`/`dict[...]` annotations are fine on
3.9.) When in doubt, `/usr/bin/python3 -m py_compile` + a real import on 3.9.

## 2026-07-16 — Start script declared success without checking (v0.6.1)
A colleague's install ran to completion — Python, ffmpeg, font, Whisper model
all fine, ending in "OCHA QuickVid is running in the background — you can
CLOSE this window" — then the browser hit `ERR_CONNECTION_REFUSED` /
"Can't Connect to the Server" on 127.0.0.1:17870.
**Root cause:** the `QV_DETACH` branch (used by both platforms' installer/
starter and the Mac `.app` launcher) backgrounded uvicorn, slept a **blind
2 seconds**, then unconditionally opened the browser and printed success —
with no check that the server actually came up. A cold start slower than 2s,
or an outright crash on import, both looked identical from the script's
point of view: silence, followed by a lie.
**Fix:** replace the blind sleep with a real poll of `/api/health` (Mac:
0.5s steps up to ~20s, with an early exit via `kill -0` if the process died;
Windows: 1s steps up to ~20s via curl, since batch has no cheap PID-liveness
check). If it never comes up, the script now prints the last 25 lines of
`engine.log` directly in the terminal (`tail -n 25` / PowerShell
`Get-Content -Tail 25`) instead of declaring victory — self-diagnosing
instead of needing a follow-up round-trip to ask "can you check the log."
Verified with two isolated bash harnesses (fake slow-start server, fake
instant-crash process) exercising the real polling loop; the Windows `.bat`
mirrors the same logic but is unverified live (no Windows box in this
session — flagged for Paolo/Parallels to confirm).
**Important operational note:** the self-update mechanism explicitly
excludes the running Start script from being overwritten (rsync
`--exclude='Start OCHA QuickVid.command'` / robocopy `/XF "Start OCHA
QuickVid.bat"` — a script can't safely replace itself mid-execution). That
means **this class of fix cannot self-propagate** to an already-broken
install: re-launching the existing (buggy) Start icon will keep running the
old buggy logic forever. Anyone stuck on the old behavior needs to **re-run
the install one-liner** (which downloads a fresh copy of everything,
including the Start script itself), not just click Start again.

## 2026-07-16 — Premiere plugin, phase 1: UXP + generated MOGRTs (premiere/)
For Premiere-native editors, the OCHA branding elements ship as **MOGRTs +
(phase 2) a UXP panel** — NOT CEP, NOT a QuickVid-engine dependency:
- **UXP over CEP**: officially released for Premiere since 25.6 ("approaching
  parity"), actively developed (26.x added Hybrid C++, EncoderManager,
  Transcript APIs); CEP is frozen legacy. Everything our panel needs exists
  (`Project.importFiles`, `SequenceEditor.insertMogrtFromPath/createInsert…`).
- **Distribution = direct .ccx sharing** (double-click → Creative Cloud installs;
  one "trusted sources" click-through). No Marketplace review, no certificates.
- **MOGRTs, not engine renders**: native Premiere objects, editable in Essential
  Graphics, zero dependencies. The engine stays QuickVid's business.
- **The MOGRTs are GENERATED, not hand-built**: `premiere/ae/make_assets.py`
  bakes brand-lt.json + brand-pin.json (same source of truth as the engine) +
  converts pin_location.svg to AE beziers, and emits a self-contained
  ExtendScript that builds 4 comps × 4 formats with EGP controls + responsive-
  time protected regions, then exports every .mogrt. Javier QCs in AE; the look
  can never drift from the engine because the numbers are the same file.
- **AE scripting gotchas paid for in blood** (kept here so nobody re-buys them):
  `TextDocument.tracking` must be an INTEGER; `sourceRectAtTime` THROWS on an
  empty text layer (gate every width lookup); `setPropertyParameters` REPLACES
  the dropdown effect (references go stale — re-fetch by name); and
  `exportAsMotionGraphicsTemplate`'s path argument is a destination FOLDER and
  a successful export INVALIDATES every project reference (project, folders,
  footage items) — re-resolve by name before each subsequent build.

## 2026-07-15 — Pin polish + start time + a live progress bar (v0.5.1 → 0.5.3)
Three follow-ups after the pin locator shipped, from Javier's testing:
- **v0.5.1 — silent-video crash fix.** Branding a video with NO audio stream (a
  macOS screen recording is the everyday case) aborted ffmpeg with exit 234:
  the ending + subtitle passes hard-referenced `[0:a]`. Both engines now probe
  for audio (`has_audio`) and synthesize a silent stereo bed (`anullsrc`) when
  there's none, so the logo click still lands. `finish.py` also prints an
  `ERROR:` line on any uncaught exception so the UI shows the real reason, not
  the bare "finish.py exited 1". Root cause was found from the on-disk job log,
  not guessed — the trigger was the input file, not the bug/pin combo reported.
- **v0.5.2 — live % progress bar.** The branding ffmpeg passes stream ffmpeg's
  `-progress pipe:1` and emit `PROGRESS n` tokens (already parsed into
  `job.percent` by engine_bridge). `finish.py` splits the bar between the
  overlay composite (0–70) and the ending (70–100); `social_brand` drives 0–100.
  The Titles-tab `setStatus` now renders the same `cd-progress` bar the Edit tab
  already used; both poll loops pass `percent`.
- **v0.5.3 — pin rebound + anti-crop + start time.** (a) `pin_overshoot` 1.5 → 0.9
  (crest ~8% → ~3%) — subtler, not cartoonish. (b) The overshoot briefly grows the
  pin past 1×; `build()` now pads the PNG top+left by that crest (`pad`, auto-sized
  from `_peak_scale()`), and the compositors shift the overlay up-left by `pad`
  (into the safe margin) so the box stays put and the pin is **never clipped**.
  (c) A **Start** time (mm:ss) is now user-set in the UI — the engine already
  supported `pin.start`; the field was just missing. The Location controls were
  **restyled to match the lower thirds** (Place|Date row, Start|Duration steppers
  reusing `.timefield`/`.durfield`, icon+colour row). CSS gotcha: `.field-row label`
  forces `flex-direction:column`, so the icon toggle needed a `.pin-row2`-scoped
  rule to win by specificity.

## 2026-07-15 — Pin locator (location strip) — the 2nd branding element
An animated top-left location strip: a map pin beside a UN-blue rectangle with a
place (top, Raleway ExtraBold) over a date (bottom, Raleway Medium). Built to
Javier's spec + an "improve on the reference" brief (references/locatorpin/).
- **New module `engine/pin_locator.py`**, mirroring `lower_third.py` exactly:
  numbers in `browser/brand-pin.json`, logic in the module, rendered as a
  transparent PNG sequence, composited by BOTH `finish.py` (Titles) and
  `social_brand.py` (Edit) — same overlay-with-delayed-start pattern as the LT.
- **Animation** (locked): no fade. The rectangle reveals as TWO stacked cyan
  bands, each a left-anchored wipe — the top (place) line LEADS, the bottom
  (date) line follows a beat later, so they never appear/disappear together
  (Javier's ask). The pin does NOT fade: it SCALES in with a subtle back-ease
  overshoot (~8%), anchored at its bottom tip via an SVG transform, so it grows
  bottom→top and shrinks back to the tip on exit. Exit is the exact reverse
  (date retracts, place retracts, pin shrinks last). Numerically verified:
  scale 0 → 1.078 peak → 1.0.
- **Sizing measured off a real OCHA video** (references/videos/HNPW... had its
  own; the reference pin ≈ box height, ratio 1.016) → pin_scale 1.05 (a first
  cut at 1.28 was too big). Place line ~2.8% of frame height, matched to the ref.
- **Icon toggle** (on by default): off → the text block shifts left into the
  freed space (responsive; box_x = 0 when no pin). **Colour** red #ED1847 default
  / blue #004987 (user picks when red clashes). **Duration** 5s default,
  adjustable; hold = duration − ENTER_END − EXIT_DUR.
- **Placement** top-left at the format's safe margins (finish.py `profile()` /
  social_brand `SAFE_AREA`, adding a `left` inset to the latter).
- **Font:** bundled `Raleway-ExtraBold.ttf` (800) into engine/assets/fonts — the
  engine ships its own fonts so it renders identically on every machine.
- **Wiring:** `pin: {on,place,date,icon,color,start,duration}` through
  `FinishReq`/`StRenderReq` (new `PinReq`) → `engine_bridge` (both finish
  branches) → `finish.py` / `statement.py` → `social_brand.render()`. UI: a
  "Location" step in Titles (Ending renumbered 5→6) and a Location subsection in
  the Edit card (Lower thirds → Subtitles → Bug → Location → Ending). Off by
  default; persists through Edit autosave (snapshot/restore), old projects
  default off. Example thumbnail `img/ex-pin.jpg`.
- **Gotcha fixed:** the Edit-tab JS block first landed INSIDE an onclick arrow
  (two `stSetSubStyle("box")` in the file; matched the wrong one) → its function
  declarations were scoped local, `stCollectPin` undefined. Moved to the correct
  top-level anchor. (Function declarations hoist, so "defined earlier but
  undefined at runtime" = it's nested, not a load error — a useful tell.)
- Engine **v0.5.0**; page ENGINE_MIN/LATEST → 0.5.0 (the page now sends a `pin`
  field older engines silently ignore). 0.4.0 engines self-update to it on next
  launch. Verified: both engine paths, /api/finish (red+icon, blue+no-icon),
  social_brand stack (pin + caption + LT together), UI toggle/colour/collect,
  snapshot/restore round-trip, entrance+exit animation frames.

## 2026-07-15 — The bug (persistent corner watermark)
First of two planned branding elements (bug + pin locator — see the brainstorm in
chat). A small OCHA vertical-logo watermark, **top-right, on for the whole clip,
off by default**, toggleable in both tabs.
- **Size/position locked by visual comparison** (2.5% / 3.2% / 4.0% of frame height
  tested side by side on real footage): **3.2%** — clearly legible, clearly smaller
  than the ending logo's 5.4%, doesn't compete with the subject. Position: the
  SAME social-safe-area margins lower thirds already use (`finish.py`'s
  `profile()` table), not a new number.
- **Asset:** `assets/OCHA_logo_vertical_white.svg` (distinct from the ending's
  horizontal lockup) — rasterized fresh at render time, per [[logos-always-svg]].
- **Engine:** `finish.render_bug()`/`bug_pos()` (Titles path) and a mirrored
  `BUG_HEIGHT_FRAC`/`SAFE_AREA` pair in `social_brand.py` (Edit path) — kept as
  two small independent literals rather than a cross-module import, the same
  tolerance `LOGO_SVG`/`logo_ratio` already has between these two files. In both
  renderers the bug composites as the base layer (added right after the canvas
  scale step) so every other overlay — LT, captions, ending — stacks above it.
  No `enable=` gate needed: it's a `-loop 1` static image, on for the whole
  render by construction.
- **Wiring:** `bug: {"on": bool}` threaded through `FinishReq`/`StRenderReq` →
  `engine_bridge.finish()` (BOTH branches — plain and the subtitles-routed
  `_finish_with_subtitles`) → `engine/finish.py` / `engine/statement.py` →
  `social_brand.render()`.
- **UI:** Titles tab gained its own step ("4 · Bug", Ending renumbered 4→5); the
  Edit tab's step-7 card gained a third `.st-subsection` (Lower thirds → Subtitles
  → **Bug** → Ending — Javier's own stated element order). Checkbox off by
  default in both; example thumbnail (`img/ex-bug.jpg`) always visible, not
  gated behind the checkbox (the bug has no style variants to preview, unlike
  subtitles). Persists through Edit-tab autosave; old saved projects (no `bug`
  field) correctly default to off on restore.
- Verified end-to-end: pixel-diff proof the overlay renders (0→14.4 mean
  brightness on a solid-black synthetic source, isolating it from two
  coincidental bright-background false negatives on real test footage first),
  both API paths (`/api/finish`, `/api/statement/render`) through the live
  server, snapshot/restore round-trip, legacy-project default-off.

## 2026-07-15 — Bug: corrected size + reframed as an EVENT-video element
The 3.2% first cut was tuned on portrait test footage and never checked against
how OCHA actually uses this mark. Javier: it's mainly for **event videos**
(16:9), and it "has to be bigger." Corrected against a real example he pointed
to (`references/videos/HNPW2026_USG_remarks.mp4`, a finished OCHA event video
that already carries its own bug).
- **Measured the reference directly** (brightness-threshold pixel scan, not by
  eye): logo height **6.67%** of frame height, top margin **5.83%**, right
  margin **6.61%**. `BUG_HEIGHT_FRAC` 0.032 → **0.065** in both `finish.py` and
  `social_brand.py`. Landscape's `right` safe-margin 0.045 → **0.06** (only the
  bug reads `safe["right"]`/`safe["top"]` — confirmed no other caller — so this
  doesn't touch lower-third placement, which still uses `safe["left"]`).
  Rendering the corrected bug directly onto the reference video landed it
  almost exactly on top of the original — strong confirmation the numbers now
  match real OCHA practice, not just a plausible guess.
- Kept as ONE global size (not split further per-orientation): Javier's ask was
  "bigger," not a per-format size table, and the feature already had a shared
  size before this fix. It now also reads bolder on portrait/square — accepted,
  since the copy now correctly frames the bug as the event-video default and
  the toggle stays available everywhere per his explicit "no matter what
  format" instruction.
- **Thumbnail rebuilt as landscape**, from the same reference video — the clip
  already carries its own baked-in bug, so a straight crop was cropped
  (`crop=1600:900:50:90` before scaling to 1920x1080) to exclude the original
  top-right corner entirely, keeping the presenter, before compositing OUR bug
  fresh via the real `render_bug()`/`bug_pos()` functions. Avoids a confusing
  double-logo in the example while still using 100% authentic OCHA footage.
  Saved at 360x203 — the app's standard landscape-example size (matches
  `ex-ending-footage.jpg` etc.), not the portrait 360x640 used for the reels
  examples.
- **Copy added in both tabs + both help panels**: "Typically for event videos
  (16:9 screens, screenings, livestreams) — social media rarely needs it.
  Available for any format if you want it." The toggle itself is unchanged —
  still just an on/off, no format gating.
- Pin locator (the second element) is paused — needs Javier's reference asset.

## 2026-07-16 — Rename to "OCHA QuickVid" + Mac install becomes a Terminal one-liner (.app launcher)
**Supersedes the 2026-07-15 `.zip` entry below** — the `.zip` fixed the missing +x bit but
NOT the deeper problem: a *downloaded* unsigned `.command` is quarantined, and on macOS 15
(Sequoia) that Gatekeeper dialog is a dead end (only "Move to Trash" / "Done" — no "Open
Anyway"). Verified live on a colleague's Mac.
**Fix (Mac):** stop shipping a file to double-click. The page now shows a copy-paste
**Terminal one-liner** — `curl -fsSL …/install.sh | bash`. A script fetched by curl and run
by the user is never quarantined, so Gatekeeper never fires (same pattern as Homebrew/rustup).
`install.sh` sets everything up, then **writes a proper `.app` launcher** (`org.unocha.quickvid.starter`)
carrying the OCHA "Film" humanitarian icon (white on solid `#009edb`; `assets/StartOCHAQuickVid.icns`,
source SVG beside it) into **~/Applications** (Launchpad + Spotlight, no admin) **and the Desktop**.
Because the `.app` is created locally it's never quarantined → double-clicks with no warning and
no code-signing. It runs headless (no Terminal window) and shows a native `osascript` dialog on
error. Recovery if the icon is deleted = re-run the one-liner (rebuilds it). The classic
DMG "drag to Applications" was rejected: a downloaded DMG re-introduces quarantine → needs
signing+notarization ($99/yr), which we're still avoiding.
Dead Mac `.zip`s + `browser/get/make-zips.sh` removed. Windows keeps its `.bat` download
(no quarantine concept); both platforms' install cards gained numbered steps, a "this is safe /
not malware" note, and an `ochavisual@un.org` contact.
**Rename:** every user-facing string is now "OCHA QuickVid" (launcher filenames, UI, banner,
README, this file). Left as code identifiers: repo slug `quickvid_BDU`, the
`ocha-quickvid-engine` health string, `.ochaquickvid.json` project extension. Engine VERSION → 0.6.0.

## 2026-07-15 — Mac installer/starter ship as .zip (fixes "lacks access privileges") — SUPERSEDED 2026-07-16 (see above)
A colleague on a non-UN Mac hit *"No se ha podido ejecutar… careces de los privilegios
de acceso necesarios"* double-clicking the downloaded `Install OCHA QuickVid.command`.
**Root cause:** HTTP carries no Unix permissions, so a `.command` downloaded straight
from a browser loses its executable bit (repo copy is `-rwxr-xr-x`; after download,
`-rw-r--r--`). This is a *different* error from the already-documented Gatekeeper
"unidentified developer" nag — right-click → Open does **not** fix it (that only
clears the quarantine flag, not the missing +x). Reproduced and confirmed exactly:
`chmod 644` on the repo file reproduces the message.
**Fix:** the two Mac buttons (`get/Install OCHA QuickVid.*`, `get/Start OCHA QuickVid.*`) now
download `.zip` wrappers instead of the bare `.command`. A zip's central directory
stores the Unix mode, and Archive Utility (incl. Safari's automatic "open safe
downloads" unzip) restores it on extraction — verified with a full round-trip
through the real HTTP server (curl → unzip → `-rwxr-xr-x` restored). For Safari
users (the default browser for the intended audience), this is invisible — same
double-click flow as before, just no longer broken; for other browsers, one extra
double-click to unzip, called out in the button copy as "if it lands as a .zip…".
Windows `.bat` files are unaffected (no Unix-permissions concept) — left untouched.
**Regenerate after editing either `.command`:** `bash browser/get/make-zips.sh`
(zips are build output, not hand-maintained — added `*.zip -text -diff binary` to
`.gitattributes` so git never mangles them).

## 2026-07-14 — Edit is the primary tab (engine-only app)
Now that everything runs through the engine (Lite dropped), the flagship is the
statement-clip editor, not the simpler "add titles" pass. So:
- Tab order flipped: **"Edit a statement clip"** is first + active by default;
  "Titles & branding" is secondary. (Renamed the terse "Edit" → "Edit a statement
  clip" — it's the front door now, so it says what it does.)
- `gate()` lands on the Edit panel when the engine comes up; initial HTML has the
  Edit panel visible, Titles hidden. Lede rewritten to lead with editing.
- No behaviour change to either pipeline — pure ordering/emphasis.

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
**Boundary rule:** edit lives in the words -> OCHA QuickVid; edit lives in the visuals/
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
blue horizontal lockup with "OCHA QuickVid" as a separate product name (One OCHA rule).
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
**Why a script + skill, not (yet) a OCHA QuickVid mode:** the captioning UI/flow isn't in the app; this is the
proven engine to fold into a future OCHA QuickVid "Subtitles" capability. Confirmed with Javier.

## 2026-07-10 — Statement clips become a OCHA QuickVid Edit video type (self-service)
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

## 2026-07-12 — "Use AI" sentence selection + named projects
- **Use AI (step 5)**: copy-paste loop, no API keys — works with Copilot (OCHA
  default) or any LLM. The prompt carries OCHA context, editing rules (open
  strong, complete thoughts, ≤90s, keep the appeal near the end), the numbered
  transcript with durations, and a protocol: the AI must ASK the editor first
  (key messages? attach the statement; target duration) and END with
  `{"keep": [ids]}` on its own line. Tolerant parser (fenced/chatty/keep-line/
  bare-list all accepted; garbage and out-of-range ids get clear messages).
  Modal = new kit `.cd-modal` (v0.1.2, Storybook handoff h5). Privacy line
  (embargoed content) + long-transcript warning (>7.5k chars, Copilot truncates).
  Human review stays: applying just pre-ticks the list.
- **Named projects (step 1)**: the project NAME is now required for saving —
  choosing a location creates `<parent>/<name>/` and the autosave becomes
  `<name>.ochaquickvid.json` (loader still accepts older `.quickvid.json` + the fixed name; renaming
  cleans the old twin). Resume banner and the download filename carry the name.
  Export mp4 already inherited the folder name → now the project name.

## 2026-07-12 — ONE lower third everywhere (look B chosen)
Javier picked **look B** (compact ASG style) from a side-by-side against the
Venezuela look. Consolidation (was 3 divergent implementations):
- **Numbers live once**: `browser/brand-lt.json` — timings, per-orientation size
  ratios (portrait 0.02292 = 44px@1920 · square 0.0306 · landscape 0.0382),
  paddings, colors, weights. Served to the Lite page and read by Python at import.
- **Logic lives once (Python)**: `engine/lower_third.py` is canonical (build/svg/
  state/render_seq + finish.py-compatible render()). `social_brand.py` deletes its
  copy and delegates; `finish.py` drops the Venezuela-era per-profile ratios.
- **Lite (JS)** mirrors the same choreography reading the same spec
  (`engine.js` ltState/drawLowerThird; `window.__qvLT` test hook).
- **Verified**: statement path == titles path == approved B reference, pixel-
  identical (diff bbox None); Lite canvas within ~2% (canvas-vs-PIL font metrics);
  both full pipelines re-rendered end-to-end.
- The `ocha-social-subtitles` skill's renderer is now a **thin shim** that runs
  `engine/social_brand.py` — the last duplicate is gone. Old job.json files keep
  working (`ending.logo` auto-translated); black-tail clips need explicit
  `footage_end` (auto-detection retired).

## 2026-07-14 — Self-updating starter (auto-update on launch)
The Start scripts now UPDATE the engine before launching, so nobody re-downloads by hand.
- **Single source of truth:** a root `VERSION` file. `settings.py` reads it → /api/health, the
  page's version gate, and the self-update check all compare the same number.
- **On launch** (Start OCHA QuickVid.command/.bat, after the already-running check): fetch
  `raw.githubusercontent.com/.../main/VERSION` (3s timeout). If newer than local, download the
  repo zip, then MIRROR it over the install — keeping `.venv` and the currently-running launcher
  (a file can't safely replace itself mid-run), `--delete`/`/MIR` clearing files dropped upstream.
  Then the same run continues to pip-install (picks up new requirements) and launch the new code.
- **Bulletproofing:** rsync `-c` / robocopy `/IS` + an explicit `VERSION` copy — otherwise a
  same-size/same-mtime quick-check could strand VERSION and re-trigger the update every launch.
- **Guards (all tested):** skip if a `.git` dir is present (never clobber a dev checkout), if
  `QV_NO_UPDATE` is set, on any network failure, or if the remote isn't a valid version. Never
  blocks startup — any hiccup falls through to the current version.
- **Doesn't replace the running launcher**, so a launcher-script change still needs one manual
  reinstall; app/engine/browser/requirements (all the features + served UI) auto-update.
- **Caveat:** takes effect only once the user has a Start script that CONTAINS this logic — i.e.
  after ONE more reinstall (Paolo needs that anyway to clear v0.2). "The next reinstall is the last."
- Mac path verified end-to-end with a file:// mock (update, converge, all guards). Windows
  (robocopy/tar) shares the logic but is untested on real hardware — Parallels/second-machine test.

## 2026-07-14 — Alert: drop the box-shadow accent bar too (kit v0.1.5)
Same-day follow-up to the alert fix above. Javier, after seeing v0.1.4 live: "remove
the left thicker border... this should affect all cd-alert." The v0.1.4 box-shadow
accent was a faithful match of the DS repo's `components/cd-alert/cd-alert.css` at
the time, but still read as a chunky left bar. Fixed at the true source this time,
not just the app-kit copy: removed `box-shadow: -8px 0 0 var(--cd-alert-color)`
from the canonical `components/cd-alert/cd-alert.css` itself, then mirrored into
the app-kit's `.cd-alert` (dropped its `-6px` echo) and synced to OCHA QuickVid.
`.cd-alert` is now a plain 1px border on all four sides + the ramp-step-6 tint —
verified via computed styles (`boxShadow: none`, `borderLeftWidth: 1px` matching
every other edge) across all four variants (info/status/warning/error).
Logged in the kit's own CHANGELOG (v0.1.5) and corrected the stale h7 handoff
(it described the box-shadow as the final look, which is no longer true) so the
Design System session isn't misled about what to mirror in Storybook.

## 2026-07-14 — Spacing sweep: .st-setup-block joins the cd-flow rhythm
Same disease as the alert-vs-heading bug, third location: Javier flagged "Already
installed?" sitting flush against the previous block's button. Root cause was
identical in shape but a different mechanism — `.st-setup-block` (the Mac/Windows
"First time?" / "Already installed?" panels) sits INSIDE `.cd-card__content.cd-flow`
but is itself a plain `<div>`, so `.cd-flow > * + *` (a direct-child selector) never
reaches its own children — the `<h3>` had NO spacing rule at all before the button
row right after it.
**Fix:** added the `cd-flow` class to `.st-setup-block` itself (4 instances: Mac ×2,
Windows ×2) — reusing the kit's existing vertical-rhythm utility rather than inventing
a bespoke rule. OCHA QuickVid-local (HTML only, no kit change): `.st-setup-block` is an
app-specific container, not a reusable component. The already-tuned local overrides
(`.st-setup-block .app-hint { margin-top: 0.5rem }`, `.st-setup__note { margin-top:
0.5rem }`) still win by specificity, so those tighter, deliberate relationships are
unaffected — only the previously-unstyled heading→button gap changed.
**Also swept the rest of the app** for the same shape (a non-flow `<div>` whose first
child is a heading) — found nothing else; this was the only recurring instance.
Verified: h3→button gap is now 16px everywhere it was 0 (both OS panels, both blocks).

## 2026-07-14 — Alert component: kit update (v0.1.4), synced from the source
**Not a OCHA QuickVid-local fix — fixed in the OCHA App Kit** (`…/OCHA_design_system/
ocha-common-design-system-BDU/app-kit/ocha-app-kit.css`) and synced here via `sync.py`,
per the kit-first rule. Javier: "use the alerts from OCHA DS, not the ones with the left
border — that's so AI made."
- `.cd-alert` now matches the canonical `components/cd-alert` in the main DS repo: a
  full 1px border + an offset `box-shadow` accent bar (not `border-left`), and the
  DS's actual ramp-step-6 tints (`#E3EDF6`/`#CEE3A0`/`#FEDCBD`/`#F9C0C5`) — the kit had
  drifted to a thin border-left + near-white wash, a generic look common in AI-templated
  UI. Bakes in `margin: 1rem 0` (zeroed at `:first-child`/`:last-child`), matching the
  real component; OCHA QuickVid's own `.status-slot .cd-alert { margin-block: 0.15rem; }`
  override (for the tight spot under the render button) still applies unchanged.
- **Root-caused the reported spacing bug**, not just patched the one spot: `.cd-block-title
  { margin: 0 }` was silently cancelling `.cd-flow > * + *`'s top margin (equal
  specificity, defined later → wins by source order) whenever a block-title directly
  followed a flow sibling — e.g. the engine-update alert sitting flush against "Update
  the OCHA QuickVid engine" below it. Fixed with `.cd-flow > * + .cd-block-title` (two
  classes always wins the tie), so this can't recur anywhere the pattern occurs.
- Verified: 16px gap now between the gate alert and its heading (was 0); all 5 cd-alert
  instances across the app (gate, update banner, resume, saved, status) render with
  consistent border/shadow/padding and correct margin behaviour.
- Logged in the kit's own `CHANGELOG.md` (v0.1.4) and `HANDOFFS.md` (h7, Design System
  Storybook session) per its discipline — remind Javier to prompt that session.

## 2026-07-14 — Engine version gate + subtitles-on-by-default
**Version gate (page ↔ engine).** The page always ships newest (GitHub Pages); the engine
reports `version` in /api/health. app.js compares:
- `ENGINE_MIN` (0.3.0) = oldest engine whose /api CONTRACT matches this page. Below it the
  engine silently drops new fields (Paolo's v0.2 → dropped subtitles/tail/runs-cutting =
  wrong output, no error) → **HARD GATE**: block the app, show the install card reworded
  ("Update the OCHA QuickVid engine", amber alert with the actual versions), tabs hidden. The
  poll keeps running (engineUp=false) so a reinstall recovers it automatically.
- `ENGINE_LATEST` (0.3.0, == MIN for now) = newest worth a NON-blocking nudge. When >MIN a
  dismissible "update available" banner shows (OS-detected installer link + "Later").
  Dormant while ==MIN, so nobody is nagged for a page-only release.
- **Discipline (important):** bump `ENGINE_MIN` ONLY when the page starts sending/expecting
  something older engines can't handle — never for UI-only changes. `cmpVer()` is numeric
  semver. The "reinstall = update" story holds because the installer replaces in place; the
  gate copy tells users to close a running old engine first (port 17870 conflict).
- Phase 2 (not built): a self-updating starter that checks GitHub before launching, so the
  next manual reinstall is the last. Queued for the second Windows test.
**Subtitles on by default** in Titles & branding (`#t-subs-on` checked, options shown) —
most social video is watched muted, so captions are the common case.

## 2026-07-14 — Drop "Lite": OCHA QuickVid is engine-only (v0.4.0)
**Decision (Javier):** remove the in-browser WebCodecs renderer entirely. OCHA QuickVid is a
full-capability tool for power users (BDU + trained focal points, Mac & the .bat-friendly
Windows machines) rather than a limited tool for everyone — "a tool that only adds lower
thirds and an ending" isn't worth a second mode. Paolo's field test proved the engine
runs on real Windows without admin.
**What changed:** browser/engine.js + lib/mp4box + lib/mp4-muxer deleted (the lower third
now has ONE renderer: engine/lower_third.py); the Lite/Full chip is now a simple
"Engine connected · vX" / "Engine not running" indicator; the install card moved out of
the Edit tab to a TOP-LEVEL GATE — with no engine the page shows setup only (tabs hidden)
and keeps polling every 4s so it unlocks by itself; the Titles dropzone is click-to-pick
only (native picker via the engine — no File uploads); the Titles subtitles CTA for Lite
users is gone (controls always shown); footer upsell + Edit-tab "engine" pill removed.
**Kept:** the web-served page + local engine architecture (page updates itself), the
web-served installer/starter flow, both tabs, everything else.
**Fallback for blocked machines:** none by design — those users contact ochavisual@
(README says so). If AppLocker-style policy turns out to block many field laptops,
revisit with a signed installer, not with Lite.

## 2026-07-14 — Statement-clip fixes from Paolo's Windows test (ASG Yemen)
The colleague's export was bumpy every ~10s, carried the next speaker's French, had a
face-covering logo and read soft. Diagnosis + fixes (engine + UI, all verified against
his actual project file rendered through the API):
- **Runs, not per-sentence cuts** (`build_runs`, JUMP_GAP=1.5s): consecutive sentences play
  as ONE continuous take — natural pauses kept, Whisper's overlapping boundaries clamped
  (they used to double-play ~0.2s at every seam). Punch-in ONLY at a real jump (>1.5s of
  skipped source). The old rule punched on every >0.25s pause = the "bumps". First take
  opens general (sharpest); a C/G pill click sets its whole take, newest click wins.
- **"[...]" omission marker** automatically prefixes the first caption after each jump.
- **Captions**: hard 2-line max via a per-preset char budget (`two_line_chars`, ~72 chars
  on reels), split at word boundaries on word onsets; <1.2s cues merge forward; balanced
  wrap (no orphan word — social_brand `_wrap_lines`); EXACT spoken words always (the
  pasted script is selection-only). Reels/4:5 caption position now CONSTANT (hi==lo,
  1430/1050) — no drop when the LT leaves; square/event keep the lift (real collisions).
- **Ending tail**: over_footage bed reuses the LAST take's framing and its audio FADES TO
  MUTE (st=0.1, ≤0.6s) — the "Je remercie…" next-speaker bleed can't happen. New UI
  control "Footage after the last sentence" (0-4s, default 2.6) + hint to keep a closing
  "I thank you" selected. Logo default 0.055·H (was 0.077 = too big) and sits at 0.58·H
  over footage (clear of faces; over_black stays centred).
- **Quality**: statement + Titles-subtitles renders now 12 Mbps (6M read soft); zoom-softness
  hint fires at 1.5x with the real source-pixel width.
- **Sync**: UN Web TV downloads PRESELECT the +4f usual fix (Ukraine + Yemen both needed it);
  local files still start "As is".
- **Windows/files**: /api/export honors ?name= (cross-origin downloads ignore the anchor's
  download attr — that's why Paolo shipped "ocha_quickvid (1).mp4"); statement UI passes the
  project name. New POST /api/open-folder (Finder/Explorer) + "Open folder" buttons on the
  folder line and the saved-to-export line. save-project failures now surface a warning
  instead of dying silently. StRenderReq gained `subtitles` (pydantic was silently DROPPING
  the Edit tab's style toggle) and `ending.tail`.
- Engine VERSION 0.3.0. To update an installed engine, re-run the web-served installer.

## 2026-07-13 — Subtitles everywhere (Increment 2, UNPUBLISHED, local)
Javier's rules: subtitles are ENGINE-ONLY (no .srt path); Lite users get a plain CTA.
- **Both tabs**: "Burn in captions" is gone → a **Subtitles** ON/OFF toggle + a
  **Social (boxed) / Event (clean-over-gradient)** style choice with a real preview
  (`browser/img/ex-sub-box|event.jpg`, generated with the actual caption renderer
  over field footage). The **Social preview is a 9:16 portrait reel** (rendered at the
  real reels canvas 1080×1920 through social_brand, downscaled to 360×640) so it reads
  as a reel; Event stays 16:9. The preview `<img>` sets its width/height per style in
  JS (`stSetSubStyle`/`tSetSubStyle`) so the aspect ratio never stretches on swap;
  `.ex-thumb img` caps it (`max-height:280`) to a tidy 158×280 reel. Edit: the format
  preset sets the default style (event → gradient),
  switching presets resets it (predictable).
- **Engine**: statement.py render takes `subtitles: {on, style}` (style overrides the
  preset's box flag; `captions` bool still honoured). Verified: reels forced to
  gradient renders no-box + scrim; off → no cues.
- **Titles + subtitles (Full)**: /api/finish gains `subtitles`; when ON the bridge
  routes: statement transcribe (whole clip) → `cues_real_timeline()` (new helper —
  original-timeline cues, unlike the cut-timeline builder) → **social_brand.render**
  burns captions + LTs + ending in one pass (caption sizes derived as fractions of the
  canvas: size .024·H, bottom_lo .77·H, hi .6875·H; over_footage logo at dur−1.5 with
  footage_end capping cues; HI/LO caption lift verified working). finish.py stays the
  no-subtitles path (keeps its HDR→SDR handling — known limitation: the subtitle path
  skips SDR conversion for HDR sources).
- **Titles Lite**: controls replaced by the CTA — "To add subtitles, install the free
  engine — click here" → jumps to the Edit tab's install card. Verified incl. the
  mode swap and navigation.
- E2E test: /api/finish with subtitles on over a spoken test clip → transcribed boxed
  caption + bilingual LT + over_black ending, frame-checked.

## 2026-07-13 — Branding UI unified: Edit LT = Titles component (UNPUBLISHED, local)
Increment 1 of the "unify branding" batch (Javier's Windows-test feedback + spacing).
- **Edit step 7 lower third** rebuilt as the SAME multi-row component as the Titles
  tab: example preview image + Name + Job title + **2nd line (bilingual)** + **Start** +
  **Duration** + Alignment + add/remove rows (was a single fixed-timing LT with no
  preview/start/duration). Sends `lower_thirds[]`; engine maps duration→hold via
  `lower_third.ENTER_END/EXIT_DUR` (the shared brand-lt.json timing — NOT social_brand,
  which doesn't expose them; caught in test before it shipped).
- **2nd line now in BOTH tabs and all three renderers**: Edit (social_brand, already),
  Titles engine (`lower_third.render(org2=)` → `titles[]`, finish.py passes it), and
  Titles **Lite/browser** canvas (`engine.js` draws N org lines). Frame-verified on
  Edit (Indrika + "Vicejefe adjunto") and Titles (Vanessa May + "Portavoz").
- **Ending thumbnails added to Edit** (#19 — Edit simply had none; the images load
  fine on Pages). All ending/example imgs got width/height + loading attrs (robustness
  vs the Edge report).
- **Spacing pass** (#20): primary actions (#run/#st-render) are full-width with real
  margins; status/alerts get air.
- Back-compat: old single-LT projects (`lt:{}`) restore onto the new rows; `main.py`
  keeps `lower_third` alongside new `lower_thirds`.
- **Still pending (Increment 2):** subtitles overhaul — "Subtitles ON/OFF" toggle,
  Social/Event style toggle + live preview, Titles no-engine path (paste/.srt burned by
  engine.js) with an "install the full engine to auto-generate" CTA. Titles-Full caption
  routing too. (Javier: subtitles are for users who can't install the engine → offer a
  no-engine path, CTA fallback; style = a toggle with preview.)

## 2026-07-17 — Premiere plugin: which MOGRT controls the panel CAN drive (measured, not guessed)

Settled by live probing inside Premiere Beta 26.5 (UXP 9.3), logged to files
rather than inferred from screenshots. Do not re-litigate this without new
Premiere/UXP versions — re-run the probe first.

**The capsule IS reachable.** An inserted MOGRT's track item exposes:

```
trackItem.getComponentChain() -> 3 components
  [0] AE.ADBE Opacity  — Opacity, Blend Mode
  [1] AE.ADBE Motion   — Position, Scale, Rotation, Anchor Point, Crop…
  [2] AE.ADBE Capsule  — "Graphic Parameters"  ← the Essential Graphics controls
        LT   0:Name 1:Title 2:Title line 2 3:Centre align 4:Size
        Loc  0:Place 1:Date 2:Pin colour 3:Show pin icon 4:Size
        End  0:Over black 1:Size
```

The capsule attaches a beat AFTER `insertMogrtFromPath` returns — probe
immediately and you see only Motion+Opacity and wrongly conclude the controls
are unreachable (that mistake caused the whole value-baking detour). **Poll for
`matchName === "AE.ADBE Capsule"`.** Grab component/param handles SYNCHRONOUSLY
inside `project.lockedAccess`; the handles stay valid across later
lockedAccess calls.

**What works — booleans and numbers.** Confirmed set live:
`Centre align = true`, `Size = 50`. Pattern (Adobe's `keyframe.ts`):
`createSetTimeVaryingAction(false)` (best-effort) → `createKeyframe(value)` →
`createSetValueAction(kf, true)` inside `executeTransaction`.

**What does NOT work — text.** Name/Title/Place/Date cannot be written:
- `areKeyframesSupported() === false` on text params, `isTimeVarying() === false`
- `createKeyframe("string")` → **"Illegal Parameter type"**; `{value:str}` too
- `getStartValue()` → `null` (even after forcing `setTimeVarying(true)`)
- `getValueAtTime()` → "not supported for these value types"
- `ComponentParam` has NO string setter (methods: displayName, createKeyframe,
  getValueAtTime, find*Keyframe, createRemoveKeyframe*, createSetValueAction,
  createAddKeyframeAction, createSetTimeVaryingAction, getStartValue,
  getKeyframeListAsTickTimes, getKeyframePtr, isTimeVarying,
  createSetInterpolationAtKeyframeAction, areKeyframesSupported)
- `ppro.TextSegments` exists but only has `importFromJSON`/`exportToJSON` and
  belongs to the **Transcript/caption** API (`ppro.Transcript.*`), not capsules;
  every JSON shape → "Not Enough Parameters"

Conclusion: **Premiere's UXP DOM cannot write MOGRT text controls.** Not a bug
in our code — a platform gap (CEP had `getMGTComponent`; UXP has no equivalent).

**Baking values into the .mogrt does not work either.** A `.mogrt` is a zip →
`project.aegraphic` (zip) → `<name>.aep` (RIFX, big-endian, XMP trailer after
the root). We can patch it perfectly — `premiere/uxp-archive/rifx.js` +
`premiere/uxp-archive/tools/rifx_patch.py` produce a byte-correct capsule
(definition.json `clientControls[].value` AND the AEP text-engine
`"(\xfe\xff" + UTF-16BE` strings), verified three ways: byte-identical
rebuild, JS output identical to the Python patcher, and **After Effects opens
the patched project and reads back the new text** (accents intact). Premiere
still renders the DEFAULTS — tested with a fresh `capsuleID`, a unique temp
file path, randomized XMP DocumentID/InstanceIDs, and in a brand-new empty
project. Premiere resolves capsule instantiation from something the file
doesn't control. Patcher is kept in-repo for the day this changes.

**Where this leaves the panel:** it can drive Centre align, Pin colour, Show
pin icon, Over black and Size — but not the text. Since the hard requirement is
[[premiere-plugin-all-in-panel]] (never touch Essential Graphics), the text
mechanism is an open architecture decision — see docs/backlog.md.

## 2026-07-13 — Open a saved project (UNPUBLISHED, local testing)
"Add a field to open project" — reopen a former clip from its .ochaquickvid.json to
keep editing.
- `POST /api/statement/open-project`: native file picker → read + validate the json
  (dict with `v`) → return `{project, dir}`. `dir` is the file's REAL parent, which
  wins over the possibly-stale `jobDir` stored inside (folders get moved) — so edits
  save back to where the file actually is now.
- UI: "Open a saved project…" button on step 1 (under the new-project fields);
  handler restores the state and re-points jobDir to the picked location.
- Verified: valid load, and clear 400s for non-project json / unreadable / cancelled;
  full front-end restore incl. the moved-folder case (segments, shots, ranges,
  per-frame framing, preset, ending, titles, revealed cards). The native picker
  itself needs a real click — untested headlessly.

## 2026-07-13 — Step 6 framing: per-frame drag + zoom (UNPUBLISHED, local testing)
Javier: "left-right moves both frames, up-down only the punch-in" — the coupling was
geometry (a portrait crop of a landscape source already uses the full height) but the
UI never said so. Redesign, per his go:
- Each preview is its own editor: **drag the picture** to reposition (content follows
  the pointer; locked axes simply don't move) + a **per-frame zoom slider**
  (100–200%; close-up defaults 150%). Global sliders removed.
- **Hints explain the geometry** ("Full height in use — drag sideways; zoom in to move
  up/down") and warn ≥180% that zoom softens the picture.
- Engine: `crop_rect(sw,sh,cw,ch,x,y,zoom)` + `crops(..., framing)` — spec gains
  `framing:{general:{x,y,zoom}, close:{x,y,zoom}}`; legacy `subject` still works
  (old projects map onto both frames). `/api/statement/still` gains `zoom` (cache
  key updated); thumbnails use the general framing incl. zoom.
- Verified: crop math unit-tested (sizes, clamps, back-compat), API zoom renders
  distinct stills, synthetic pointer drags (direction, independence, exact edge
  clamping), legacy-project restore, and a real render where general (x.25 z1.3)
  and close (x.75 z2.0) visibly differ.
- Robustness fix found by testing: `setPointerCapture` can throw (aborting the drag
  handler) — drag state now set first, capture wrapped in try/catch.
- Same batch, also unpublished: sync-step button now adaptive ("Looks in sync —
  continue" / "Use +4f — continue", Skip removed) and download/transcribe **% progress
  bars** (engine PROGRESS token → job.percent → kit `.cd-progress`).

## 2026-07-13 — Two-process onboarding: web-served installer + starter
Javier's call: no buried folders — the page hands out tiny per-OS files instead.
- **First time** → `browser/get/Install OCHA QuickVid.command|.bat` (served by Pages AND
  the engine): downloads the repo ZIP → installs to a FIXED hidden location
  (`~/Library/Application Support/OCHA QuickVid/app` · `%LocalAppData%\OCHA QuickVid\app`)
  → runs the full setup → **starts the engine detached** → page unlocks by itself.
  Re-running the installer = update (the `.venv` is carried across so it's quick).
- **Next times** → `browser/get/Start OCHA QuickVid.command|.bat`: reads the install
  location from the registry file the launcher writes on every run
  (`<support>/home[.txt]` — so MANUAL/dev installs work with the starter too),
  starts detached, page unlocks in seconds. Engine stays on until shutdown/logout.
- Launchers gained: self-registration, an **already-running check** (just opens the
  page instead of a port-conflict crash), and **QV_DETACH=1** (Mac: nohup+disown to
  `<support>/engine.log`, window closable; Windows: minimized "OCHA QuickVid engine"
  console). Manual double-click keeps the old visible-window behavior.
- Card rebuilt: per-OS "First time here?" (installer) / "Already installed?"
  (starter) with the one-per-file Gatekeeper/SmartScreen note. README: buttons are
  the primary path; ZIP demoted to a collapsible developer note.
- Idle engine cost, measured: ~63 MB RAM, 0.0% CPU — always-on remains OPT-OUT by
  simply not starting it; auto-start-at-login deliberately NOT added (Javier: people
  don't edit every day; "stays on until shutdown" is the chosen model).

## 2026-07-12 — Windows: auto-install Python (no manual download)
`Start OCHA QuickVid.bat` now installs Python itself when none is found: downloads the
official python.org installer (pinned 3.12.8, PSF-signed, URL verified 200/27 MB)
and runs it `/quiet InstallAllUsers=0 PrependPath=1` — **user scope, no admin, no
Store**. The fresh install isn't on the current session PATH, so the script
prepends its default dir (`%LocalAppData%\Programs\Python\Python312`) and re-detects
in the same run (no "run twice"). If the download is blocked, it falls back to the
manual page (`/downloads/windows/`) with the exact steps ("Latest Python install
manager" at the top → tick Add to PATH → run again). PY stays a bare command
(`python`/`py -3.x`) so spaced usernames don't break venv creation. Added
`.gitattributes` forcing `*.bat` CRLF (LF-only .bat can break labels/goto),
`.command`/`.sh`/`.py`/`.js` LF. In-app card + README simplified to match.

## 2026-07-12 — OCHA QuickVid Lite/Full naming + Windows-ready engine
- **Chip renamed** (Javier's call): "OCHA QuickVid Lite — runs in your browser" vs
  "OCHA QuickVid Full — engine connected, no limits". One page, two power levels; no
  separate apps.
- **Windows engine shipped** (untested on real hardware yet — needs one UN laptop):
  - `Start OCHA QuickVid.bat` mirrors the Mac launcher: user-space Python check
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
- **Launcher (`Start OCHA QuickVid.command`)**: port fixed 8000→17870 (the app pings
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
- **`<job folder>/<name>.ochaquickvid.json`** — mirrored on each save when a folder is set (via
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

## 2026-07-19 — iPhone footage: rotation + HDR (`finish.py`, `social_brand.py`)
A portrait clip shot on an iPhone came out with branding placed for 16:9 and the
blue shifted. Two classic iPhone traits, both fixed in the engine's probe/prep:
- **Rotation.** Phones store portrait as landscape pixels + a rotation flag (old
  `rotate` tag OR newer displaymatrix side_data). ffmpeg auto-rotates the frames on
  decode, but `ffprobe stream=width,height` still reports the CODED (landscape) dims —
  so `profile()`/placement laid a 9:16 clip out as 16:9. `probe()` now reads the flag
  (`_rotation()`, handles both shapes) and returns DISPLAY dims (swapped on 90/270),
  matching the auto-rotated frames. No transpose needed — autorotate already orients
  the pixels; we just had to report the right size. Verified end-to-end (portrait in →
  portrait out, LT in-frame).
- **HDR/colour.** iPhone HDR is BT.2020 + HLG (`arib-std-b67`) 10-bit. Composited
  against sRGB brand graphics without tonemapping, the blue drifts. `finish.py` already
  tonemapped (`to_sdr`); `social_brand.py` (the subtitles path) did NOT — added
  `is_hdr()` + `to_sdr()` (mirrors finish.py) and a `bt709` tag on the output. Verified
  on a real BT.2020/HLG sample → bt709 out.
- Both are no-ops for ordinary landscape/SDR clips (swap only on 90°, tonemap only on
  BT.2020/HLG). `probe()` is shared with `statement.py`, so Edit-mode framing of a
  rotated clip is fixed too. Keep `_rotation`/`to_sdr` in sync across the two modules.

## 2026-07-19 — Plugin auto-update: channel via GitHub, not Dropbox
The DataViz plugin checks a `version.json` on **Dropbox** and (phase 2) downloads a
signed `.zxp` that a detached helper extracts after the host app quits. For the
QuickVid Premiere plugin we channel it via **GitHub** instead — the repo is already
on GitHub and the web app self-updates from it, so: no Dropbox tokens/link-rot,
versioned, free, one source of truth.
- **Shipped (MVP, v0.22.0):** `premiere/cep/version.json` on GitHub; on panel open
  `checkForUpdate()` (main.js) XHRs
  `raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/premiere/cep/version.json`,
  compares to `PANEL_VERSION`, and if newer shows a blue "New version — how to
  update" banner (per-version dismiss). Notify + manual download. XHR, not fetch
  (CEP allows cross-origin XHR); links open via `cep.util.openURLInDefaultBrowser`.
  Release step = bump `PANEL_VERSION` + manifest + `version.json` together.
- **Phase 2 (needs a decision):** full silent auto-update like DataViz needs (a) a
  packaged **signed `.zxp`** (self-signed cert via ZXPSignCmd) hosted as a GitHub
  Release asset, (b) `--enable-nodejs` in the manifest so `https.get` can download
  it, and (c) the detached extractor helper. Deferred until we settle plugin
  distribution (the plugin is still a dev symlink install, not yet a `.zxp`).

## 2026-07-19 — Text-on-screen + readability gradient (plugin) — UI shipped, backend planned
New plugin element **Text** (white Raleway Bold, animated in, user-typed, placed
centre-left + nudged with the shared Size/position X/Y) + a **readability gradient**
(subtle black scrim, top or bottom) reused by event captions. Reference:
`references/text_on_screen/text_on_screen.mp4` @00:32 (white bold, left-aligned,
lines reveal sliding up).
- **Shipped (v0.23.0, verified in-browser):** the panel UI — a 5th "Text" card +
  multi-line field + gradient segmented control (None/Bottom/Top); `collectValues`
  emits `Text` + `Gradient`; `EL_LABEL.text`; host `OCHA_EL_NAME.text = "OCHA Text"`
  so `ochaAdd("text", …)` will insert + set the text once the MOGRT exists.
- **Backend BUILT (v0.25.0) — awaiting one AE run to generate the MOGRTs:**
  1. `buildText(fmt)` in `premiere/ae/build_ocha_mogrts.jsx` — one editable text
     layer (Raleway-Bold, white, LEFT), size = H·`DATA.text.ratio[orient]`, default
     position [safe.left·W, 0.56·H], rise+fade reveal via `key2`, `sizeGroup`,
     `protectRegions`; exposes **Size** + the `ADBE Text Document` as EGP "Text".
  2. `buildGradient(fmt)` — the scrim is its **own MOGRT**, not a panel-generated
     PNG as first sketched. Decisive reason: one mechanism (`ochaAdd`), one AE build
     step, and it auto-fits every format — no `cep.fs` writing, no non-uniform-scale
     fiddling. Built as a full-frame black solid cut by a **feathered Linear Wipe**
     (completion leaves the band, feather does the fade) — far more script-robust
     than assembling gradient-fill colour stops. Controls: **Top** (checkbox, flips
     the wipe angle 0↔180) + **Opacity**.
  3. Both registered in `builders`/`builderNames`; host `OCHA_EL_NAME` gained
     `text`/`gradient`, `OCHA_BOOL` gained `Top`, `OCHA_NUM` gained `Opacity`.
  4. Panel: the Text pane's toggle inserts the scrim as a follow-up after the text;
     Captions has an "Add bottom gradient (event captions)" button — both go through
     the same `addGradient()`.
- **Remaining:** run the builder in AE (Prefs > Scripting & Expressions > "Allow
  Scripts to Write Files and Access Network"), restart Premiere, test. The two new
  build functions are the only part not verifiable outside AE.

## 2026-07-21 — Text + gradient: shipped for real (24 MOGRTs, plugin v0.26.0)
The 19 Jul entry's "remaining" step is done — the AE builder ran clean and produced
**24 MOGRTs** (6 elements x 4 formats). Two rounds of fixes on top of it:

**Phase 1 — AE templates** (`premiere/ae/build_ocha_mogrts.jsx`):
- **Text reveals per LINE, not as a block.** A Text Animator (Position + Opacity)
  with a Range Selector whose **Based On = Lines**, animated via `ADBE Text Percent
  Start`. The gotcha that cost a build: `ADBE Text Range Type2` lives inside the
  selector's **`ADBE Text Range Advanced`** group, not on the selector itself —
  reading it off the selector returns null and kills the whole run (only 20 of 24
  templates got written). Wrapped in try/catch: if the animator can't be built the
  layer falls back to the old whole-block reveal rather than aborting the build.
- **Out animation is the reverse of the in** (selector runs 100 -> 0 at the tail).
- **Gradient orientation was inverted.** AE's Linear Wipe clears the side the angle
  points AWAY from, so angle **180 = scrim at the BOTTOM**, 0 = top — the opposite of
  the first assumption. `Top` (checkbox) now drives the angle through an expression.
- **Full screen** checkbox added (drives Transition Completion to 0 = even wash).

**Phase 2 — panel restructure** (v0.26.0). The gradient stopped being a passenger on
the Text CTA and became its own thing, reachable from three places:
- `addGradient(pos, opacity)` is the single entry point (bottom | top | full). The
  Text CTA now adds **only** the text.
- Three tiles open the same DataViz-style modal: `#text-grad-btn` (inline in the Text
  pane), `#tool-gradient` (Toolbox) -> full settings; `#cap-gradient` (Captions) ->
  fade only, position locked to bottom, since that's what **OCHA Clean** needs.
- **Install caption styles** became a tile + modal explaining the whole flow
  (install once -> Window > Text > Captions -> pick Boxed/Clean -> add the gradient
  on a track below), instead of a bare button with a one-line result.
- `TOOLS` entries gained `settings` ("all" | "fade"), `needsFmt`, `ready` and `done`.
  `needsFmt` matters: installing caption styles writes into Premiere itself, so it
  must NOT be gated on having an OCHA-format sequence open. `done` turns the host's
  `track=V2|set=...` reply into a sentence.

## 2026-07-21 — Location strips: one shared component, many strips per video
"More than one location" turned out to be the smaller half of the job. The location
strip existed **three times over** — the markup twice in `browser/index.html`
(`t-pin-*` / `st-pin-*`), the colour toggle + steppers + collector twice in
`app.js` and `statement.js`, and the spec reader twice in the engine. A fix on one
tab left the other behind. So the feature landed as a de-duplication:

- **`browser/location.js`** — the ONE component. `OchaLocation.mount({rows, add,
  onChange})` returns `{addRow, collect, restore}`. Both tabs mount it; the card is
  the same enclosed, auto-numbered `.loc-row` as a lower third (a CSS counter, so
  removing the middle card renumbers the rest for free). Loaded before app.js and
  statement.js.
- **`pin_locator.specs(spec)`** — the ONE reader. `finish.py` (Titles tab) and
  `social_brand.py` (Edit tab) both call it and loop; defaults live only there.
  `hold_for(duration)` likewise owns the in/out-animation arithmetic.
- **Both shapes accepted, forever**: `pins: [...]` from the new UI, and a lone
  `pin: {...}` from any project saved before today. `_pins()` in `main.py` does the
  same at the API edge, and `specs()` is idempotent so double-normalising is safe.
- **Default start is 0:04** (`pin_locator.DEFAULT_START`, mirrored by
  `OchaLocation.START_DEFAULT` and `PinReq.start`) — was 1.2s.

**The engine bug this uncovered — and the one combination still not supported.**
A second strip made `social_brand.py` output a 12s clip as **7.9s** (233 of 360
frames). Cause: a `trim` filter in a chain that also carries two or more
time-shifted `overlay`s loses frames. `over_footage`, the only ending with no trim,
was never affected; one strip never triggered it either, which is why it sat here
unnoticed.

- **"No ending" is fixed**: that branch's `trim` was only shortening the video to
  `footage_end`, which the `-t out_dur` on the OUTPUT already does. Trim dropped,
  verified for 0/1/2/3 strips.
- **`over_black` keeps its trim, and 2+ strips are REFUSED.** That branch needs a
  cut before `tpad` can add the black tail, and every trim-free variant tried —
  demuxer `-t` on the source, a front trim on `[0:v]`, an opaque black-plate overlay
  from `at`, bounded `-loop 1` stills, capped PNG-sequence inputs — **deadlocks
  ffmpeg** (0% CPU at ~50%, parent still reading the progress pipe). The trim is
  what makes that graph terminate. So `render()` raises a clear error instead of
  shipping a short video, and the Edit tab warns before you press render.
- **The proper fix is a second pass.** `finish.py` composites the body and then the
  ending in *two* ffmpeg runs, and it handles two strips with every ending (verified).
  Giving `social_brand.py` the same two-pass shape would remove the limit and the
  guard together. Left as the next job — it touches the caption/LT/logo timing that
  the statement pipeline depends on, so it wants its own change, not a rider on this one.

Verified across {0,1,2,3 strips} x {none, over_black, over_footage} on both renderers.

## 2026-07-21 — Installers stop the engine before replacing it (the stranded-install fix)
Colleagues kept ending up on old versions after "updating". Root cause, in both
installers: they replaced the code on disk **while the engine was still running**.
The engine is detached and stays up until logout, so it kept serving the previous
version from memory — the install looked like it worked and the app still reported
the old number. On Windows it was worse: a live `python.exe` holds file locks, so
`rmdir /s /q` half-failed and left a MIX of old and new (one PC ran 0.5.3 with
0.6.0 on disk).

Both installers now `stop the engine first` — `install.sh` (Mac) and
`get/Install OCHA QuickVid.bat` (Windows). Same subroutine shape as the launchers:
find whatever listens on 17870, kill it, wait for the port. On Mac it escalates to
`kill -9` after ~6s; on Windows the delete is retried and then **verified**, and if
the folder is still there the installer stops with "restart Windows and run this
again" rather than producing the mixed install.

Also landed:
- **`--fresh`** on both (`| bash -s -- --fresh`, or the .bat with the argument):
  throws away `.venv` so the Python environment is rebuilt. The speech model
  (~500 MB, in `~/.cache/huggingface`) and the fonts live OUTSIDE the app folder,
  so a fresh install never re-downloads them.
- **Guards before any delete.** Refuse if the target isn't exactly `$DEST/app`, or
  if `DEST` collapsed to `$HOME` or `/` — an empty variable there would take out a
  user's files. And nothing is deleted until the download is confirmed to contain
  a `VERSION` file, so a truncated zip or a 404 leaves the install untouched with a
  readable message instead of a raw `ditto`/`tar` error.
- **A half-moved `.venv` is binned rather than carried over** — a broken
  environment in the new install is worse than a slow rebuild.
- `get/Install OCHA QuickVid.command` (the unlinked Mac double-click installer) is
  now a thin wrapper around `install.sh`. It had its own drifting copy of this
  logic; a fourth copy was how the fix would have been missed next time.
- `tools/qv-doctor.sh` gained a **running-vs-on-disk version check**, which names
  this exact failure, plus the `--fresh` reset command at the end.

Verified on Mac end-to-end against a scratch install root: clean install, update
(code replaced, `.venv` kept, stale files gone), `--fresh` (venv dropped), a live
engine actually stopped, the path guard refusing a mangled target, and both
download-failure paths leaving the existing install intact. The Windows script is
reviewed but NOT executed — it needs one run on a real PC.

## 2026-07-21 — The project folder is REQUIRED on both tabs
Both tabs write everything into a job folder (`export/`, `source/`, `info/` + the
autosaved project file), so neither will start work without one. Pressing an action
with no folder picked stops, turns the folder block red — input border, picker
button, a `required` tag on the label — and shows the message **next to the field**,
not only in the status line further down the page. Focus moves to the name field and
the block scrolls into view.

- **`browser/field.js`** owns the behaviour (`OchaFolder.mark` / `OchaFolder.block`)
  and both tabs call it — same rule as the location strip: one implementation, no
  drift. It derives the input and the `.field-err` message from the block element, so
  the two tabs need no matching ids.
- **Titles & branding** gates "Add titles & branding".
- **Edit a video** gates the UN Web TV **download**, the **local file pick** and the
  **render**. The folder block is step 1 and the download lands in `<folder>/source/`,
  so the check belongs BEFORE a multi-minute fetch, not after it.
- The red clears when a folder is picked, when a saved project is reopened (that
  sets the folder too), and whenever a guard passes — it can never be left stale.
- Colours come from the app-kit `--err` token; the status alert uses
  `cd-alert--error`. Note `ALERT`/`stStatus` key it as **"error"**, not "err" — the
  wrong key silently renders an unstyled alert.
- Both hints used to end "Optional: skip it and files go to a temporary spot".
  Removed — it contradicted the requirement.

## 2026-07-21 — Text on screen: three lines, no Range Selector
The text template is now **three independent text layers** ("Line 1/2/3"), each with
its own EGP field and its own keyframes, replacing the single multi-line layer driven
by a Range Selector "based on Lines".

**Why the rewrite, not a tweak.** The selector approach worked but made the whole
template hostage to one obscure property path — `ADBE Text Range Type2`, which lives
in the selector's *Advanced* group, not on the selector. When that lookup failed the
builder logged a line and quietly dropped to a whole-block reveal whose **exit was a
plain fade** with no downward move. That is exactly the symptom reported ("out
animation shouldn't be fade only"), and a silent fallback is the worst way to ship it.
Three layers need no selector at all:
- the stagger is explicit (`DATA.text.stagger`, 0.09s per line),
- the exit is guaranteed to be the entrance reversed — same rise, same fade, and the
  LAST line leaves first,
- and it gives the panel one field per line, which is what an editor actually wants.

**Empty lines close the gap.** Line 2 and 3 carry an expression that counts blank
lines above and shifts up one line height for each, so "line 1 + line 3" renders with
no hole. It reads `value`, so the keyframed animation is untouched.

Panel: the Text pane is three inputs instead of a textarea; `collectValues()` emits
`Line 1/2/3` and skips blanks. `host.jsx` needed no change — it matches EGP controls
by name.

**Needs an AE run** to regenerate the four Text MOGRTs before it does anything.

## 2026-07-22 — Overnight audit: one ending, place-only pins, dedupe, dead-code purge
A cleanup pass after many patches. Verified by reference-mapping (every endpoint vs
what the UI calls; every engine module vs its importers) and by re-running renders.

**Edit-tab "over black doesn't work" — the real cause.** It wasn't broken per se:
social_brand's single-pass graph REFUSED over_black + 2 location strips (the
trim/framesync limit), and Javi was testing two strips. Fixed by making the ending
one shared module:
- `engine/ending.py` — the OCHA ending (logo snap, black card, click), extracted
  from finish.py. BOTH pipelines call it. social_brand now renders over_black in TWO
  passes (body cut at `at`, 0-70%; ending appended, 70-100%), which removes the trim
  and the refusal. finish.py brands the whole clip then appends (21.5s for a 20s
  source); statement cuts to the selection first. Both verified with black-card +
  logo luma checks.
- Cross-platform bug found on the way: finish.py hardcoded `h264_videotoolbox`
  (macOS-only) — the Titles tab could never render on Windows. `vcodec_args()` now
  picks videotoolbox on Mac, libx264 elsewhere. And `ffprobe_of()` existence-checks
  the sibling ffprobe (the imageio ffmpeg ships none), falling back to a system one.

**Location pin, place-only.** `pin_locator.build()`: no date -> the box collapses to
the single visible band and the pin scales from that (smaller, centred on the line,
5% overlap) — numerically identical to the Premiere template (88px place-only,
160px two-line at 1920). `specs()` requires a place; date-only rows are dropped. The
UI (location.js) disables the Date field until a Place is typed. Two-line geometry
unchanged (checked field-for-field against the old build).

**Dedup — the UI now matches the engine's one-module discipline.**
- `browser/lowerthird.js` — lower-third rows were copy-pasted into app.js and
  statement.js and had drifted (defaults, alignment order). One component, per-tab
  defaults. Mirrors location.js and field.js.
- `engine/mediakit.py` — COLOR, the logo paths, BUG_HEIGHT_FRAC, SAFE_AREA,
  `rotation()`, `ffmpeg_hdr()`, `to_sdr()` were duplicated between finish.py and
  social_brand.py, each labelled "keep in sync". Now one source.

**Deleted (dead, git keeps history):** `app/web/` (the retired original UI, 21
files); the legacy wizard surface — `/api/config`, `/api/transcribe`, `/api/render`,
`/api/jobs/{id}/transcript`, engine_bridge's transcribe/render, and
engine/{transcribe,cut,run,render,reframe}.py (the statement pipeline supersedes
them); `browser/test_prores.mov` (13 MB); `opencv-python-headless` +
`python-multipart` from requirements (only the deleted reframe / instruction-POST
used them).

Web app now: FastAPI backend + a static SPA of four shared JS components (field,
location, lowerthird, + the two tab controllers) over an engine of focused modules
(statement -> social_brand + ending + mediakit; finish -> the same; pin_locator,
lower_third, svgpng, webtv). No module or component is defined twice.

## Caption editor — review the words before they burn (2026-07-22, v0.11.0)

Whisper mis-hears the odd word, and until now it went straight into the video.
Both tabs can now REVIEW the caption text before rendering; timing stays the
engine's.

- ONE shared UI component (`browser/captions.js`), mounted by both tabs — the
  share-don't-duplicate rule. Rows = mm:ss + an editable text box; clearing a
  line drops that caption (social_brand treats "" as a boundary).
- ONE engine path: `statement.cues_preview()` (build_runs → cues_from_runs with
  the same `sub_config`) is asserted equal to what `do_render` burns, so the
  review is never a lie. Titles-tab cues still come from `cues_real_timeline`.
- Flow: Edit tab → `POST /api/statement/cues` (instant — words are already
  transcribed). Titles tab → `POST /api/captions` (a transcribe job, so the
  wait moves BEFORE the render); the reviewed cues ride back on the render
  request (`cues: [[start, text], …]`) and the engine skips re-transcribing.
- Staleness: edits carry a fingerprint of the inputs (video path / selection +
  format). If the cut changes, `collect()` returns null and the engine builds
  fresh automatic captions — one clip's text can never burn onto another cut.
- Compatibility: engines < 0.11.0 silently IGNORE `cues`, so the page
  feature-gates the editor on the engine version instead of hard-gating
  (`ENGINE_MIN` stays 0.5.0).

## Footage looks + the phone-colour fix, completed (2026-07-22, v0.12.0)

A "Look" row on both tabs — named presets only (Original / Brighter / Punchier /
Auto-balance), no free sliders to push a video off-brand. Applied FIRST in the
filter graph, under every overlay, so captions/logos/strips are never re-graded.

- ONE preset table: `engine/look.py`; every renderer asks it for the chain
  (social_brand + finish inline; the statement cut passes it through to
  social_brand). ONE UI component: `browser/look.js`, mounted by both tabs.
- Picking is visual: `/api/look-preview` renders one still per preset with the
  SAME conversion + chain the render uses (`mediakit.to_709_vf` is shared by
  to_sdr and the preview, so the preview can't lie).
- **Phone colours**: the old HDR tonemap gate grew into `mediakit.normalize_709`
  — one shared gate that now also catches TAGGED wide-gamut SDR (Display-P3 /
  BT.2020 primaries: the "OCHA blue looks off" iPhone case) automatically, and
  offers a user-forced "Fix phone colours" for untagged clips (zscale must be
  told `min/tin/rin/pin` explicitly — with only `pin` it fails "no path between
  colorspaces"). The statement cut now converts the SOURCE before cutting and
  carries bt709 tags through (`mediakit.COLOR` on the cut encode), with
  phone_fix defused downstream so social_brand can't remap a second time.
- Compatibility: engines < 0.12.0 ignore the `look` field → the page
  feature-gates the row by engine version (same pattern as the caption editor).

## Toolbox tab + the video compressor (2026-07-22, v0.13.0)

Third mode tab — quick utilities that deliberately need NO project folder. First
tool: **Compress video** (a heavy file → the lightest H.264/AAC MP4 that still
looks right; H.264 because a distribution copy must play everywhere).

- `engine/compress.py`: single-pass libx264 **CRF** (constant quality — the
  right tool for "best quality, lowest weight"), `+faststart`, AAC 160k, and the
  shared `mediakit.normalize_709` gate first (HDR/wide-gamut phone footage must
  look right on every screen). Levels named by OUTCOME, not jargon:
  best (CRF 18, keeps res) · balanced (CRF 23, 1080p cap, recommended) ·
  smallest (CRF 28, 1080p cap). The 1080p cap is on the SHORT side, so portrait
  4K becomes 1080x1920, not a 607px sliver.
- Output lands NEXT TO the original as `<name>_compressed.mp4`, numbered if
  taken — never overwrites, no job folder. The result headline is the point:
  "812 MB → 74 MB (91% smaller)".
- `/api/compress` job + `/api/statement/probe` now reports `bytes`;
  `/api/preview` learned the `compress` job kind.
- The whole tab is feature-gated on engine ≥ 0.13.0 (same pattern as captions
  and looks); `stShowPanel` grew a third panel.
- Measured: 86 MB test → 34 / 4.3 / 1.5 MB across the three levels; 4K portrait
  → 1080x1920; second run → `_compressed_2.mp4`.

Premiere plugin gets the same tool next (AME `app.encoder.encodeFile` spike +
three bundled .epr presets; fallback = hand the file to this web tool).

## 2026-07-23 — Plugin captions fixed by FILE FORENSICS, not guesswork (v0.42.0)

Javier: "the boxed style doesn't install properly — it didn't pick the box" +
"lower third / text must never overlap captions".

**The box was never in the file.** A `.prtextstyle` is a mini Premiere project;
the styling lives in ONE base64 "Source Text" FlatBuffers blob. Decoding both
bundled styles showed "OCHA Boxed" (404 bytes) was structurally a SUBSET of
"OCHA Clean" (408) — different font weight, no background section at all. So
Premiere installed and applied it faithfully; there was no box to apply. Fix:
Javier re-exported the style from his original template (Raleway **Medium 48**,
box on — the new blob is bigger than Clean, with the background flag + pad/radius
values) and the re-export replaced `premiere/cep/caption-styles/OCHA Boxed.prtextstyle`.
Diagnosis rule that paid off: when "X doesn't apply", decode the artifact before
blaming the applier.

**Defaults now clear the caption zone.** Premiere captions sit in the bottom
~10% region and can't be moved by style or script, so the branded elements move
instead: each format bakes `cap_clear` (fraction of H reserved for captions =
0.10 margin + 2-line 44px boxed block + breathing room; see make_assets.py) and
`buildLT` clamps the block bottom to `H*(1-cap_clear)` — square 950→821,
event 961→821, reels/feed45 already cleared. Text `y_frac` went per-orientation
(square/landscape 0.56→0.52) so even a 3-line block clears. Title lines also got
bigger: `org_scale` 0.5909→**0.66** in brand-lt.json (web app to be re-aligned —
statement.py PRESETS hardcode their own LT sizes; noted in memory).

**"Title line 2 (optional)" → "3rd line (optional)"** (Name = 1st line). Renaming
an EGP control breaks the panel against clips placed with the old template, so
host.jsx grew `OCHA_FIELD_ALIAS` (writers fall back old-name) and `FIELD_OF`
maps BOTH names to `lt-title2` (readers accept either).

**Caption position is NOT scriptable — measured, PPro 26.3.0.** A temporary
read-only probe (reflection + captionTracks + selection + QE; removed after)
showed: a selected caption cue DOES reach `getSelection()` (TrackItem
'SyntheticCaption', type=1) but exposes `components: 0` and
`getMGTComponent: null`; `seq.captionTracks` undefined; only
`createCaptionTrack` exists; QE side nothing. So there is no property surface —
a "position captions" button is impossible today. Also documented: installed
styles appear ONLY in the **Style browser (Local)** — the plain Track Style
dropdown lists project styles, ∅ until a style is used once.

**Caption position GUIDES instead (Javier's idea, same day).** If the plugin
can't move captions, it can install Program Monitor **guide templates** marking
where the user should drag them — and those turned out to be file-installable:
`<Documents>/Adobe/Premiere Pro/<major>.0/Profile-<name>/Installed Guides.guides`
is plain JSON. Measured with a saved `test-h` guide: `orientationType 0` =
horizontal, `positionType 0` = pixels (floats fine), colors 0-1 floats, and
Premiere writes the file on template save. New Captions tile "Caption position
guides" → `ochaInstallCaptionGuides()` eval-parses the file, drops OCHA-named
templates, appends 4 fresh ones ("OCHA Captions - <format>", OCHA-cyan lines),
rewrites — the user's own templates untouched, unparseable files skipped, and a
one-time `.ocha-backup` made first. Bands (caption box between the lines):
square/event **832-974** (Javier's original template — matches the Premiere
default zone `cap_clear` was derived from), reels **1190-1300**, feed45
**837-914**. Portrait is the tight one — captions sit BETWEEN Text (above) and
the LT (below), and the 2-line-Text/2-line-title slot was only 108px, so
"option 3": portrait Text `y_frac` 0.56→**0.52** (all orientations equal now)
and the reels band placed at 1190/1300 → ~50px clear of 2-line Text, ~24px
clear of a 2-line-title LT. A 3-line Text + captions can NEVER share a reel's
lower-middle — editorial choice, not a numbers problem. Usage: View > Guide
Templates > pick the format, drag captions in Properties > Align & transform;
guides never export.

**Middle gradient (same day).** The readability gradient learned a third
position: a SECOND Linear Wipe on the same solid — wipe 1 clears above the band
(angle forced 180), wipe 2 below it — leaving feather-dark-feather centred at
`gradient.mid_center` (0.5, so the band spans 27.5–72.5% of H) with per-edge
feather = the one-sided fade / 2. Two wipes compose multiplicatively, so no new
layer machinery. Pairs with the mid-frame caption band on reels. Panel Position
segment gained **Middle**; host `OCHA_BOOL` gained the checkbox; "Full screen"
still overrides everything.

**Guides aren't scriptable either (same day).** Javier's test found the
installed templates only appear after RELAUNCHING Premiere (the wrench menu
reads `Installed Guides.guides` at launch), so he asked for live per-sequence
guides instead. A second probe (`ochaProbeGuides`, removed after) dumped the
FULL reflection member lists — DOM Sequence 57, DOM Project 52, QE sequence 88,
QE project 58 — and nothing guide-related exists anywhere; all candidate names
(`addGuide`, `guides`, …) undefined on both sides. Live guide creation is
impossible in 26.3; the template file stays the only route, with its one-time
"install + relaunch once" cost.

**Portrait correction from the official template (same day).** Javier's
screenshot of the OFFICIAL template settled the portrait stacking question the
other way from my "option 3" reading: the LOWER THIRD sits ABOVE the captions
(caption box in the guide band 1190-1300, LT ending ~30px above it) — same
arrangement as square/event, not the web-app-style captions-above-LT I had
assumed. So reels/feed45 `cap_clear` went 0.188/0.216 → **0.396**: LT block
bottom reels 1498→**1160**, feed45 1053→**815** (1-line-title LT top ≈1027 —
matches the official template's measured ≈1031). Consequence: with BOTH Text
and LT on a portrait frame, 2+-line Text can reach the LT zone — they rarely
co-occur (Text lives on b-roll, LT on the speaker) and either drags off the
other in Properties; captions-vs-LT, the pair that always co-occurs, is now
collision-free by default in every format.

**Guides auto-install (same day, Javier's call).** Since the templates only
load at Premiere launch, the panel now SILENTLY installs them at boot — once
per panel version (`localStorage ocha-guides-installed` = PANEL_VERSION, set
only on an OK result; re-runs on version bumps so updated band values ship).
By anyone's second session the templates are just there; the Captions tile
stays for status, reinstall and the how-to, and its copy now says templates
appear after the next restart. Also ruled out: programmatically opening
View > Guide Templates and picking an entry — Premiere has no menu-invocation
API, and the submenu is dynamically generated, so its entries have no stable
command IDs even for the undocumented command-runner tricks.

**0.42 sweep-up (same day).** (a) The Toolbox "Compress a video" tile was NEVER
wired — `TOOLS.webapp` (modal, CTA, `openExternal`) existed but the
`addEventListener` line didn't, so the tile silently did nothing; one line
fixes it, and the modal now says up front that it leaves Premiere + shows the
URL. (b) Captions steps rewritten to five short plain lines — the detail lives
in the tiles' modals. (c) LT title rows got PER-ROW cyan bands (band 1 = the
row that renders first, band 2 only when both lines are filled; zero-size hides
a band, one max-width matte still wipes the block; centred mode centres each
row on its own width) — a lone max-width band left the shorter line with a cyan
overhang. The web app still draws the max-width band
(`engine/lower_third.py` ~93, `browser/engine.js`) — noted for the web-app
review.

**Position sliders return (same day) — position only, absolute px, hard caps.**
The 0.37.0-parked "Size & position" section is back as **Position**: Horiz +
Vert sliders whose min/max ARE the frame, ±1px arrow nudges at the slider ends,
and an editable px field that snaps back into range on commit — three input
routes, one clamp (`clampPos`), plus the host clamps again in
`ochaWriteMotion`/`ochaApplyMotion` as the hard cap, so a clip can never leave
the comp. Semantics changed from the old offsets to **absolute comp pixels**
(the same numbers as Effect Controls > Motion > Position; default = frame
centre) — that's what makes "sticks to the limits of the comp" natural, and
users can cross-check against Premiere directly. Scale stays parked: the Size
row is hidden, no `@scale` is ever sent, and the 0.37.0 anchor-disagreement
note still applies to any future scale revival. Selection-aware: `syncAdjust`
(900ms, restored) binds the sliders to a selected OCHA clip (live writes,
debounced 100ms), skips while dragging or typing, and unbinding RESETS to
centre so the last clip's position can't silently ride into the next Add.

Two bugs Javier caught in the first cut, both now load-bearing comments:
(1) the parked Size row was "hidden" with the HTML attribute, but
`.adj-row { display:flex }` BEATS `[hidden]` — parked rows must be DELETED,
not hidden; (2) Motion > Position is **normalized in the API** (fractions of
the frame, [0.5,0.5] = centre) while Effect Controls displays pixels — writing
raw px multiplied by the frame (panel 6 → Premiere 6480 = 6×1080). The px⇄
fraction conversion now lives at the host boundary in all three sites
(`ochaReadMotion`, `ochaWriteMotion`, `ochaApplyMotion`).

**Round 3 — the clamp moved INTO the templates (Javier's third catch).** Even
converted, Motion moves the clip ANCHOR, which knows nothing about the element:
on square the LT's left edge left the frame below anchor-x ≈454 (his measured
446) while anchor 0..1080 was still "in range", and anchor-y 0 didn't put the
element at the top. The element's bbox depends on typed text, and Premiere's
API exposes no rendered bounds — so the only place that CAN clamp exactly is
the template, whose expressions already measure text (`sourceRectAtTime`).
`sizeGroup` therefore grew **"Position X/Y" sliders** (element's LEFT/TOP edge
in comp px; defaults = the designed spot) and a position expression that
computes each element's real bbox — per-builder bounds: LT = visible bands
union (centre-align aware), pin = icon+bands (toggle + single/two-line aware),
text = widest line × non-empty rows, bug/ending = static boxes — and clamps to
[0 .. comp − element]: **0 = flush with the edge, and the element can never
leave the comp, whatever the user typed.** The panel/host now write those
template controls (`ochaPosParams`, template-first in
read/write/`ochaApplyMotion`); clips from OLDER templates fall back to the
normalized-Motion path. The Position UI also became its own layer-2 card —
second-level settings, visually separated. Scale stays parked throughout.

**Round 4 — Premiere clamps MOGRT sliders to their declared range.** First AE
build of the position controls put the LT at the TOP of the frame and the
sliders "barely moved": an AE Slider Control's default range is 0-100, Premiere
enforces it on MOGRT params, and AE scripting cannot widen it — so the LT's
720px default collapsed to 100 and every panel write past 100 was clamped.
Fix: the template sliders speak **percent of frame** (0 = left/top edge,
100 = right/bottom), converted to px inside the expression; the host converts
px⇄percent at its boundary so the panel (and the user) still see pixels. The
element-exact bbox clamp is unchanged — percent only changes the wire format.

**Round 5 — static defaults vs moving design positions.** Centre align stopped
centring: the X slider's baked default is the LEFT-mode edge, but a centred
element's designed left edge is `(W−width)/2` — so the "absolute edge" offset
dragged the centred LT toward x≈86. Same class of drift: a 2-line title moves
the designed TOP, so the static Y default would pin the block top and grow it
DOWN past BOT. Fix in `sizeGroup`: **at-default = as-designed** (a slider
sitting exactly on its baked default contributes zero offset, so centring,
bottom-anchored growth and reflow stay pure), and **Centre align OWNS X** (the
LT passes a `lockXExpr`; the X slider is inert while centred — uncheck to take
manual control). Once moved, a slider is an absolute edge, clamped as before.

## 2026-07-23 — Web app 2026.0.14: aligned with the plugin, Text on screen, starter rename

The web-app half of the day's plugin standard (Javier's 5-priority list):

**1. One caption + LT standard, both products.** `statement.py PRESETS` now
carries the official-template numbers — captions Raleway Medium **48** at the
guide bands (box bottom: reels 1320, square/event 980, feed45 970; no more
bottom_hi lift — the LT sits ABOVE the captions in every format, portrait
included: lt.bottom reels 1160 / feed45 815 / square+event 821). LT name/org
sizes come from brand-lt.json ratios (per-format overrides deleted);
`lower_third.py` draws PER-ROW title bands (each hugs its own line — `ows`);
`finish.py profile()` gained the same `cap_clear` clamp the MOGRTs use; and
engine_bridge's Titles-path caption spec now derives from `PRESETS` scaled to
the video's real resolution (`preset_for()` = the plugin's aspect thresholds)
instead of ad-hoc fractions. VERIFIED by pixel-measuring engine renders:
square name band 688-741 / titles 744-819 / box 830-979; reels 986-1057 /
1058-1159 / 1170-1319 — the official template, to the pixel.

**2. Looks on the Edit tab** — already built (stLook mounts in the wizard,
`.look-review` gates both tabs together at engine ≥0.12); it only LOOKED
missing behind an old engine.

**3. Starter renamed** "Start OCHA QuickVid" → **"OCHA QuickVid"** (.command,
.bat, the get/ downloads, install.sh app bundle + CFBundle names, qv-doctor,
README, page copy). install.sh removes old-named launchers on its next run;
old deployed starters keep working and simply stop self-renaming.

**4. Text on screen** — `engine/text_on.py` mirrors the plugin's OCHA Text
(make_assets DATA.text: ratios, y_frac 0.52, rise/stagger/enter/exit, Raleway
Bold) as PNG strip sequences, and social_brand drops the MID readability band
(feather-dark-feather, the plugin's Middle gradient) behind it AUTOMATICALLY,
fading with the block. Spec: `texts:[{lines,start,duration}]` — statement
forwards it, engine_bridge routes texts-only Titles jobs through social_brand
WITHOUT transcription (`subs_on` guard). UI: shared `browser/texton.js`
mounted by BOTH tabs, gated `.texton-review` ≥2026.0.14. VERIFIED: reels
render shows 3 lines at baselines 998/1114/1230, band luma 86→50→14→50→86.

**5. Versioning** → **2026.0.14** (plugin-style CalVer; counter continues
0.13). Starter's `sort -V` and app.js `cmpVer` both cross the boundary fine.

## 2026-07-23 — Web app 2026.0.15: OCHA footer + Help & reinstall (the deleted-launcher fix)

Javi deleted the launcher to pick up the rename, then couldn't get it back: the
engine kept running, so the page unlocked and HID the install flow — a dead end.
Root cause is by-design (engine up = "you're set"), so the fix is a persistent
place to reinstall from, in every state.

Chosen (AskUserQuestion): a **footer**, following the OCHA DS, using the
wordmark-generator's `cd-footer` as the reference (Javi: better than the
Storybook standard). Kit-first (his call): added **`cd-footer`** to the shared
app-kit — institutional band (Service provided by + OCHA logo / mandate tagline
/ CC BY 4.0) + an optional `.cd-footer__utility` row for app links + a
`.cd-footer__status` chip — synced to QuickVid, CHANGELOG v0.2.0, HANDOFF h8 for
the DS session. QuickVid fills the utility row with **Engine status** (live from
/api/health), **What's new** (modal, plugin parity), **Help & reinstall**
(modal: the `curl … | bash` one-liner + copy + "engine won't start" steps — THE
fix), **Donate** → crisisrelief. The one-liner also still sits on the
engine-down gate card. Footer is blue in light + dark (brand, like the
reference), stacks on mobile. VERIFIED via computed styles: bg #009EDB, white
text, inverted logo, live chip, modal opens with the exact install command,
mobile stacks to column, engine-down → amber dot. Version → 2026.0.15. **Colour follow-up (v0.2.1 / web 2026.0.16):** the band is the DS-standard **dark blue** `--ocha-blue-footer` #1f69b3 with the 8px `--ocha-cyan` bar on top (matching the wordmark-generator footer) — white text went from ~2.6:1 on the bright cyan to 5.63:1 (AA). Kit token added; synced to all apps.

## Still open
- Location pins (feature 3 of Titles & branding) — new SVG animation, same framework.
- Promote the `style.css` OCHA app kit token block into `…/OCHA_design_system` as the
  shared app starter, so new tools don't re-derive it.
- Confirm `name_navy` (#0A1E3F placeholder) for the name-strip text color.
- Crisp logo from SVG: `brew install librsvg` then rasterize (Quick Look flattens
  the white logo onto white). The PNG used now is identical at 70px height.
- ~~Caption-vs-name-strip rule~~ — **resolved 2026-07-09** (captions lift while a lower
  third is up; see the social-branding entry above).
