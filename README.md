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

## The full tool on your Mac

One-time setup, about 10 minutes, **no admin rights and no Homebrew needed** —
the start script sets everything up by itself (a portable video engine, the
OCHA brand font, and the speech-recognition model).

1. **Download QuickVid** — [grab the ZIP](https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip)
   and unzip it anywhere (Desktop is fine).
2. **Right-click `Start QuickVid` → Open → Open.**
   - ⚠️ The first time, macOS says *“can’t be opened — unidentified
     developer.”* That's normal for anything downloaded from the internet:
     **right-click → Open** is the official way past it, and you only do it
     once. (Double-clicking shows the same warning without the Open option.)
   - ⏳ The first run downloads its tools and a ~500 MB speech model — watch
     the progress in the Terminal window it opens. If your Mac has no
     developer tools yet, it may offer to install Apple's *Command Line
     Tools* — accept and let it finish, then run `Start QuickVid` again.
   - Every run after the first starts in a few seconds.
3. **Go to the QuickVid page in your browser** (the script opens it for you).
   The page detects the engine within seconds and the **Edit tab unlocks by
   itself** — the chip at the top turns cyan: *Engine connected*. Keep the
   little Terminal window open while you work.

**On Windows?** The Edit mode isn't available yet — the **Titles & branding**
tab works fully in your browser today, and a Windows engine is on the roadmap.

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
