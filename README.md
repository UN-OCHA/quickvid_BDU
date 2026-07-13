# OCHA QuickVid

**Use it now: <https://un-ocha.github.io/quickvid_BDU/>**

OCHA-branded videos in a few clicks — **lower thirds**, the on-brand **ending
with the click**, **burned-in captions**, and a full **statement-clip editor**
that cuts a principal's remarks straight from UN Web TV. Everything runs **on
your own machine; your videos never leave it.**

Two modes:

- **Titles & branding** — add OCHA lower thirds + an ending to a video you've
  already cut in CapCut, Canva, Premiere, etc. Runs entirely **in your browser**
  (Mac or Windows), nothing to install.
- **Edit → Statement clip** — paste a UN Web TV link, tick the sentences that
  carry the message, and QuickVid transcribes, cuts with broadcast-style
  punch-ins, captions, adds the animated lower third and the OCHA logo-click
  ending, and packages everything into a tidy job folder. Needs the free local
  engine below (Mac; a Windows version is planned).

## Getting the full tool (Mac & Windows)

Everything happens from the **Edit tab of the web app** — no ZIPs, no folders
to keep track of, **no admin rights**:

- **First time** → download the **installer** the page offers
  (`Install QuickVid`), double-click it in your Downloads. It sets everything
  up by itself (~10 minutes: Python if missing, the video engine, the
  speech-recognition model), installs QuickVid into a system folder you never
  need to open, and **starts it when done** — the page unlocks on its own.
- **Every time after** → download the tiny **starter** (`Start QuickVid`) once,
  keep it in Downloads or on your Desktop, and double-click it whenever you
  want to edit. The engine runs quietly in the background until you shut down;
  the page unlocks in seconds. Re-running the **installer** later = update.

Each freshly downloaded file triggers one security nag — that's normal for
internet downloads: macOS says *“unidentified developer”* (**right-click →
Open → Open**); Windows shows SmartScreen (**More info → Run anyway**).

> The Windows engine is fresh — if anything misbehaves, tell
> [ochavisual@un.org](mailto:ochavisual@un.org) and use **Titles & branding**
> (works fully in the browser) in the meantime.

<details>
<summary><strong>Manual / developer install</strong> (the old way — still works)</summary>

[Grab the ZIP](https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip),
unzip anywhere, and run `Start QuickVid.command` (Mac; right-click → Open the
first time) or `Start QuickVid.bat` (Windows). Same self-setup, but the engine
lives in your folder and the window stays open while you work.
</details>

## Design

The interface comes from the shared **OCHA App Kit**, the app-facing layer of the
[OCHA Common Design System](https://github.com/UN-OCHA/ocha-common-design-system-BDU),
so QuickVid stays visually consistent with other BDU tools.

## For developers

`Start QuickVid.command` is just: a Python venv from `requirements.txt` +
`uvicorn app.backend.main:app --host 127.0.0.1 --port 17870`. The UI is static
files in `browser/`; the render engine is plain-Python scripts in `engine/`
driven as subprocesses. Design decisions live in [`docs/decisions.md`](docs/decisions.md).

## Project Owner

Javier Cueto — Head of the Brand and Design Unit (BDU), OCHA

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
