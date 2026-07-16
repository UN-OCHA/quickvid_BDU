# OCHA QuickVid

**Use it now: <https://un-ocha.github.io/quickvid_BDU/>**

OCHA-branded videos in a few clicks — **lower thirds**, the on-brand **ending
with the click**, **burned-in captions**, and a full **statement-clip editor**
that cuts a principal's remarks straight from UN Web TV. Everything runs **on
your own machine; your videos never leave it.**

Two modes, one engine:

- **Titles & branding** — add OCHA lower thirds, burned-in subtitles and an
  ending to a video you've already cut in CapCut, Canva, Premiere, etc. Full
  quality, any size, any codec.
- **Edit → Statement clip** — paste a UN Web TV link, tick the sentences that
  carry the message, and OCHA QuickVid transcribes, cuts (continuous takes; a
  broadcast-style punch-in only where you skip ahead, marked "[...]" in the
  captions), adds the animated lower third and the OCHA logo-click ending, and
  packages everything into a tidy job folder.

OCHA QuickVid runs on a small **local engine** (Mac & Windows) — real ffmpeg +
Whisper on your machine. The web page is just its interface: open it with no
engine and it walks you through the one-time setup, then unlocks by itself.

## Setting up (Mac & Windows)

Everything happens from the web page — no ZIPs, no folders to keep track of,
**no admin rights**:

- **First time** → download the **installer** the page offers
  (`Install OCHA QuickVid`), double-click it in your Downloads. It sets everything
  up by itself (~10 minutes: Python if missing, the video engine, the
  speech-recognition model), installs OCHA QuickVid into a system folder you never
  need to open, and **starts it when done** — the page unlocks on its own.
- **Every time after** → download the tiny **starter** (`Start OCHA QuickVid`) once,
  keep it in Downloads or on your Desktop, and double-click it whenever you
  want to edit. The engine runs quietly in the background until you shut down;
  the page unlocks in seconds. **It updates itself** — each launch quietly pulls
  the latest OCHA QuickVid before starting (nothing to re-download by hand).

Each freshly downloaded file triggers one security nag — that's normal for
internet downloads: macOS says *“unidentified developer”* (**right-click →
Open → Open**); Windows shows SmartScreen (**More info → Run anyway**).

> The Windows engine is fresh — if anything misbehaves (or your machine's
> policy blocks the installer), tell
> [ochavisual@un.org](mailto:ochavisual@un.org) and we'll sort it out.

<details>
<summary><strong>Manual / developer install</strong> (the old way — still works)</summary>

[Grab the ZIP](https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip),
unzip anywhere, and run `Start OCHA QuickVid.command` (Mac; right-click → Open the
first time) or `Start OCHA QuickVid.bat` (Windows). Same self-setup, but the engine
lives in your folder and the window stays open while you work.
</details>

## Design

The interface comes from the shared **OCHA App Kit**, the app-facing layer of the
[OCHA Common Design System](https://github.com/UN-OCHA/ocha-common-design-system-BDU),
so OCHA QuickVid stays visually consistent with other BDU tools.

## For developers

`Start OCHA QuickVid.command` is just: a Python venv from `requirements.txt` +
`uvicorn app.backend.main:app --host 127.0.0.1 --port 17870`. The UI is static
files in `browser/`; the render engine is plain-Python scripts in `engine/`
driven as subprocesses. Design decisions live in [`docs/decisions.md`](docs/decisions.md).

## Project Owner

Javier Cueto — Head of the Brand and Design Unit (BDU), OCHA

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
