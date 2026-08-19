# Decisions log

Decisions locked during the build, with the reasoning, so the next person
(or future me) doesn't relitigate them. Append-only.

## 2026-08-06 — Square captions use the CLEAN style (web app 2026.0.34, plugin 2026.0.53)

The video team's standard, reported by Javi: square videos use the clean caption
look (white text over a soft gradient), not the grey box. Confirmed as a standard,
not a preference, so the default and the wording both changed. Reels and 4:5 stay
boxed - that is the muted-scroll case the box exists for.

The standard is now: **boxed** = reels, feed 4:5 · **clean** = square, event.

Shipped as two releases on Javi's call, a few minutes apart: the PLUGIN first
(2026.0.53, guidance copy only), then the WEB APP (2026.0.34, where the automatic
behaviour lives). Worth noting the mechanics - a push to main auto-deploys the web
app, so shipping "the plugin only" meant committing premiere/cep on its own and
holding browser/ and engine/ back uncommitted, rather than letting them ride along
on the plugin's push.

**The rule lived in four places, three of which the engine could not see.**
`sub_config()` lets an explicit style override the preset, and the web app always
sends one - so changing `PRESETS["square"]["sub"]["box"]` alone would have changed
nothing for any web-app render. The UI defaults are what actually decide.

Now there is ONE map, `OchaCaptions.styleFor()` in the shared caption module, read
by both tabs; `engine/statement.py` mirrors it and both carry a comment saying to
change the other. A third copy of the w/h thresholds went in beside it
(`fmtFromSize`), matching `preset_for()` and `ochaFmtFromSize()`.

**A bug this uncovered, older than the request.** The Titles tab NEVER picked a
caption look from the video at all - it was hardcoded to boxed. Brand a finished
16:9 event clip there and you got boxed captions, while the Edit tab gave the same
footage clean ones. It has been wrong for every format since it shipped, not just
square. It now probes the source and picks from its shape, and a manual choice is
never overridden afterwards (`tSubsTouched`).

**The buttons were renamed for what they LOOK like.** "Social - boxed" and
"Event - clean" tied the names to formats, so "Event" stopped being true the moment
square moved. They are now **Boxed** and **Clean**, with the format guidance in the
hint underneath - which is the part that changes when a standard does.

**The plugin needed no code.** It installs both styles and the user picks in
Premiere's Style browser (captions are not scriptable - the known limitation), and
its caption guides are position-only, with square already sharing the event band.
Only the guidance changed: the tool never said which style went with which format,
and now it does.

**Method note.** The question "does clean actually look right on a square?" was
answered by rendering both, on real footage, through `brand_preview.py` - the same
graph that burns the captions. That is what the preview work was for.

**One place was missed and shipped wrong: the format CARD.** 2026.0.34 went live with
the Square card still reading "1:1 · boxed captions" while the app behaved correctly.
Corrected in 2026.0.35. The lesson is about where a rule hides: I swept the style
BUTTONS and their hints, but each format card carries its own one-line summary of the
same rule, and nothing links the two. When a standard changes, grep for the VALUE
("boxed", "clean") across markup, not just for the control that sets it.

**A scripted-replace near-miss worth remembering.** Retargeting the init call
`stSetSubStyle("box");` hit the FIRST occurrence, which was inside the Boxed
button's own handler, and the inline `//` comment I added then swallowed the rest
of that line. The assertion passed - the string existed, it just was not the one I
meant. Anchor on a full line (leading and trailing newline) when a short statement
appears more than once, and never append a `//` comment to a line that continues.

## 2026-08-06 — Landscape to reel, and reframing by razor (plugin 2026.0.49)

"Square to Reel" becomes **"Turn into a reel"** and accepts landscape. One tool,
no format question: the active sequence already says what it is.

**Two shapes, two recipes.** Anything NOT wider than tall (square, 4:5) is
FILLED: the old nest-twice recipe, blurred copy behind. Landscape is CROPPED to a
9:16 slice, no blur, no bars. `ochaReelFills()` is the single place that decides,
so the size formula, the routing and both guards cannot drift apart. That split
came out of a bug I found before the reviewers did: 4:5 was routed to the crop
path, which turned a 1080x1350 source into a **1350x2400** sequence, upscaling the
width of a shape that only ever needed height.

**The landscape path does not nest, on purpose.** Nesting is right for a square
(the whole square stays visible), but a cropped landscape keeps only ~32% of the
width, so a graphic near a 16:9 edge would be sliced off *inside* the nest where
nothing can reach it. So it CLONES the sequence: the clips stay real and razorable,
the original is untouched, and the graphics can be re-placed properly.

**Graphics are re-placed, never nudged.** A 16:9 lower third moved into a 9:16
frame is still a 16:9 lower third. Each element is read (type, every control,
in/out, track), removed, and placed again from the REELS template through
`ochaAdd` — the panel's one placement path. That is what "adapted to the new
composition according to the standards" has to mean.

**Reframing: razor, not in/out points.** The crop is centred by default because
where to look is a judgement no script can make. The user razors the shot and
slides it — the same interaction as the Colour tool, so there is one thing to
learn. A second in/out mechanism inside the panel would be an invisible razor
next to the timeline's visible one. HOLD is static; PAN keyframes a deliberate
move across the shot (Javi asked for it mid-build; my earlier objection was to
*automatic* tweening between framings, which is a different thing).

### The review pass, and what it caught

Javi opted into an adversarial review before testing: 5 lenses, every finding
independently refuted-or-confirmed. **38 raised, 16 confirmed, which collapsed to
5 distinct bugs** (the lenses kept rediscovering the same ones). All were in code
I had just written and all would have surfaced in his first test as something
that "sometimes works":

- **Tick strings compared with `>`.** `e.end > e.start` on `Time.ticks` is a
  LEXICOGRAPHIC compare — ticks is a String. At 254016000000 ticks/sec the digit
  count rolls over near 3.9s, so a graphic running 1s–5s compared *false* and
  silently kept the template's default duration, while 0s–2s worked. 19% of a
  realistic 0–60s grid failed, concentrated on the most typical lower third.
  Now `parseFloat` both sides, matching `ochaSelectedFade`'s existing precedent.
- **Clip identity by name.** Razoring — the workflow this feature *tells* you to
  use — gives every piece the same `clip.name`. The panel keyed on it, so piece 1's
  numbers stayed on screen while piece 2 was selected, and one click on the mode
  buttons then wrote them onto piece 2 (planting an unrequested pan if piece 1 was
  panning). Identity is now START TICKS, which is what the rest of the file
  already uses.
- **Pan keyframes at sequence time.** Keyframes on a TrackItem's parameter are
  CLIP-relative; `clip.start`/`clip.end` put both keys outside the clip's own
  range, where the pan did nothing and still reported OK. Now `inPoint`/`outPoint`.
- **Non-text controls dropped.** The reader skipped every non-string control, so
  a gradient tuned to 40% came back as the stock bottom scrim, a location strip
  lost its pin colour and icon, and Size/alignment reverted — silently, under a
  "replaced=N" success line. `ochaTextOfClip(clip, includeAll)` now captures
  everything for migration and text-only for the panel's fields; `ochaAdd` already
  coerced bool/num on the way back in, so it is symmetric.
- **Every success painted a red error.** On success the panel re-reads
  `ochaReelInfo()` — but the active sequence is now the reel it just built, so the
  old "already a reel" ERR overwrote the success line. Already-a-reel is now a
  STATE (`OK|…|0`, `countGated` greys the CTA) and the reframing controls stay
  usable, which is exactly what someone coming back to fix a shot needs.

Also surfaced and handled: a **keyframed Scale** (an animated push-in) silently
ignores `setValue`, so those shots would keep their old scale and show black bars
while being counted as scaled. They are now detected and reported rather than
miscounted.

**What the review is worth, honestly:** it cannot tell whether the crop lands
where a human would put it, or whether the reel *looks* right — that is still a
Premiere test. What it did was stop five defects that would each have read as
"sometimes it works", which is the most expensive kind of bug to debug from the
outside.

### Round 2, from Javi's first real test (2026.0.50)

It worked; seven changes came back. The ones with a decision in them:

- **Gradients are left out by default.** A readability gradient is sized for the
  frame it was made in, so most need re-making after a crop. It is a ticked
  checkbox, not a silent removal — and it is offered ONLY on the crop recipe,
  because the fill recipe nests the source whole and its gradients live inside the
  nest where no script can reach them.
- **Premiere's own Text-tool graphics cannot be fixed, only reported.** They are
  positioned in absolute pixels against the old frame and have no template to be
  re-placed from, so a 9:16 resize leaves them off-screen and a script cannot lay
  them out again. The tool now names them and points at the panel's own **Text on
  screen** element, which does convert automatically. Detected by having no media
  file behind them.
- **Zoom 0-200%, and travel that follows it.** Zooming in shows less width, so
  there is more of it to slide; travel is derived at the clip's CURRENT scale, not
  only at the fill scale, or the slider's ends stop matching the picture as soon
  as Zoom leaves 100%. The range starts at 0, not 100: a transparent overlay or an
  animation often needs scaling DOWN. Below 100% there is no overflow to slide, so
  travel falls back to half a frame either way rather than freezing the position
  slider at zero.
- **Slider direction was set by TEST, not by reasoning.** Motion Position X grows
  to the right, so adding the offset *should* move the picture right — measured
  the other way round, so the offset is subtracted and the read-back carries the
  same sign. The comment says so at the offset itself; "fixing" it back to `+`
  makes the control fight the picture again. **Worth noting how this was nearly
  re-broken:** Javi reported it still wrong AFTER the flip was written, which read
  as "flip it again" - but he was testing 2026.0.49 and the flip only exists in
  2026.0.50. Flipping again would have restored the bug. Check which build a
  report came from before acting on it.
- **The tile says what it will do.** On a sequence that is already a reel,
  "Turn into a reel" becomes "Adapt clips to frame" and takes the accent colour.
  A tool whose job changes with the open sequence should not keep advertising the
  job it already did — and this is the path back to the reframing controls after
  the dialog was closed.
- **Undo: a real limitation, not a bug.** Premiere does not put panel-driven
  parameter changes on its undo stack, and there is no undo-group API in its
  ExtendScript DOM (unlike After Effects). The reset buttons are the escape hatch
  and the panel now says so in the tool.

Empty tracks are cleared after a conversion, through Tidy tracks' own remover, so
there is still one implementation of "remove a track" and its safety checks.

### The branding skill was renamed (2026-08-06)

