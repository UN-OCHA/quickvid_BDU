# OCHA QuickVid

Add OCHA branding to your videos in a few clicks — **lower thirds**, an on-brand
**ending**, and (soon) **subtitles** — auto-placed for your format and social safe
areas. Your video is processed **on your own machine; files never leave it.**

Two modes:

- **Titles & branding** — add OCHA lower thirds + an ending to a video you've
  already cut in CapCut, Canva, Premiere, etc. *(working)*
- **Edit** — transcript-driven editing: you edit the **words, not the timeline**,
  and the cuts + branding follow. *(in development)*

## Status

Today QuickVid runs as a small **local app** (Python/FastAPI + a static web UI + an
ffmpeg engine). A **browser version** — one link, any operating system, nothing to
install — is in development and will be published here on GitHub Pages.

## Design

The interface comes from the shared **OCHA App Kit**, the app-facing layer of the
[OCHA Common Design System](https://github.com/UN-OCHA/ocha-common-design-system-BDU),
so QuickVid stays visually consistent with other BDU tools.

## Run it locally (current version)

Requirements: **Python 3** and **ffmpeg**. QuickVid starts a small local server and
opens in your browser. See [`docs/`](docs/) for setup and design notes.

## Project Owner

Javier Cueto — Head of the Brand and Design Unit (BDU), OCHA

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
