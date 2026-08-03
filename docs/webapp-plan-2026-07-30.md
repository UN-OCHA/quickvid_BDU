# QuickVid web app — findings + plan (2026-07-30)

Seven items. Each one: **what I found** (measured, not assumed) and **what I propose**.
Nothing below is built yet.

---

## 1. Saving / reopening — "source not connected", renamed folders, existing folders

**Found — four separate faults, one symptom.**

1. **The source path is absolute and never re-checked.** `stSnapshot()` stores
   `src: ST.src` verbatim. `stRestore()` assigns it back with no existence test —
   there is no "source missing" branch anywhere in `statement.js`. Move or rename
   the folder and the project reopens *looking fine*, then fails at the first
   render or still.
2. **Renaming the project silently moves the folder.** `ST.jobDir` is built as
   `<parent>/<project name>`. Change the name and the next autosave writes a
   **new folder**; the old one is left behind with its files.
3. **The rename also deletes the old project file.** `st_save_project` unlinks
   every `*.ochaquickvid.json` in the folder whose name differs from the new one.
   Combined with (2) that is how a project can appear to vanish.
4. **Picking an existing folder nests one inside it.** The picker always appends
   the project name, so choosing an already-made `Julien Harneis Ebola/` gives
   `Julien Harneis Ebola/Julien Harneis Ebola/`.

**Propose**

- Store the source **relative to the job folder** when it lives inside it
  (`source/clip.mp4`), absolute only when it doesn't. Resolve relative-first on
  open, so the whole folder can be renamed, moved or synced to another machine.
- On open, **verify the source and every referenced file**. If one is missing,
  say which and offer **"Locate the video…"** (native picker) rather than failing
  later. Re-point and re-save in one step.
- **Reuse an existing folder.** If the chosen folder already looks like a job
  folder (has `source/` or a project file), offer *"Use this folder"* vs
  *"Create a subfolder"* instead of always nesting.
- **Rename = rename**, never delete-and-recreate: rename the project file in
  place, leave the folder alone, and only offer to move the folder explicitly.

*Also fixed already (not yet pushed): a 0-byte cloud placeholder now explains
itself instead of "isn't a readable project" — that was today's Ebola project.*

---

## 2. Look previews too small

**Found.** `.look-grid` is `repeat(auto-fill, minmax(120px, 1fr))` — four cards
across a 820px column, so each preview is ~120px wide for a 9:16 still.

**Propose.** `minmax(200px, 1fr)`, request the still at a matching width, and let
the grid drop to two-up on narrow screens. Bigger images cost nothing extra: the
stills are already cached server-side and, since yesterday, browser-cached too.

---

## 3. Colour balance — warmer / cooler, green / magenta

**Found.** `engine/look.py` offers four fixed presets and its own docstring says
*"there are no free sliders to push a video off-brand"*. So this is a deliberate
reversal of an earlier decision — worth stating plainly rather than slipping in.

**Propose** two symmetrical sliders, both centred on 0 = no change:

| Slider | Range | ffmpeg |
|---|---|---|
| Warmth (cooler ↔ warmer) | −100…+100 | `colortemperature=temperature=…` |
| Tint (green ↔ magenta) | −100…+100 | `colorbalance=gm=…` |

- Clamped to a **modest** range so it corrects a cast without recolouring the
  video — a green newsroom or an orange tungsten room, not a grade.
- Lives in `look.py` beside the presets, so both tabs and both render paths get
  it for free, and it stays *under* all branding.
- The framing/look preview already re-renders through the same chain, so you see
  it before rendering.

---

## 4. AI prompt is too prescriptive