`ocha-social-subtitles` -> **`ocha-video-branding`**. The name described one element
while the skill places all of them: captions, lower third, location strip, text on
screen, logo watermark, look, ending. Javi: "doesn't make sense to call it
ocha-social-subtitles when it's about branding a video."

Renamed rather than left alone because the NAME is what a person types and what a
reader trusts; the description already covered the full scope, but a skill whose name
contradicts its contents teaches the wrong mental model every time it is listed.

**Earlier entries in this log still say `ocha-social-subtitles` and are left as they
were** - this file is append-only history, and rewriting it would make the record lie
about what things were called at the time. If an old entry's pointer does not resolve,
it means this rename.

### The Toolbox got two sections (2026.0.52)

Nine equal tiles in one grid, ordered by when each was built, with no way in.
Now two groups, and the heading names the JOB rather than the tools:

- **Look & framing** - Turn into a reel, Colour, Readability gradient, Vignette.
- **Project & files** - Tidy tracks, Remove unused, Tidy project, Package project,
  Compress a video. The three tidies first, then the two that put something on disk.

Javi rejected a third "Deliver" group: Package project does not deliver anything,
it collects the project. Merging it into the housekeeping group and naming that
group for what it touches was his call and is the better read. "Project settings"
was considered and dropped - nothing in there is a setting, and the word would
make people expect preferences.

The rule sits on the heading itself (`.tool-group`, cleared on `:first-child`)
rather than being a separate divider element, so a group cannot end up without one.
The one-line description under each heading was cut on Javi's call: the heading
already says it, and this panel has been trimmed for text twice now.

**The CTA label goes through one `setCta()`.** `tool-webapp` opens a browser rather
than doing something in Premiere, so its button carries the external-link arrow
(FA Classic Regular `arrow-up-right-from-square`, inlined - the panel must work
offline). NINE places set that label as the modal re-reads its state, so routing
them all through one helper is what stops the icon appearing and vanishing as the
user moves around the dialog.

Two things this turned up:
- **`--border-subtle` does not exist** in the panel's CSS. It was written with a
  `var(x, fallback)` and would have silently used the fallback forever. Same class
  of mistake as the invented `--bg-input`/`--border` in the font picker: check the
  token exists, do not invent one and lean on the fallback.
- **A CSS-only change still needs the version bump.** `styles.css` is cache-busted
  with the panel version, so editing it without bumping means an already-loaded
  panel keeps serving the old file - the new rules were provably absent from
  `document.styleSheets` until the bump. Hence 2026.0.51 for what looks like a
  markup-only change.

**`tool-webapp` is misleadingly named.** The tile reads "Compress a video" but the
tool only opens the QuickVid web app in a browser; the compression happens there.
It sits in Project & files because that is where someone would look for it, but
the id and the label disagree, which will confuse the next person reading the code.

**Highest remaining risk:** the keyframe API (`setTimeVarying`/`addKey`/
`setValueAtKey`) is used nowhere else in this codebase, so Pan is unproven against
a real Premiere. It is guarded and reports its own failure, but it is the first
thing to check.

## 2026-08-04 — Element previews on real footage, and the web app reports usage (2026.0.33)

Closes the last four items of the 2026-07-30 feedback round (`docs/webapp-plan-2026-07-30b.md`).

**Previews (items 7 + 9 + 12) — rendered, never mocked up.**
Every branding element (lower third, subtitles, OCHA logo watermark, location
strip, text on screen, ending logo) now previews over a REAL frame of the user's
own video, on BOTH tabs — twelve preview points, one shared module.

The choice that matters: the preview is produced by `social_brand.render()` —
the actual production overlay graph — not by redrawing the brand in HTML/CSS. A
CSS mock-up would have been a second implementation of the OCHA brand and would
have drifted; `browser/brand-lt.json` exists precisely because two
implementations of one thing drifted once already. A preview that can lie is
worse than no preview.

`engine/brand_preview.py` gets there **without touching social_brand.py at all**:
pull one frame at time t (same colour normalization + Look the render applies) →
make a ~2s silent clip out of that single frame → run the ordinary render over it
with every element re-timed to 0 → read the frame once the entrance animations
have settled. `social_brand.render()` wants a video, and a looped still IS a
video, so nothing in the graph needs to know it is a preview. ~1.0s cold, 2ms
cached (`_brandprev_*.jpg`, keyed on the full spec, pruned with the others).

Two real bugs fell out of building it:
- `at = float(end.get("at") or footage_end)` — `or` on a numeric meant **at=0
  could never be expressed**, so the ending logo silently moved to the end of the
  clip. Live effect: `engine_bridge` clamps `at` to 0 for a clip shorter than the
  logo lead, and those put the logo at the END. Now `is None`.
- `stSetSubStyle` read `stBp` **before its `const` initialised**. A const read in
  its temporal dead zone THROWS rather than reading undefined, which killed the
  rest of statement.js and every listener it had left to register — the exact
  dead-panel class CLAUDE.md warns about, and the console showed nothing useful.
  The symptom that gave it away was a `ReferenceError` on an unrelated later
  const. Both registries are now declared above their first caller.
  **Diagnostic worth keeping:** to find a mid-file throw when top-level consts
  aren't reachable from the console, re-fetch the file and run it in a fresh
  scope — `fetch(f).then(r=>r.text()).then(src=>{try{(0,eval)(src)}catch(e){...}})`.

Item 12's vertical slider (`logo_y_frac`) is plumbed through BOTH ending paths —
`social_brand.py`'s over_footage branch (Edit tab) and `ending.py`'s
`add_ending()` (Titles tab) — because those are two implementations of one thing
and item 11 already caught them disagreeing. It applies over footage only; over
black there is nothing to avoid, so that stays centred whatever is passed.

**Layout sweep (item 4).** Five checkbox rows still had their explanation crammed
inline after the label (`Subtitles <span class=app-hint>— their words…</span>`) —
what makes a panel look crumbled. All five moved into the standard
`.opt-grid`/`.opt-card` with the hint on its own line. `st-4k-wrap`'s id moved to
the CARD so the "4K unavailable" dimming covers the hint too, and `st4kSync`'s
hint strings lost their leading em dash (they are no longer a continuation of the
label).

**Analytics (item 13).** The web app now pings the SAME Apps Script deployment as
the Premiere plugin, tagged `p=webapp`, landing on its own `Events Web App` tab —
Javi's call: one sheet, a tab per product, separate dashboards later. Sharing a
tab would have made every plugin figure jump the day the web app started
reporting, with the rows indistinguishable afterwards. **`p` absent means
`plugin`**, so every panel already in the field keeps logging exactly where it
did; do not make `p` required.

Because the app's headline promise is "your videos never leave your computer",
the one thing that does leave is spelled out in full in a **Privacy** modal in the
footer — the exact four fields, what is never sent — with the opt-out beside it
(`localStorage: quickvid.analytics.off`). Location is the browser's TIME ZONE, not
a geo-IP lookup: no third-party call. Beacon is an `<img>`, not fetch — no CORS
preflight to fail, and it cannot block the page.

Javi still has to **redeploy the Apps Script** (edit the existing deployment — a
NEW deployment gets a new /exec URL and every panel in the field is hardcoded to
the old one). Until then web-app pings land in `Events` with the plugin's.

**Also:** `APP_VERSION` in app.js now seeds `ENGINE_LATEST` instead of the two
being maintained separately.

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

## 2026-07-27 — Arabic rendering (2026.0.22)

Javi asked whether the web app does Arabic subtitles. Measured: it produced
**.notdef tofu boxes** — the engine bundles only Raleway, which has no Arabic
glyphs. Two independent failures behind that:

1. **cairosvg cannot SHAPE Arabic.** Given the right font it still draws the
   isolated letterforms in visual order — disconnected and reading backwards.
   **resvg** (already the no-Homebrew fallback) shapes via rustybuzz and applies
   bidi, so it renders correctly. Hence the ARABIC GATE in `svgpng.svg2png`: any
   SVG containing Arabic routes to resvg with the Arabic family appended to every
   `font-family` (`Raleway, Almarai`), whatever cairosvg is available. Latin-only
   SVGs keep the proven cairosvg path — verified byte-identical.
2. **Layout measured the wrong face.** Pillow measured Arabic against Raleway
   (1111px) while the render was 664px, so boxes and wrapping were sized for
   tofu. `svgpng.font_for(text, weight, latin_path)` now returns the face that
   will actually draw the text, used by all three `_mw()`s and `_sub_png`'s font.
   Pillow here has Raqm, so widths are properly shaped.

