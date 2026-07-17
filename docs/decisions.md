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
the root). We can patch it perfectly — `premiere/plugin/rifx.js` +
`premiere/plugin/tools/rifx_patch.py` produce a byte-correct capsule
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

## Still open
- Location pins (feature 3 of Titles & branding) — new SVG animation, same framework.
- Promote the `style.css` OCHA app kit token block into `…/OCHA_design_system` as the
  shared app starter, so new tools don't re-derive it.
- Confirm `name_navy` (#0A1E3F placeholder) for the name-strip text color.
- Crisp logo from SVG: `brew install librsvg` then rasterize (Quick Look flattens
  the white logo onto white). The PNG used now is identical at 70px height.
- ~~Caption-vs-name-strip rule~~ — **resolved 2026-07-09** (captions lift while a lower
  third is up; see the social-branding entry above).