**Found.** `stAIPrompt()` hard-codes two things you can't override: it *forces* a
Q&A ("ask me these questions and WAIT"), and it *forces* a cap ("never exceed 90
seconds unless I asked for longer"). There is no way to say "these exact
sentences" or "no limit".

**Propose.** Put the decisions in the panel, and let the prompt reflect them:

- **Target duration**: a field with a "No limit" option. Feeds the prompt.
- **Must include**: sentence numbers the AI *must* keep (typed, or ticked in the
  list). The prompt states them as fixed.
- **Must avoid**: same, optional.
- Skip the forced Q&A when those are filled — ask only for what's still unknown.
- Keep the JSON answer contract exactly as is; `stAIParse` needs no change.

---

## 5. OCHA editorial style guide for the AI and the transcript

**Found.** Whisper output goes to the cues verbatim. Nothing capitalises
*Member States*, *Secretary-General*, *Under-Secretary-General* and so on, and
the AI prompt says nothing about house style.

**Propose** — two halves, one shared source of truth:

- `brand/ocha_style.json`: a term list (canonical spelling → variants) plus a few
  rules (numbers, dates, the serial comma).
- `engine/style.py`: applies the term list to cue text **after** transcription,
  before rendering. Whole-word, case-insensitive match → canonical form. Never
  rewrites what was said, only how it is spelled.
- The AI prompt gains a short style section generated from the same file, so the
  two can't drift.

**DONE (2026.0.31).** Built from your PDF: `brand/ocha_style.json` holds 81
canonical casings, 93 respellings and 13 protected names, each with the guide's
page number. `engine/style.py` applies it to word tokens (so `text` and `words`
never desync), gated to English. `GET /api/style/prompt` feeds the same file into
the AI prompt.

**Over to you — the term list is data, so any of these is a one-line edit.** Four
entries are judgement calls I made rather than found stated outright:
`meter → metre` (a *meter* is genuinely an instrument), `program → programme`
(correct except for computing), `defense → defence` (official names are in
`protect`), and `toward → towards`.

---

## 6. Subtitles in the editor should look like the final

**Found.** The editor renders each cue as a **single-line `<input>`**
(`captions.js`). The video wraps each cue to **two lines** at a budget computed
engine-side — `two_line_chars(sub)` ≈ `2 × max_w / (size × 0.55)`, minimum 44
characters. So you're editing on a different shape from the one that ships, and
grouping decisions are invisible until render.

**Propose.**

- Expose the character budget with the cues (the engine already computes it; the
  API just doesn't return it).
- Render each cue as a **two-line box at the real width**, wrapping exactly as the
  render does, in the caption font — so what you group is what you see.
- Flag a cue that **overflows two lines** (it will be split at render) and one
  that is very short (it will be merged forward), since both change grouping.
- Keep it a plain editable field — no rich editor.

---

## 7. Windows audit

Your colleague is right, and it isn't only their machine. Four real findings:

**a. Every cache is thrown away on each engine restart — the big one.**
Three endpoints key their cache with Python's `hash()`:

```
still      key = abs(hash((src, t, shot, preset, sx, sy, zoom, width)))
sync-prev  out = _syncprev_{abs(hash((src, offset, t)))}.mp4
look-prev  key = abs(hash((video, mtime, t, preset, phone_fix)))
```

`hash()` of a string is **randomised per process** (PYTHONHASHSEED is not set —
I measured three different values for identical input across three runs). So
after every restart, every still and preview re-renders from scratch, and the old
ones are orphaned. Windows feels it worse: process spawn is far dearer, and
antivirus scans each new file.

→ Replace with a stable digest (`hashlib.blake2b` of the same tuple).

**b. The workspace never gets cleaned.** No prune anywhere. On this Mac it is
**12 GB** with 72 orphaned stills and 11 sync previews. On a work laptop that is
a real problem, and it is all in AppData.
→ Prune on startup: drop `_still_*`/`_syncprev_*` older than N days or above a
size cap.

**c. ~~25 subprocess calls, none with `CREATE_NO_WINDOW`~~ — NOT a fault.**
I checked how the engine is actually launched: `tools/qv-engine.bat` runs
`start "OCHA QuickVid engine" /min cmd /c ...python -m uvicorn`, so it always owns
a console (minimized, but real). Console children attach to it and never open a
window of their own. Nothing to fix — 25 speculative edits avoided.

**c′. THE CRASH — a default encoding (fixed, 2026.0.31).** You gave me the three
contexts and they pointed straight at it. **Windows text I/O defaults to the ANSI
codepage (cp1252); macOS defaults to UTF-8**, and 22 reads/writes never said which.
Measured: cp1252 has no Arabic, no Polish `ł`, no Cyrillic — so the transcript
writer, `json.dump(out, open(path, "w"), ensure_ascii=False)`, is a hard
`UnicodeEncodeError` there and flawless here. Western accents (é, ô, ç) survive
cp1252 by luck, which is exactly why it hid for so long.

Fixed everywhere, including both ends of the render spec (written with
`ensure_ascii=False` in `engine_bridge`, read back in `statement.py` — that pair is
"editing subtitles after an export") and the ffmpeg/yt-dlp pipes, which decode with
the locale codec too and now use `errors="replace"` so a log line can't kill a job.

**d. Whisper runs `small` / int8 / CPU, fixed.** Fine on Apple silicon, slow on a
mid-range Windows laptop. **Not built — needs your call**, because it is a
user-felt trade-off: a smaller model is faster and less accurate. Options are an
automatic choice by measured machine speed, a visible setting in plain language
(not "tiny/base/small"), or leave it. Worth doing AFTER your colleague retries on
2026.0.31 — if the crash was the encoding, "slow" and "crashing" may not be the
same complaint.

---

## Suggested order

1. **(1) Save/open robustness** — it loses work; everything else is comfort.
2. **(7a + 7b) Cache key + workspace prune** — biggest speed win, small change.
3. **(6) Caption editor matches the render** — affects every clip made.
4. **(4) AI prompt controls** — small, self-contained.
5. **(2) Bigger look previews** — minutes.
6. **(3) Warmth / tint sliders** — needs your go on reversing "no free sliders".
7. **(5) Style guide** — needs the PDF and your review of the term list.
8. **(7c + 7d) Windows console flags + Whisper model choice.**