Almarai (OCHA's Arabic brand face, OFL) bundled in `engine/assets/fonts/` —
Regular/Bold/ExtraBold, mapped from the Latin weights (Almarai has no
Medium/SemiBold). Verified end-to-end: captions wrap and box correctly, the
lower third renders, and a full ffmpeg render composites both.

STILL OPEN: the lower third stays LEFT-anchored for Arabic — an RTL layout
would normally flip the whole block to the right of the frame. Javi's call.

## 2026-07-27 — Omission marker, Arabic RTL, translation, unlimited thumbnails (2026.0.23)

**The "[...]" marker now means "words were removed", not "there was a gap."**
It fired on a TIME gap (>=1.5s), so a 1.6s breath between two sentences kept
back-to-back produced a false marker. It now counts DROPPED SENTENCES: the UI
owns the full transcript, counts the unselected spoken sentences before each
kept one and sends them as `dropped`; the engine marks at
`OMIT_MIN_SENTENCES = 2` (Javi: one dropped sentence is usually a false start or
filler, not a break in the argument). `JUMP_GAP` still drives the punch-in —
the two used to share it, which was the bug. The very first cue is never marked
(the clip simply starts there). Verified: 2s pause + nothing removed -> no mark;
1 dropped -> no mark; 3 dropped -> mark; first cue -> never. Per-cue control
already exists: the caption editor lets you type or delete the "[...]" yourself.

**Arabic lower thirds MIRROR.** `lower_third.build()` detects Arabic in the copy
(no user flag to get wrong) and sets `rtl`; `svg()` then anchors the bands to the
RIGHT of the block, right-aligns the text, and — importantly — REVERSES the wipe
so the reveal travels right-to-left with the exit still its exact reverse. Latin
is untouched (guarded on the flag).

**PLUGIN FOLLOW-UP (Javi asked to note this):** the AE templates must get the
same treatment — an RTL variant of the OCHA Lower Third whose wipe runs
right-to-left and whose bands anchor right, so the Premiere plugin matches the
web app for Arabic. Not built yet; needs `premiere/ae/src/builder_template.jsx`
(buildLT) + a panel toggle or auto-detection on the typed text.

**Translation.** Whisper's `task="translate"` turns speech in ANY language into
ENGLISH text (one direction only — it cannot translate INTO other languages).
Wired end to end as a "Translate to English" checkbox by Transcribe; the result
lands in the normal caption editor so it is reviewed and edited like any
captions, and the existing "Use AI" copy/paste loop still applies for a
second pass in Copilot.

**Thumbnails are now unlimited.** The 3-at-a-time suggestions (sentence ends
first — mouth most likely closed) stay, plus "Use the frame I'm viewing": it
reads the preview's playhead and maps CUT time back to SOURCE time through the
same runs the engine builds, so any frame in the clip can be the thumbnail.

## 2026-07-27 — RTL is a LAYOUT setting, not per-element detection (2026.0.24)

Javi: RTL has to apply to every element, not just the lower third — "it should
all go to the right". Two findings shaped the design:

1. **The OCHA bug has no text**, so per-element auto-detection can never mirror
   it; and a mixed-language video would come out half-mirrored. So the direction
   is ONE video-level setting resolved once per render (`spec["rtl"]`), explicit
   value wins, otherwise inferred from any Arabic across captions / lower thirds
   / text / location strips. The UI exposes it as a checkbox that auto-ticks when
   Arabic is typed OR transcribed, and stops auto-ticking once touched.
2. **The bug MUST take the opposite corner** — not for style. The location strip
   moves to the top-right in RTL, which is exactly where the bug already sits;
   leaving it there stacks two elements in one corner. (Arabic broadcasters land
   on the same split: content right, channel mark opposite.)

Mirrored: lower third (right margin + internal mirror + reversed wipe), text on
screen (right margin, right-aligned), location strip (top-right, pin on the
right of the bands, wipe reversed), bug (opposite corner). Unchanged: captions
and the ending logo — both centred. Applies to BOTH tabs (social_brand and
finish share the rule). Latin verified unchanged: LT x=70 and bug x=924 exactly
as before, only the rtl branch differs.

PLUGIN FOLLOW-UP grows: the AE templates need the same treatment for the Lower
Third, Text, Location AND Bug — plus a panel-level RTL toggle, since the MOGRTs
can't infer a video-wide direction either.

## 2026-07-27 — 4K export for Event screen only, never upscaled (2026.0.25)

Javi: 4K is only ever wanted for EVENT videos, never social, and "the sizes of
the text should remain the same" — plus no upscaling.

**Most of it was already true.** Every branded element except the captions is
sized as a RATIO of canvas height (LT `name_ratio`, pin `line1_ratio`, text
`RATIO`, bug `BUG_HEIGHT_FRAC`, ending `logo_frac`), so a larger canvas keeps
identical proportions for free. Captions were the ONE fixed-pixel element, so
`sub_config(preset, style, scale)` now scales them (and `lt.bottom`) by
`csc = canvas_h / preset_canvas_h`. MEASURED on the same clip rendered both
ways: the caption band occupies 0.644–0.888 of frame height at 1080 and
0.644–0.897 at 4K — the same composition, larger.

**Bitrate had to move with it.** 12M is tuned for 1080; at 4K it would produce a
bigger file that looks WORSE than the 1080 one. `_bitrate_for(cw, ch)` returns
12M / 25M / 45M by pixel count.

**Gated on the source, hard.** The toggle only enables for the Event preset AND
a source ≥3840×2160 — QuickVid never upscales 1080 to 4K and calls it an
upgrade. The hint says which condition failed. UN Web TV was ruled out as a 4K
source by Javi (it never casts 4K), so the download-quality work was dropped.

KNOWN, stated in the UI: the punch-in crops the source, so at 4K the CLOSE
shots are enlarged ~1.5x from the crop (the wide shots are true native 4K). At
1080 output both shots downscale. Accepted over exporting an odd 2560x1440 or
dropping punch-ins entirely.

## 2026-07-27 — Square to Reel washed out the WHOLE project's colour (URGENT fix)

Javi: "when creating the reel with the plugin toolbox the color changes in all
sequences. It becomes like washed. The blue is no longer OCHA blue."

"ALL sequences" was the clue — creating one sequence cannot affect the others
unless something PROJECT-level changed. `ochaResizeSeq()` did this to change the
frame height:

    st = seq.getSettings();   // read EVERYTHING
    st[field] = newH;
    seq.setSettings(st);      // write EVERYTHING back

The settings object does NOT survive that round trip. Fields the API doesn't
fully expose — colour management / working colour space above all — come back
defaulted, and writing the object back APPLIES those defaults. Colour management
is project-level in current Premiere, so the damage isn't scoped to the sequence
being resized: every sequence renders through the clobbered pipeline and the
brand blue goes off.

Fixed by dropping the round trip entirely for QE's `setVideoFrameSize`, which
touches ONLY the frame size. (Its presence on Premiere 26.3 was already measured
in this session's guides probe.) Deliberately NO settings-object fallback: an
unresized sequence is obvious and harmless, silently wrecked colour is neither —
so if QE is missing the function reports failure instead. `ochaKeys()` existed
only to describe that settings object and went with it.

RULE: never round-trip `getSettings()/setSettings()` to change one value. Reach
for the specific QE setter, or leave it alone.

**Follow-up (same day): the incident traced to sequence Colour Management —
NOT provably the round trip.** Javi found the fix himself: disabling Colour
Management on the SQUARE sequence restored both sequences. That works because
the reel nests the square twice (bg + fg) and has no media of its own — it
renders whatever the square renders. The old resize only ever wrote settings to
the REEL clone, never the square, so the plugin cannot cleanly explain the
square's CM flag flipping ON. Likeliest real triggers, in order: Premiere's
HDR/HLG media prompt-banner (the footage was iPhone .MOV = HLG) being OK'd in
passing; a Premiere update re-defaulting CM on sequences with HDR media; a
manual click in Lumetri > Settings / Sequence Settings. There is no default
keyboard shortcut that toggles sequence CM, so "a shortcut we hit without
knowing" is unlikely. The setSettings hazard is real regardless — the QE
setVideoFrameSize fix STAYS.

**Refinement (Javi, same day): the right setting is not "disable" but Color
Setup = "Direct Rec. 709 (SDR)"** — he compared both and Direct 709 looks
better. Makes sense: disabling CM passes the HLG iPhone footage through RAW
into an SDR pipeline (flat/washed), while Direct Rec. 709 keeps CM on and
CONVERTS the footage into 709 (correct, saturated blue). It also matches
everything downstream: the QuickVid engine normalizes all footage to bt709
(mediakit gate) and the brand graphics are sRGB. **HOUSE RULE for OCHA
Premiere sequences: Sequence Settings → Color Management → Color Setup =
"Direct Rec. 709 (SDR)"** (Output follows as Rec. 709). Field fix for a washed
project: set exactly that on the SOURCE sequence — nested copies (the reel)
follow (30 seconds, as measured here).

## 2026-07-28 — Plugin batch: packager report, track control, reset, colour, bins, vignette (2026.0.43)

Javi's seven-item list, in order. Three of them turned out to share one root
cause, which is why they are logged together.

**1. Packager didn't say what it actually did.** It reported "copied N files"
whether or not the saved copy pointed at them. Added `ochaPkgMissingItems()`
(offline items are recorded BEFORE copying, since an offline item can never be
packaged) and an `unlinked` list filled during the relink loop. The report is
now "N of M relinked" and returns `WARN|...INCOMPLETE:` naming the files that
still point outside the package. A package that is silently partial is worse
than one that says so.

**2. Square to Reel showed the subtitles twice.** `src.clone()` copies the
square's CAPTION track, and the nested square renders its own captions through
the nest — so both appeared. Caption tracks are not scriptable (26.3:
`seq.captionTracks` is undefined, a selected cue reports zero components), so
deleting the copy was not reliably available. Fixed at the source instead:
`ochaReelBase()` now builds the reel with `createNewSequenceFromClips`, a
BRAND NEW sequence matched to the square that has no caption track to inherit.
The clone path stays as a fallback, with `ochaClearCaptions()` as best effort,
and it REPORTS which path ran — so the first real run tells us the truth
instead of us guessing a second time. `ochaResizeSeq` now takes an explicit
width, so the reel's size no longer depends on the base sequence's own.

**3 + 4. Track placement.** The gradient exists to sit UNDER the text it makes
readable, but everything was inserted one-past-the-top. `ochaTrackTries()` now
resolves `"bottom"` to the lowest FREE track upward, `"top"` as before, and a
numeric preference to that exact track. A "Track" picker sits under Add to
timeline, defaulting to Automatic (graphics on top, gradient underneath).

**5. Tidy project.** `ochaTidyProject()` sorts loose root-level media into
`01 Footage / 02 Images / 03 Graphics / 04 Audio / 05 Other`, reusing the
packager's `ochaPkgCategory()` so a tidied project and a packaged one group
identically. Deliberately conservative: sequences never move (they are what you
open), OCHA templates stay put, anything already in a bin is the user's own
filing, nothing is renamed or deleted. It snapshots the root list before
creating bins — mutating the collection mid-iteration silently skips items.

**6. Reset position acted like an undo.** It wrote the frame CENTRE, which is
right for Motion but wrong for our templates, whose default is the designed
edge — a left-anchored lower third belongs at the safe margin. `ochaResetPos()`
asks the MOGRT parameter for its own default (`getDefaultValue()` /
`.defaultValue`) and writes that, falling back to Motion's genuine centre
default for older clips. Both axes reset together: a designed position is a
point, not two independent numbers.

**7. Vignette.** Built as an ordinary OCHA element, not a Toolbox one-off, so
it inherits the track picker and the size/position binder for free. In AE:
a black solid with an INVERTED elliptical mask (radii and feather are fractions
of the comp, and the comp is built per format) — "adapts to the sequence size"
therefore falls out of construction, with no runtime scaling. Controls are
Amount (opacity) and Size (0-100 with 50 = as designed, driving Mask
Expansion — MOGRT sliders clamp to 0-100, a constraint already learned on the
position sliders). Defaults to the TOP track: it darkens the picture, so it
must sit above the footage — the exact opposite of the gradient.

**Colour, from the earlier incident.** `ochaColorStatus()` (read-only, safe to
poll) drives a BANNER — not a modal — when the active sequence isn't Rec. 709;
the panel re-checks every 2.5s and on every sequence switch, so a modal would
pop up again and again and steal focus mid-edit. `ochaFixColor()` picks Rec. 709
out of the sequence's OWN `workingColorSpaceList` (never constructs a
ColorSpace), sets `autoToneMapEnabled`, and AUDITS the write: snapshot all 27
fields before and after, and report any field that moved besides the two we
meant to touch. Given what a blind `setSettings` is suspected of doing to a
project once, an unaudited write was not acceptable.

**Two silent no-op patches nearly shipped a dead panel.** The `TOOLS.fixcolor`
entry and its Toolbox tile were both written with string-replace patches whose
anchors never matched — the replace silently did nothing while the surrounding
work reported success. The event listener DID land, so `$("tool-fixcolor")`
resolved to null at load and threw, killing every listener registered after it:
the whole panel would have been inert. Caught by two checks that are now worth
keeping as a habit: every `$("id")` in main.js must exist in index.html, and
every `ocha*()` called from the panel must be defined in host.jsx. **Rule: a
patch that reports success is not evidence the edit landed — grep for the new
symbol afterwards.**

## 2026-07-28 — Text on screen becomes its own step, with unlimited blocks (web app)

Javi: "make the text on screen section a separate section like location or bug
... could go before ending so that would be number 6 and ending becomes number
7. Also allow the user to add unlimited text on screen chunks. This should work
the same way in both editing and branding tabs."

**Own step.** Text on screen was a sub-block tucked inside step 1 ("Your
video") on the Titles tab, which put a creative decision in the middle of file
picking. It is now step 6, directly before the ending, and Ending is step 7. On
the Edit tab it moved to the same place in the branding card — after Location,
before Ending — so the two tabs read in the same order.

**Unlimited blocks.** It was one on/off block, so a video could carry exactly
one text card no matter how many moments needed one. `texton.js` is now the
same card model `location.js` uses — add, fill, remove, auto-numbered by a CSS
counter — and the mount contract changed from eight element IDs to
`{rows, add, onChange}`, matching the location strip.

**The engine needed no change at all.** `social_brand.py` has always looped
over `spec["texts"]`; the cap was purely the UI's.

**CORRECTION, same day — I first left `VERSION` at 2026.0.25** on the reasoning
that no Python changed and a bump would prompt a pointless engine update. That
was wrong, and Javi found it immediately: he reloaded the app and saw none of
this. The installed app does not run from the repo — it lives in
`~/Library/Application Support/OCHA QuickVid/app`, a full snapshot of GitHub
`main`, and the launcher only re-downloads it when the remote `VERSION` is
strictly HIGHER (`sort -V`, see `OCHA QuickVid.command`). **`VERSION` is the
delivery trigger for the whole install, `browser/` included** — so a UI-only
change with no bump reaches nobody running the installed app, ever. Bumped to
2026.0.26 with `ENGINE_LATEST` to match.

**RULE: any change under `browser/` needs a `VERSION` bump**, exactly like an
engine change. "No Python changed" is not a reason to skip it. The only thing
that ships without one is the GitHub Pages copy, which serves `browser/`
straight from the repo — and that is not what Javi (or any colleague with the
engine installed) is looking at.

**Three lines per block stays.** That is the template's design (the AE comp has
three text layers), not an arbitrary limit — a fourth line is a second block.

**mm:ss instead of raw seconds.** The old block used number inputs ("Starts at
1 s"); the cards use the same mm:ss field with spinners as the lower thirds and
location strips. A text block at 1:35 into a long video is now typed the way it
reads on the timeline, and all three multi-card components now behave
identically.

**Legacy projects still open.** `restore()` accepts the new list, a legacy
single `{on, lines, …}` object, or nothing — an `on:false` legacy block
restores as no cards, which is what it looked like on screen.

**"Bug" is now "OCHA logo" everywhere the user reads it** (both tabs, help
panels, the FAQ). "Bug" is broadcast jargon; nobody outside a gallery knows it
means the corner watermark. The engine key stays `bug` — renaming the API would
break saved projects for a label change.

Verified in the browser: both tabs list the steps in the new order, a two-block
project restores with 00:12 / 01:35 in the time fields, Add creates a third,
Remove renumbers, collect() returns all blocks with their own timings, a legacy
single-object project opens, and the Edit tab mounts the same component.

## 2026-07-28 — Middle gradient gains a half-width "cloud" (2026.0.43, same build)

Javi: "can we add an option on the readability gradient to have a half gradient
on the medium? ... full width, left half, right half. The left and right halves
would be more like a gradient 'cloud'. edges are feather inside darker."

**Why a separate layer and not a third Linear Wipe.** The Middle band is built
from two Linear Wipes, so a third one clipping the band horizontally is the
obvious move — and wrong twice over. A wipe can only produce a STRAIGHT
feathered edge, where the ask was explicitly a cloud (soft all round, darkest in
the middle). And the wipe angle mapping is the one thing in this builder that
has already been measured backwards once ("angle 0 left the scrim at the TOP,
not the bottom"), so guessing that 90/270 map to right/left would have been a
coin flip that costs an AE rebuild to discover.

Instead: a second black solid ("Cloud") with a feathered ELLIPTICAL MASK, whose
geometry is fully under our control. The mask is baked at the comp centre and
the LAYER slides a quarter-frame either way, so ONE shape serves both halves and
there is no left/right geometry to get backwards. Exactly one of the two layers
is ever visible — the full-width band's opacity drops to 0 whenever a half is
chosen — so they can never stack into a double-dark patch.

**Controls.** Two checkboxes, "Middle left" and "Middle right"; neither ticked =
full width. Both are gated on `mid && !fs` in the template, so they are inert
under Bottom/Top/Full screen no matter what is sent.

**UI.** A choice that only exists inside another choice needs to look like it,
so Middle width is its own boxed, indented mini section that appears only when
Middle is the active position — inline it read as a fifth position. The panel
sends both booleans false for any non-Middle position, so an old clip edited
into a new position can never keep a stale cloud.

**Numbers** live in `make_assets.py` with the rest of the gradient:
`cloud_rx_frac` 0.34 / `cloud_ry_frac` 0.30 / `cloud_feather_frac` 0.14, all
fractions of the frame, so the cloud is proportional in every format.

**A silent no-op patch again — second time in two days.** The `setMidUI()` call
inside the segmented-control handler was written with a string-replace whose
anchor had 8 spaces of indent where the file has 6. It reported success and did
nothing, and the surrounding asserts passed because the OTHER replacements in
the same patch landed. Caught only by reading the handler back. **Rule, now
earned twice: use an anchored editor that FAILS on no-match for edits into
existing code; if a scripted replace is unavoidable, assert on the new text at
its destination, not merely on its presence somewhere in the file.**

## 2026-07-29 — The App Kit now DERIVES from the CDS instead of retyping it

Javi, on being told the kit didn't carry the Design System's token names: *"the
app kit was supposed to be connected to OCHA CD. Doesn't make sense if it's
different"* — and, setting the bar for the fix: *"we don't do quick fixes and
patches. We do coordinated and synched work."*

**I had the diagnosis half wrong first.** I reported that the kit *should* expose
`--cd-*` names and doesn't. The kit's own CLAUDE.md says otherwise: short
app-facing names are deliberate, and the contract is that their VALUES come from
the CDS ramp. So the naming was never the defect.

**The real defect was that the contract was documentation, not mechanism.** Every
kit value was a hand-typed hex. An audit against `tokens/brand.css` found 11 of 13
colours still matched by luck and **two had already drifted off the ramp** —
`--ocha-blue-footer` (which I introduced during the footer work, taking the colour
off brand.unocha.org rather than the ramp) and `--line`. Worse, `.cd-flow` — the
vertical rhythm under every screen of both apps — referenced `--cd-flow-space`,
which nothing anywhere defined, so it had always been running on its hardcoded
1rem fallback instead of the CDS value.

**Fix (kit v0.4.0).** `:root` is three layers: the CDS token block generated into
the kit from `tokens/brand.css`; the short names as `var()` aliases onto it; and
an explicit kit-owned section for what the CDS lacks. Embedded, not `@import`-ed,
because the kit must stay one self-contained file — `sync.py` copies it wholesale
into apps, where a relative import resolves to nothing. `sync.py` gained
`refresh_cds()` (re-embed before every sync) and `verify_kit()`, which FAILS the
sync on a dangling `var()` or a raw value in the alias layer. Both guards were
tested by deliberately breaking the kit; both blocked it and named the offender.

**Consequence for QuickVid, and the reason this was worth doing properly:** the
app now has the whole CDS vocabulary — `--cd-font-size--*`, `--cd-bp--*`,
`--cd-container-padding`, `--cd-max-*` — where before it had colours and radii
only. Javi's global layout rule ("always use the real cd-* tokens") was
unfollowable here until now; it is literally true from this commit.

**Spacing.** The CDS defines no space tokens at all, which is why every app was
eyeballing margins — QuickVid had 63 of 118 spacing values off any scale (11.2px,
9.6px, 14.4px). The kit now owns a 4pt scale `--sp-4…48` and `browser/style.css`
is migrated onto it: 48 values snapped, none moving more than 2.4px. Two
deliberate exclusions, both documented at the top of the file: sub-4px optical
nudges on labels and pills, and the timefield/durfield paddings, which are overlay
geometry (room for the spinner and the "sec" unit) rather than rhythm — snapping
those would have clipped the controls. Verified the spinner and unit still sit
inside their inputs afterwards.

**Verified zero visual change:** all 16 short tokens resolve to byte-identical
values through the new alias chain. This was a structural change, not a restyle.

**Found while testing: `style.css` had NO cache-bust at all.** The kit and layout
changes would have reached nobody on GitHub Pages. Both stylesheets now carry
`?v=<VERSION>`. Same class of bug as the stale `texton.js?v=2` earlier the same
day — **any file the page links must carry the version, not just the scripts.**

Open upstream (handoff `h9`): promote or reject the two kit-owned values, decide
whether the CDS should own the spacing scale, and note that `--cd-font--roboto` is
defined twice in `tokens/brand.css` (lines 109 and 253) with different fallback
stacks — the second silently wins.

## 2026-07-29 — A `*/` inside a CSS comment ate every blue in the app

An hour after the kit v0.4.0 restructure, Javi asked to "bring back the blue
circles on the numbers, the blue icons and the blue selected highlight" — framing
it as a design divergence worth discussing. It wasn't a divergence. It was a bug
I had just introduced.

The comment I wrote above the alias layer contained `--cd-*/--brand-*`. The `*/`
in the middle of that **closes the CSS comment early**. The remaining prose parses
as garbage, and the CSS error-recovery rule ("skip to the next semicolon") then
swallows the first real declaration after it — `--ocha-cyan`. That single token is
where every blue in the app comes from, so step-number circles, the selected
Statement-clip card, the tool icons and the active Look card all silently lost
their colour. Both apps, since the kit is shared.

**Why it was hard to see:** the file greps clean (`--ocha-cyan` is right there on
line 287), the token chain is correct, `sync.py`'s existing checks passed, and
nothing errors — CSS drops the declaration silently. It only showed up by asking
the BROWSER what it had parsed: `:root` listed 149 declarations where the file has
157 names, and diffing the two lists named the single casualty.

**Guard added:** `verify_kit()` now counts `/*` against `*/` and fails the sync on
a mismatch. The bad comment had 1 opener and 2 closers — a one-line check that
would have caught it before it ever reached an app.

**The general lesson, which is the same shape as the ExtendScript `--` rule
already in CLAUDE.md:** a comment is code. Writing a token family, a glob, or a
path containing `*/` inside a CSS comment is as load-bearing as the CSS itself,
and the failure is silent rather than loud. When a style "just isn't applying"
and the source looks right, ask the browser what it PARSED before re-reading the
file again.

## 2026-07-29 — Naming placed items by content, and the two bugs it flushed out (2026.0.46)

Javi: rename placed MOGRTs by their content ("OCHA Lower Third - John Doe"),
drop the format from the name, number the ones with nothing to name them by
(Ending 1, Ending 2), settings-based labels for gradient/vignette. Feasible
because every "is this an OCHA item?" test matches the PREFIX only (OCHA_EL_RE);
the tail was never load-bearing. The name shows on the timeline clip too, which
is the bigger win.

**Bug 1 — rename on the debounced keystroke.** The first cut renamed in
ochaWriteText, which runs 400ms after every keystroke. Each rename changed
clip.name, the poller stopped recognising the bound clip, treated it as a NEW
selection and refilled the fields from the clip — under the user's typing.
Whether you noticed depended on whether a poll landed between keystrokes:
Javi saw it fail once, then "work" on retest. Renaming now happens on Add and on
an explicit Update only, and the panel follows the rename via `named=` in the
reply so its binding stays current.

**Bug 2 — the poll's guards sat above its truth.** syncText() began with
"don't fight the typist" (focus inside a pane -> return) and "write in flight ->
return", THEN read the selection. CEP panels keep DOM focus until you click
back inside the panel, so focus parked in any field meant the poll never ran —
deselect in Premiere and the panel stayed in "Update selected" forever with
nothing selected (Javi's report). The reconciliation (unbind / rebind) now runs
FIRST, unconditionally; only the FIELD REFILL yields to the typist. RULE worth
remembering: an early-return guard must never sit above the state
reconciliation it was meant to protect — scope the guard to the write, not the
whole function.

**Belt and braces:** a debounced write now carries the clip name it was typed
for, and the host REFUSES if the selection changed in between ("Selection
changed - nothing was written") — one clip's text can never land on another.
A rebind also drops any pending debounce from the previous clip.

**Position accordion never auto-opens** (and a new binding closes it again):
Javi — "I don't want people to play around much with it". It used to open
itself whenever a clip bound.

## 2026-07-29 — Sync bake had no progress bar; framing was slow on Windows (2026.0.30)

**No bar on "Baking A/V offset".** Two causes, both needed fixing. The UI call
passed no percent — every other step does `stStatus(jj.progress, "busy",
jj.percent)`, that one stopped at "busy". And the engine never emitted a
`PROGRESS` token for it either, so there was nothing to pass. `do_applysync` now
runs ffmpeg with `-progress pipe:1` and converts `out_time_us` into PROGRESS
against the probed duration. A long audio re-encode is exactly the step that
needs a bar — it printed one line and then sat silent, which reads as frozen.

**Framing sliders "painfully slow" on Windows/Chrome** (Javi's colleague; not
reproducible on his Mac, which is the clue — it is per-request cost, and process
spawn plus AV scanning is far dearer on Windows).

Two real causes:

1. `stFrameRefresh()` called `stFrameLoad()` with NO argument, which reloads
   BOTH stills. Nudging the general zoom therefore re-rendered the close-up too:
   double the ffmpeg work per tick, and the other picture flickered. It now takes
   a shot; no-arg still means both, which is what the preset/time callers want.

2. The still URL carried `&cb=${Date.now()}`. Every parameter that changes the
   picture is ALREADY in the URL, so the cache-buster bought nothing and cost
   everything: each request was unique, so the browser could never reuse an image,
   and dragging back to a framing you had just seen was another round trip. Removed,
   and the endpoint now sends `Cache-Control: immutable` so the browser really keeps
   them. Measured locally: cold render 157ms, warm server-side 29ms, browser-cached
   0 and no request at all.

RULE: a cache-buster on a URL that already encodes its inputs is not a safety
net, it is a permanent cache miss. Only add `cb=` when the same URL can genuinely
return different bytes (a job preview being overwritten, say).

## 2026-07-30 — OCHA style guide in the transcript; the real Windows crash (2026.0.31)

### The Editorial Style Guide is now data, not prose

`brand/ocha_style.json` holds the rules from the *OCHA Editorial Style Guide,
3rd edition* — 81 canonical casings, 93 respellings, 13 protected names and the
prompt block — each entry carrying the guide's page number so it can be checked
against the PDF. `engine/style.py` applies it; both are read by ONE loader, so
the AI's instructions and the transcript's spelling cannot drift.

**It runs on WORD TOKENS, not on the sentence string.** Whisper gives us `text`
AND a parallel `words` list with per-word timings, and the renderer uses both —
`cues_from_runs` splits long sentences at word boundaries and times each chunk
from `words[i]["s"]`. Fixing only `text` would silently desync them and the
caption you reviewed would not be the caption that burns. So a rule matches N
tokens and emits M ("percent" → "per cent" is 1→2, "cease fire" → "ceasefire"
is 2→1), the matched span's time range is redistributed across the replacements,
and `text` is rebuilt from those same tokens. One operation, no drift.

Three things speech does that a printed style guide does not, all found by
testing and all handled:

* **Hyphens are inaudible.** Whisper writes "secretary general"; the guide says
  *Secretary-General*. Matching therefore happens on hyphen-split parts, so one
  rule covers all three spellings. A match must still begin and end on whole-token
  boundaries — otherwise "member state" would eat half of "member-state-level".
* **Possessives.** "the Secretary-General's report" must match; the `'s` is lifted
  off before matching and re-attached to the replacement.
* **Sentence starts.** A rule forcing LOWER case (*tsunami*, *cholera*) must not
  lower-case the first word of a sentence. Only `.` `!` `?` end one — a semicolon
  does not, or "Cholera is spreading; cholera kills" comes back wrong.

**English only.** The rules are English words and several are ordinary words in
other languages — a Spanish transcript would have *labor* and *color* quietly
turned into *labour* and *colour*. Gated on the detected language, with
`task="translate"` always qualifying since it outputs English.

**The AI half is smaller than it sounds, and worth saying plainly:** the AI in
step 5 only ever returns a list of sentence numbers — it writes no copy. So the
style guide lands on the transcript (which the AI reads and quotes), plus a short
generated house-style block for anything the user asks it to write in the same
chat. `GET /api/style/prompt` serves that block from the same JSON.

### The Windows crash: a default encoding, not a subprocess flag

Javi's colleague reported crashes when bringing in a source (download and local
folder) and when editing subtitles after an export. **Windows text-mode I/O
defaults to the ANSI codepage (cp1252), macOS to UTF-8**, and the codebase had 22
reads/writes that never said which. Measured: cp1252 has no Arabic, no Polish `ł`,
no Cyrillic, so `json.dump(out, open(path, "w"), ensure_ascii=False)` — the
transcript writer — is a hard `UnicodeEncodeError` there and flawless here.
Western European accents survive by luck (é, ô, ç are all IN cp1252), which is
exactly why this hid for so long.

Every text read and write now states `encoding="utf-8"`, including the render
spec (written with `ensure_ascii=False` in `engine_bridge`, read back in
`statement.py` — the two ends of one file), `brand.json`, and the ffmpeg/yt-dlp
pipes (`text=True` decodes with the locale codec too, so a path with an
out-of-codepage character could kill a render mid-progress; they now use
`errors="replace"` so a log line can never take down a job).

RULE: **never open a text file without `encoding=`.** The default is
platform-dependent, so the bug is invisible on the machine you develop on and
certain on someone else's.

**What was NOT the problem:** the plan's item 7c said the 25 subprocess calls
needed `CREATE_NO_WINDOW`. Checking how the engine is actually launched
(`tools/qv-engine.bat`: `start "OCHA QuickVid engine" /min cmd /c ...python -m
uvicorn`), it always owns a console — minimized, but real — so ffmpeg children
attach to it and never flash a window. No edits made; a speculative fix to 25
call sites would have been churn.

### The AI step is TWO jobs, not one with options

Javi: *"I picked manually some sentences and it decided to trim them."* The cause
was visible in the prompt — "you MUST keep these sentences" was the **last bullet
in a list of soft editorial preferences**, punctuated like the rest, sitting
directly under *"stay within about 90 seconds"*. Two orders, no ranking, so the
model resolved the clash by trimming. Making the wording sterner would not have
fixed it; the instruction was in the wrong place.

The real shape, from Javi's two cases:

* **"I already have the sentences"** — he or a colleague chose them, usually in a
  script document. This is a **lookup**, not an edit. The prompt now carries no
  duration, no editorial criteria and no must/avoid — every one of those is a
  licence to drop something the editor picked. It matches on MEANING (a written
  script never matches spoken words) and returns
  `{"keep": [...], "unmatched": [...]}`. Anything it cannot place is **reported,
  never guessed**, and QuickVid raises it as a warning with the lines quoted —
  that is the only thing you would otherwise have to catch by eye.
* **"Help me choose"** — the old path, with locked sentences lifted OUT of the
  criteria list into their own block above it, stating explicitly that the
  duration target gives way and never the locked sentences, plus a closing
  "check your keep list contains N, N". A free-text *"What should it focus on?"*
  box replaces having to go through the question-and-answer round trip.

RULE: when one control has to serve two different intents, the fix is two modes,
not a stronger adjective. A constraint that outranks another must be *positioned*
above it and say what happens when they conflict — a peer bullet reads as a peer.

UI note: the mode cards reuse `.end-opt`, whose `__icon` slot is `aspect-ratio:
16/9` because it stands in for a 360x203 still. With no artwork that is a big
empty box, so `.end-options--compact` shrinks it.

## 2026-07-30 — Feedback round 2: two real bugs, plus the layout pass (2026.0.32)

**Ending logo was NOT centred — two implementations, two answers.**
`ending.py:116` places it at `(H - lh) // 2`; `social_brand.py` had its own
`logo_y_frac` defaulting to **0.58** ("below the face, above the caption zone").
Nothing ever set that key, so every Edit-tab `over_footage` ending shipped low:
measured **+154px** on a 1080x1920 reel, +108 on 4:5, +86 on square and 16:9.
Defaulted to 0.5; verified both paths now agree in all four formats. The key stays
so the ending preview's vertical slider can drive it.

RULE (again): when the same visual decision exists in two files, they WILL drift.
This is the third time (`brand-lt.json`, the shared `browser/*.js` modules, now
this). If it can't be shared outright, it must at least share a default.

**Framing sliders: one cause behind three complaints.** `stFrameHint()` wrote a
line under each slider that appeared and vanished with the crop-lock state — that
is the "message that disappears", and it changed the row height as you dragged.
The "slider gets bigger" was the same section: `.st-frames` was a flex row sized
by the picture, so a 16:9 Event still made the column (and its slider) ~3x the
width of a 9:16 reel still. Fixed: hint deleted, `.st-frame-box` is a fixed
240x240 slot in a fixed-column grid, zoom steps in 25% notches with tick marks and
a readout, and a `fa-hand-pointer` badge fades in for 3s when the pictures change.

**Found while there:** `r.onchange = stFrameRefresh` passed the EVENT as the
`shot` argument, so `stFrameLoad` skipped both shots and **changing format never
refreshed the framing stills at all**. Wrapped in an arrow.

**Other changes**
* Format picker is a grid with explicit counts (4-up, else 2x2). `auto-fit` was
  measured producing **3 columns at 1280px** — the stranded-fourth-card bug wearing
  a different hat. Each card carries its shape as an FA Classic Regular glyph; no
  4:5 glyph exists, so the 9:16 one is scaled rather than a new icon drawn.
* Download → **Open the export folder**, both tabs. The file is already in the job
  folder; Download only made a second copy in Downloads, which is how people ended
  up branding the wrong file.
* Magnifier on every Look card. `look-preview`'s width was hard-coded at 480; it is
  a parameter now (clamped 160-1920, verified 5 -> 160 and 99999 -> 1920) so the
  big view is a genuinely re-rendered frame, not a stretched thumbnail. The button
  is a SIBLING of the card, not a child — the card is a `<button>`.
* `browser/waiting.js`: shared calm waiting lines, silent for the first 12s then
  one every 9s, stopped in a `finally` so an error never sits under "grab a coffee".
  Hooked into `stJob()` once, which every long Edit-tab step already polls through.
* Windows shortcut: `IconLocation` needs the **`,0` index** — without it Windows
  falls back to the target's icon, and the target is a `.bat`, hence the console
  icon in Javi's screenshot. The `.ico` itself was always fine (valid 7-size
  resource, ships in the repo zip). An existing install keeps the old icon until
  the installer is re-run.
* Layout: `.st-folder` is a grid with gap instead of four rows of stacked margins;
  "Translate to English" moved into an option card ABOVE the Transcribe button it
  configures, instead of hanging below it.

**Not a bug:** a `<input type="range">` at `width:100%` reports `scrollWidth`
2-4px over its container in Chrome — measured on a bare div with none of our CSS.
It is the UA thumb overhang. Don't "fix" it; check `document.body.scrollWidth`
instead, which is the thing users actually feel.

**Decisions taken (Javi):** force-two-line subtitles is DROPPED — merging joins
cues across sentence boundaries and shifts timing, trading a cosmetic
inconsistency for a comprehension risk; the caption editor already shows the real
two-line shape so it can be done by hand. Analytics goes on the EXISTING QuickVid
sheet as a separate tab, with separate dashboards later — not Google Analytics,
which would compromise "your video never leaves the machine".

## 2026-07-30 — Curated font choice on the lower third (staged, unversioned)

Javi: advanced users need **Bebas** for UN-level videos (it is the UN video
typeface; Raleway is OCHA's). Requirement: an escape hatch that changes **no
default and no panel default behaviour**.

**Where it lives — the PANEL, not Premiere's Properties.** The "Position"
accordion became **Advanced settings** with two groups, Position and Font; the
pill reads **off-standard**; the duplicate "Use with caution" paragraph inside is
deleted (it said what the pill says). *(Adobe renamed Essential Graphics to
**Properties** — our dev READMEs still say the old name.)*

**The control still has to be exposed on the template.**
`getMGTComponent().properties` only sees exposed controls, so "Font" also appears
as a plain row in Properties. That is exactly how Position X/Y and Size already
work, so it is consistent rather than a compromise.

**Self-gating:** `ochaFontStatus()` returns "none" when the selected clip's
template has no Font param, and the panel hides the whole group. A template built
before this feature therefore shows nothing at all, instead of a control that
silently does nothing.

**Why it was low-risk:** the thing that would normally need a spike — can an
exposed Source Text property carry an expression AND still be written by the
panel? — has been true in production since 0.4x: the LT name has a
`toUpperCase()` expression, is exposed as "Name", and the panel writes it with
`setValue(str, true)`. The font work is the same pattern with a bigger expression.

**Implementation.** `fontExpr()` now returns a **TextDocument** where the old
expression returned a String — a String can only change the words, not the face.
`value` carries whatever the panel typed, so panel-writes-text and
expression-restyles-it compose. Guarded with try/catch and a blank-postscript
fallback so one bad spec can't break every lower third.

**Font: Google's Bebas Neue, not Bebas Neue Pro.** Pro is Adobe Fonts only and
**cannot be bundled**, so the web app could never match it — and we have spent a
lot of effort keeping the two products' typography identical. Google's is OFL,
single weight; name and organisation share the face and separate by size, colour
and box, which the design already does. Numbers live in `brand-lt.json`
`fonts.alt` (label / postscript / scale / uppercase_all) so the face and its
optical size are tunable without touching code.

Uppercase: today only the name is uppercased (`uppercase_name`). In the alt face
**both** lines are, matching the UN reference.

**Verified against Javi's UN SG reference:** the colours are ALREADY identical
(`#FFFFFF`/`#000000` name, `#009EDB`/`#FFFFFF` title). Genuinely font +
capitalization only; geometry, timing, animation and the auto-sizing box untouched.

**Not in scope: Arabic.** Not a font entry — the plugin has no RTL handling at all
(verified: nothing in the CEP panel or the AE builder), and AE on the Latin build
mis-renders Arabic outright. Its own project.

**State: staged, deliberately unversioned.** The templates must be rebuilt in
After Effects and the whole set re-tested before any version bump or `.zxp`.

### Font dropdown round 2: the expression wrote to a read-only object

Javi's test: dropdown visible in panel and Properties, but the render never left
Raleway. All three wiring points checked out (controller layer named `Controls`,
`fonts.alt` in brand-lt.json, both text layers carrying the expression) — the
fault was the write itself. **In the expression engine a TextDocument's
attributes are read-only: `t.font = '...'` is a silent no-op.** No error, no
banner; the render just keeps the baked style. What made the pattern look
plausible is that the BUILD-time `td.font = psFont` in setText() genuinely works —
same property name, different API (scripting TextDocument, which is writable).

Fix: `fontExpr` now uses the Text Style API (the actual AE 17.0 feature) —
`text.sourceText.getStyleAt(0, 0).setFont('BebasNeue-Regular')[.setFontSize(n)]
.setText(txt)` — returning the STYLE, which AE applies. Empty text is gated
(getStyleAt throws on an empty document), a missing dropdown falls back to
Raleway, and the Raleway paths return plain strings exactly as before.

RULE: an AE expression can only restyle text through the Style API. Assigning to
`value`/TextDocument attributes compiles, runs and does nothing.

**White-on-white dropdown (dark mode):** the select's first cut invented tokens
that do not exist in the panel (`--bg-input`, `--border`), so the background
declaration was invalid and the control painted its native light face under
white text. Now reuses `.track-sel` — the Track dropdown's proven style. Same
lesson as the web app's kit-first rule: reuse the existing component; a made-up
token fails silently and only in one theme.

**Testing note that will recur:** a MOGRT clip already IN a sequence embeds the
template as it was when placed — rebuilt .mogrt files change nothing about it.
Every template retest needs the old clip deleted and a fresh one placed.

### Font dropdown: working, and what the measurements said

It renders. Three follow-ups from Javi, all resolved by measuring rather than
guessing - the two rounds lost above were both guesses.

**"Seems a bit small" is a WIDTH effect, not a height one.** Measured at 100px:
Bebas Neue caps ink is **0.99x** Raleway's - vertically identical - but only
**0.59x the width**. A condensed face reads smaller at the same nominal size.
So `fonts.alt.scale` = **1.4**.

Before setting it, the obvious worry was the bands overflowing, since `NH` and
`oh` are baked from the Raleway sizes at build time and do NOT follow the
expression. Checked against every band in all four formats: Bebas at 1.4x still
clears the box with **20-32px to spare** (name band, reels: ink 45px in a 72px
band). **No band geometry change needed** - which is the invasive expression
surgery this measurement avoided.

**Font before placing.** The picker was edit-only, so a UN-style lower third meant
place-then-switch. `collectValues()` now sends **`@font`** and `ochaAdd` applies it
right after insert. The `@` prefix matters: bare keys go into `kvMap`, which drives
the clip's auto-name, so a plain "Font" key would have produced
"OCHA Lower Third - 2". Ignored silently on a template without the control.

**Lag.** Selecting a clip cost TWO CEP round trips (`ochaReadMotion` +
`ochaFontStatus`), and round trips are the slow part - that is why the panel felt
worse than Premiere's own Properties. `ochaReadMotion` now returns the font index
as a seventh field and `syncFont` is synchronous. The remaining write latency is
one round trip and is inherent to CEP; Properties will always feel more immediate
because Premiere sets its own control directly.

RULE: measure the fonts before changing geometry. Cap height, ink height and
advance width are three different things, and "looks small" usually means width.

### The panel died because of a COMMENT: never start one with "@"

Symptom: the format chip read `host: not sourced (typeof=EvalScript error.)`, the
Add button was permanently greyed, and it survived a full Premiere restart. Every
`ocha*()` call failed — the panel could not reach Premiere at all.

Cause: one line I added inside `ochaAdd`,

    // @font: the typeface chosen BEFORE placing, ...

**ExtendScript's preprocessor reads a comment beginning with `@` as a DIRECTIVE**
— the same mechanism that provides the at-include and at-target forms. `@font` is
not a known directive, so it is a SyntaxError, and a SyntaxError anywhere means
the **entire file fails to load**. No function is ever defined; every call returns
`"EvalScript error."`.

What made this expensive (four wrong rounds) is that *nothing* points at it:

* `node --check` passes. **acorn with `ecmaVersion: 3` passes.** The construct is
  legal JavaScript — the preprocessor is Adobe's, above the language.
* The panel's own error names no file and no line, and reads exactly like a wedged
  Premiere. I chased a stale script engine, then a Dropbox placeholder, then a
  third-party panel (Motion/Boombox) — Javi correctly rejected that last one:
  *"45 previous versions worked with those extensions."*
* The CEP log only says `AsyncEvalScriptFileCallback ... error code 27`.

What actually found it, in ten seconds: **loading the file in After Effects.** AE
runs the same language, `host.jsx` only defines functions at load time, and AE's
`$.evalFile` reports `SyntaxError` **with the line number**. That is now
`premiere/ae/check_host_loads.jsx` — reach for it FIRST whenever the panel says
"not sourced", instead of reasoning about Premiere's state.

Guard: `tools/check-jsx.py` fails on an `@`-comment (anywhere in the line, since
the directive scanner does not require column 0), on non-ASCII in `host.jsx`, and
on let/const/arrows/template literals. Verified both ways — it flags the exact
line when the bug is reintroduced and passes when it is not. ASCII is enforced for
`host.jsx` ONLY: it is the file that crosses CEP's evalScript bridge, whereas the
AE builder is read from disk and has carried em-dashes for years.

RULE: when an ExtendScript file "doesn't load", do not reason about the host
application. Load it in After Effects and read the line number.

### Font dropdown: two follow-ups, one shared root

**"Changing the font works in Properties but not in the plugin."** `setBound()`
calls `selectEl()` whenever a clip binds, and `selectEl()` was calling
`syncFont(null)` — which clears `fontClip`. So `syncAdjust` bound the dropdown to
the clip and, a beat later, `selectEl` unbound it. The change handler's first line
is `if (!fontClip) return`, so the dropdown went inert from the panel while
Premiere's own Properties (which talks to the template directly) kept working.
Split in two: `fontVisibility()` for show/hide, `syncFont()` as the SOLE owner of
the binding, called only from `syncAdjust`.

RULE: when two functions can write one piece of state, the one that runs on a
timer wins the race you didn't think about. Give the state a single owner.

**"Default on lower thirds is not OCHA Raleway."** The dropdown was doing double
duty — showing the selected clip's font AND supplying the next Add's font. Edit a
UN-style clip, deselect, place a new lower third: it came out Bebas. Now a
separate `placementFont` holds the next-Add choice; editing a bound clip never
touches it, and returning to placement mode restores the dropdown to it.

Verified as a state machine in the panel preview with the host stubbed (six
transitions): the binding survives `selectEl`; editing a clip leaves
`placementFont` alone; choosing Bebas with nothing selected does carry into the
next Add; deselecting restores the placement choice. Default ships as Raleway.

### The real cause: a MOGRT dropdown is counted TWO ways

Javi's observation is what cracked it: *"Bebas on the plugin reflects an empty
dropdown in Properties, and Raleway reflects Bebas."* That is an off-by-one, in
one direction, with the last item falling off the end.

**The same stored value is 0-based from Premiere and 1-based in an AE expression.**

| | first item | second item |
|---|---|---|
| Panel -> Premiere MOGRT API (`setValue`) | **0** | 1 |
| AE expression (`effect('Font')('Menu')`) | **1** | 2 |

The panel was sending 1-based, so Raleway(1) landed on Bebas and Bebas(2) landed
out of range - Properties showed an empty field and AE clamped to the last item,
which is why BOTH options rendered Bebas.

The precedent was already in the repo and I missed it twice: `main.js` sends
`push("Pin colour", blue ? 1 : 0)` with the comment **"0-based: Red=0, Blue=1"**,
while the builder's fill expression reads `m == 1 ? red : blue`. Same control,
both conventions, already documented in a one-line comment.

Fixed panel-side only (options 0/1, `placementFont = 0`, host clamps at >= 0).
**The AE expression was always right** - `f == 2` for the second item is correct
1-based - so no template rebuild was needed.

Second-order trap this created: **0 is a valid value that falsy checks eat.**
`parseInt(v, 10) || 1` turns Raleway into Bebas, and `if (!n)` hides the group for
a Raleway clip. Both now test `isNaN()`; `""` from `ochaReadMotion` remains the
only "no Font control" sentinel. Verified across six transitions in the panel
preview with the host stubbed, including the two 0-valued cases.

RULE: before wiring a new MOGRT control, find an existing one of the same TYPE and
copy its index convention. Do not infer it from the AE side - they disagree.

### Track choice now sits where the element is added

Javi: *"Gradients, vignette and any element offer the track to be added as an
option."* The picker existed — but only on the **Branding** tab, under the Add
button. Gradient and vignette are placed from the **Toolbox**, in a modal, so the
control was a tab away and behind the dialog at the exact moment it was needed.
`addGradient`/`addVignette` were already passing `trackPref()`; it just read a
value nobody could see.

The tool modal now carries its own Track row, shown only for tools that actually
place a clip (an explicit `places: true` on the gradient and vignette configs, not
inferred from `settings` — a future tool could have settings and place nothing).
It resets to Automatic on every open, so a track chosen for one gradient cannot
ride into the next.

**One list, two pickers.** `refreshTracks()` fills both selects from the same
`ochaTrackList()` call. Two independently-populated dropdowns that could disagree
about what V3 is would be worse than the problem being solved.

`trackPref()` reads the modal's picker only while a clip-placing tool is open,
falling back to the Branding one. Gating merely on "a modal is open" returned a
stale index from tools whose Track row is hidden (Package, Tidy) — a number the
user never chose.

Two traps avoided on the way: `$("modal")` does not exist (the element is
`tool-modal`) — that would have thrown on the first call; and the row is an
`.adj-row`, i.e. `display: flex`, which normally beats the `hidden` attribute —
safe here only because styles.css already carries a global
`[hidden] { display: none !important; }` (line 296). Verified both.

### "Convert all audio to stereo" — NOT buildable, and the probe says why

Javi asked for a Toolbox button mapping source ch1 to L and ch2 to R on 12-channel
files, in the project panel and the sequence. Answer: **Premiere's scripting API
does not expose audio channel interpretation at all.** Measured, not assumed —
`premiere/cep/jsx/probe_audio_api.jsx` (since removed) reflected the live objects
in Premiere 26.3.0:

| object | methods | audio/channel-related |
|---|---|---|
| `ProjectItem` | 53 | **0** |
| `TrackItem` | 10 | **0** |
| QE Sequence | 61 | 9, all track-level (add/remove/mute tracks, display format, frame rate, render) |
| QE audio track | 14 | 1 — `addAudioEffect` |

The telling detail is what `ProjectItem` DOES expose: `setOverrideFrameRate`,
`setOverridePixelAspectRatio`, `setScaleToFrameSize`, `setOverrideColorSpace`.
Several other Modify-dialog interpretations are scriptable — **audio channels is
the one that is not.** So this is a deliberate gap in Adobe's API, not something a
cleverer approach reaches. `addAudioEffect` could bolt on Fill Left/Fill Right,
but that duplicates a channel rather than mapping 1 to L and 2 to R, so it is the
wrong answer, not a workaround.

Caveat noted for honesty: the probed item happened to be a sequence
(`isSequence: true`). ExtendScript reflection is per CLASS, so a media clip
returns the same method table — the conclusion stands.

The real fix is upstream, not a button: Premiere's Preferences > Audio > Default
Audio Tracks lets multichannel media default to Stereo **on import**, which
prevents the problem instead of repairing it clip by clip. (Not verified from
here — the prefs file is not plain key=value — so it needs confirming in the UI.)

RULE: when an API question decides whether a feature exists, ask the running
application with a reflection probe. It cost one round trip and replaced a guess
with a table. Same move as check_host_loads.jsx.

## 2026-07-31 — 2026.0.47 shipped; 2026.0.48 built (fade, align, audio tidy)

**2026.0.47 is live** — Bebas Neue on lower thirds, Advanced settings, track
choice for gradient and vignette. Pushed to main; the updater sees it and the
signed package downloads. The same push published the web app at 2026.0.32,
which carries the Windows encoding crash fix.

### 48: three tools, and what each one can honestly do

**Fade / Strength on a placed clip.** Select a gradient or vignette and a slider
appears. The value rides along on `ochaReadMotion` (which already runs every
tick) rather than a second call, exactly like the font index. It is NOT in
Advanced settings: for a gradient the fade is the point of the element, not an
off-standard tweak. Adopting the polled value is gated on the clip CHANGING, or
the 900ms poll would snap the slider back from under the pointer mid-drag.
This also makes the vignette's own help text true — it has always said "select
the clip afterwards to fine-tune Amount", which was not implemented.

**Align to frame** — six buttons, laid out as Premiere lays them out. Two very
different jobs behind one row:

* **OCHA templates are exact.** Their Position X/Y are element-edge percentages
  the template clamps element-exact, so "align left" IS the slider at 0. Nothing
  is measured and nothing is assumed.
* **Any other clip** needs visual bounds, and **neither ProjectItem nor TrackItem
  exposes width or height** (measured by reflection, Premiere 26.3.0). Bounds are
  therefore reconstructed from the source frame size in project metadata times
  Motion's Scale. When that read fails the button REFUSES and says why — it does
  not move the clip to a guessed position.
* **Centring never needs any of it.** Motion Position 0.5 centres a clip whatever
  its size, so the two centre buttons work on absolutely anything.

**Tidy audio tracks.** Removes audio tracks holding no clips, via the QE DOM
(`removeEmptyAudioTracks` — the documented API has nothing). Scoped honestly: a
track with a clip on it is never touched, even if the clip is silent. Deleting
audio because it happens to be quiet is not a decision a tool should make.

### Three traps caught while building, all by a control test

* **`cfg.info` is a CALL STRING, not a function** — `loadInfo` passes it straight
  to `jsx()`. Writing `info: async () => {...}` would have sent a function object
  down the bridge. Read the contract before inventing a hook.
* **The align grid was nested inside `#modal-settings`**, which is hidden for any
  tool without `settings`. `getComputedStyle(el).display` still reports "block"
  for a child of a hidden parent, so the first check passed and the buttons were
  invisible. **`offsetParent !== null` is the honest test.** Moved out to a
  sibling.
* **A literal multiplication sign** reached the source in a regex.
  `tools/check-jsx.py` caught it before it could cross the evalScript bridge; it
  is written `×` now. The checker has paid for itself twice in one day.

RULE: when a grep or a probe returns "nothing", run it against something you KNOW
is there before believing it. That control test caught a wrong conclusion three
times today — searching Premiere's binaries, counting align buttons, and checking
CSS tokens that are declared several per line.

### Tidy tracks removed nothing: it was fed row INDEXES and said "Removed"

Javi: "shows the whole process but nothing gets removed." Cause found in one
grep: `listTicked()` returns the tick-list's ROW INDEXES ("0,2") because that is
what Remove unused's host call expects — but `ochaRemoveTracks` parses NAMES
("V2,A15"). It read "0", took "0" as the track kind, matched neither V nor A,
skipped every entry, and the old counting (increment on non-throw) reported
success over a complete no-op. New `listTickedLabels()` feeds it the labels.

Hardened while there: each QE removal is now VERIFIED against the sequence —
the count must drop by one and the clip-count fingerprint of everything else
must be unchanged. If Premiere ever removes a different track than asked (QE's
index base is undocumented), it stops after ONE removal and says to press Undo.
Zero-removed now returns ERR, never a cheerful success.

RULE: a destructive call is not done when it returns — it is done when the
world changed the way you asked. Count before, count after, compare.

### Edit mode now follows the selection while the modal is open

Deselecting the gradient mid-modal left "editing selected" stuck (Javi's #2).
A 900ms watcher now runs while a gradient/vignette modal is open: deselect and
the note clears, the CTA flips back to "Add gradient" IMMEDIATELY (not after
loadInfo's host round-trip), and selecting one mid-modal flips into editing.
Transitions only — re-running the full check every tick would snap the slider
back under the pointer mid-drag. `openTool` also resets `editTarget` for every
tool, or a leftover edit state would make the NEXT tool's Run merely close.

### Align removed; Fix colour absorbed into one Colour tool

**Align is gone** (Javi's call, and mine). Two things killed it: on Premiere text
the thing you want aligned is the LAYER INSIDE the graphic, which no scripting
interface reaches - so "nothing works" was exactly right; and on a lower third
the template's own clamp will not allow it to the top, which is correct behaviour
for a lower third. A tool that half-works on our elements and cannot touch text is
a support burden forever. Removed from all five layers (tile, grid, config, host,
CSS) rather than left disabled.

RULE: when the honest version of a feature is "works sometimes, on some clips",
delete it before it ships. The explaining costs more than the feature is worth.

**Fix colour is now section one of a Colour tool.** Not renamed to "Fix iPhone
colours": that tool changes the SEQUENCE's working colour space, touches no clip
and knows nothing about phones - iPhone footage is the usual cause, but log
footage and some mirrorless cameras do it too, and someone with a washed-out
GoPro would skip a tool named after a phone. The symptom is the useful name.

Three sections, in the order you should work:
1. **Sequence setup** - the existing Rec. 709 fix, with its settings AUDIT intact
   (a blind whole-object write is suspected of having wrecked a project's colour
   once, so the host still reports any other setting that moved).
2. **Look** - the web app's four presets.
3. **Adjust** - Brightness, Contrast, Warmth, Colour.

**The numbers are the web app's** (`engine/look.py`), so a clip corrected in the
plugin and one corrected in the web app land in the same place. Slider `step` is 1,
not 5: at 5 the Warm look's warmth snapped 26 -> 25 and the two products would have
quietly disagreed.

**One application path.** Choosing a look PRELOADS the four sliders, so by the time
the button is pressed the sliders ARE the look - a separate ochaApplyLook call
could only ever disagree with what is on screen. It was written, then deleted.

**The button changes job, not availability:** while the sequence is still
wide-gamut it reads "Set sequence to Rec. 709" and does that; once the sequence is
right it becomes "Apply to clips". `countGated` had to be excluded for this tool,
or a correct sequence would have greyed out the whole colour panel.

Applied through **Lumetri Color**, attached the same way the reel's Gaussian Blur
already is (`qe.addVideoEffect`, then the normal DOM component). Lumetri's
parameter names are undocumented and version-dependent, so each setter tries a
list of likely names and REPORTS which ones did not match - "adjusted 3 of 4
parameters" is useful; a cheerful "done" over a no-op is what Tidy tracks just
taught us to avoid.

Testing note: `loadInfo()` returns early when `hostReady` is false, so a browser
test of any tool's CTA must set `hostReady = true` first. My first run showed the
button permanently disabled and I nearly "fixed" code that was fine.

### Colour round 2: QE counts gaps as items

Javi's diagnostic line did its job in one round trip: `targets=1
lumetriMissing=1` - clip found, parameter names fine (a clip at the head of a
track worked), Lumetri not attaching elsewhere. Cause: `ochaEnsureLumetri` looked
the clip up with `qt.getItemAt(domClipIndex)`, and **QE's item list includes the
EMPTY GAPS between clips**, so the DOM index only lines up for a clip at the head
of a gapless track. Worse than failing: on a gap-then-clips layout the index can
land on a DIFFERENT real clip and the effect would silently attach to it.

Fix: match the QE item by the clip's `start.ticks` (tick strings compare exactly),
skipping items whose type is Empty. No match = fail and say so - never fall back
to an index.

RULE: a DOM clip index is NEVER a QE item index. Any DOM->QE hop must match by
start ticks, not position. (Same family as the dropdown 0/1-base and the
sourceRectAtTime-at-time-0 traps: two Adobe APIs describing one thing, each with
its own counting.)

Also this round, per Javi: the Colour modal's prose cut to two lines, small
swatches, tighter rows - the controls are the explanation. Modal measured 577px.

### Colour goes live, and gains shadows / highlights

Javi: "life updates when moving the sliders instead of clicking apply", plus the
classic pair — lift the shadows, pull the highlights back.

**Two speeds, because the two scopes cost very different amounts:**
* **Selected clips** - `input`, debounced 140ms. Measured: a 12-tick drag becomes
  ONE call, because the debounce coalesces and a busy-guard refuses to stack calls
  into Premiere (the last value always wins, so the result matches the slider).
* **Whole sequence** - `change` only, i.e. one call when you let go. Rewriting
  every clip per pixel of drag would hammer Premiere, and a slider that silently
  rewrites forty clips WHILE you move it is alarming rather than helpful. The hint
  under the sliders says which mode you are in.

The first call on any clip is the slow one (Lumetri has to attach and its
parameters appear a beat later); every call after that just sets values.

**Highlights is INVERTED on purpose.** Lumetri's own Highlights goes darker as it
goes negative; a user dragging a slider labelled "Highlights" to the right expects
blown areas to come BACK. The panel's sign is the user's mental model, and the
host flips it.

**The button lost its job.** With sliders and looks applying themselves it does
one thing: the sequence Rec. 709 fix, which is a project setting rather than a
clip effect and deserves an explicit press. When the sequence is already right it
reads "Done" and just closes.

Repair note: a line-range replacement in the TOOLS object swallowed the closing
brace and left a duplicate, which `node --check` caught as "Missing initializer in
const declaration" pointing at the NEXT tool - a reminder that a JS syntax error
usually names the token AFTER the damage, not the damage.

### Colour becomes an editor, not a one-shot

Javi: "can everything reset when a new clip is selected? and can the edited clips
maintain the info of what was modified, so we can adjust later?" - one mechanism
answers both. `ochaReadColour()` reads the clip's REAL Lumetri values back into
panel units (the exact inverse of the apply maths), so:

* a graded clip shows its own numbers - you continue from where it is;
* an ungraded clip shows zeros - which reads as the reset he asked for;
* selecting a different clip mid-modal reloads ITS values.

Without it the sliders would have lied: sitting at zero over a graded clip, so the
first nudge would silently throw away everything applied before.

Repopulation happens on a CLIP CHANGE only, never per tick - the same discipline
the fade slider needed, or the poll fights the pointer mid-drag.

**A banner names the target** ("Interview 01.mov" / "No clip selected"), accent
when live, muted when not. Colour edits are invisible until you look at the
picture, so naming what is about to change is the difference between confidence
and guesswork.

**Resets**: one per slider (reusing the position rows' reset icon) and Reset all.
Both apply immediately - a reset you have to confirm is not a reset.

**The sequence fix moved to the BOTTOM in its own bordered section**, with its own
full-width button that greys to "Sequence is Rec. 709" when there is nothing to
do. It is a project setting, not a clip effect, and the per-clip work is what
people open this tool for. The footer CTA is gone entirely (`noRun`): with sliders
live and the fix owning its own button, a third button could only repeat something
already done. Cancel reads "Close".

**Highlights is NOT inverted** - reversed on Javi's call. An earlier version
flipped it so dragging right "recovered" blown areas; the plain reading (left
darker, right brighter, same as Lumetri's own slider) wins. A control that
disagrees with the panel it mirrors is a trap, however well-reasoned the flip.

Also fixed: the sequence reason printed twice - once in its own section, once in
the modal status line underneath. The section owns it now.

### Copy pass: 43% less text, same information

Javi: "simplify the text on readability gradient. Too many explanations... do a
review of other text explanations and simplify so it's no longer text everywhere."

Measured before rewriting, which is what made it tractable: 3,822 characters of
tool explanations across 11 tools, eight of them over 260 chars, the gradient at
431 with FIVE bullets. Now 2,184 across the same 11, none over 300, and no passage
anywhere in the panel over 90 characters.

The pattern in every over-long one was the same: explain, then re-explain, then
reassure. The gradient described what a gradient is, then where to put it, then
Middle, then Middle's halves. Package said "your originals stay put" twice in
different words. Vignette explained sequence-size independence nobody had asked
about.

What survived the cut, in order of priority:
1. what it does, in one line;
2. the one thing that would surprise you (the gradient goes BELOW your text; a
   track holding a silent clip is never removed);
3. genuine safety facts - nothing on disk is touched, undo works.

What went: history ("this replaces Clean MOGRTs"), restating visible UI, reassurance
nobody needed, and the second sentence saying the first again. Also trimmed the
Captions step list from five dense steps to four short ones, and the two long panel
hints - including the Track hint that repeated the bullet directly above it.

RULE: measure copy before editing it. "Too much text" is a feeling; 431 characters
in five bullets is a number, and it tells you which ones to open first.
