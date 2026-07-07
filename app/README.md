# OCHA QuickVid — local web app

FastAPI backend + a static browser UI. Reuses `engine/` directly; raw 4K files
never leave the machine. See `../HANDOFF.md` for the full project briefing and
`../docs/decisions.md` for why it's built this way.

## Run

```bash
cd ocha_quick_vid
/opt/homebrew/bin/python3.11 -m venv .venv      # 3.11 — not 3.14 (no Whisper wheels yet)
source .venv/bin/activate
pip install -r requirements.txt
./app/dev.sh                                    # uvicorn on :8000, auto-reload
# open http://localhost:8000
```

First transcribe downloads the Whisper model once (~140 MB for `base`). 4K decode
uses Homebrew ffmpeg + VideoToolbox automatically — see `../docs/environment.md`.

## Flow (maps to HANDOFF §8.2)

1. **Source folder** — Browse… (native macOS picker) or paste a path,
   **Transcribe** (Whisper model is fixed at a sensible default, not user-chosen).
2. **Transcript & instruction** — copy the transcript into your LLM to get a
   video-instruction JSON (or write the `keep`-list yourself), **Run**.
3. **Preview & export** — play the assembled cut, **Download MP4**.

## Layout

```
app/
  backend/
    main.py            FastAPI: routes + serves the SPA
    settings.py        paths, ffmpeg selection (steers engine to Homebrew ffmpeg)
    jobs.py            in-process job registry (threaded, polled by the UI)
    engine_bridge.py   subprocess wrappers around engine/transcribe.py + run.py
  web/                 index.html · app.js · style.css  (no build step)
  workspace/           per-job dirs: segments.json, transcript.txt, final.mp4  [gitignored]
```

## API

`GET /api/config` · `POST /api/pick-folder` · `POST /api/transcribe` ·
`GET /api/jobs/{id}` · `GET /api/jobs/{id}/transcript` · `POST /api/render` ·
`GET /api/preview/{id}` · `GET /api/export/{id}`

## Not yet wired (engine phases — HANDOFF §8.3–8.7)

captions render · OCHA branding (logo / lower-thirds / vignette / location title
/ ending) · multi-format layout (templates seeded in `brand/brand.json`) ·
Premiere XML. The instruction contract already carries `captions`,
`lower_thirds`, and `formats`, so the UI stays stable as those engines land.
```
