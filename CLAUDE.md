# OCHA QuickVid — instructions for Claude

Local web app (FastAPI + static SPA + `engine/`). Files never leave the machine.
Two modes: **Edit** (transcribe → cut → brand) and **Titles & branding** (add
lower thirds + ending to a finished video). See `docs/decisions.md`.

## UI comes from the OCHA App Kit — do not restyle locally

This app's look & feel is the **shared OCHA App Kit**, the source of truth for all
BDU apps:

- **Kit source (edit here, never in this app):**
  `…/Design/Visual_identity/OCHA_design_system/ocha-common-design-system-BDU/app-kit/ocha-app-kit.css`
- **This app's copy** (synced, do not hand-edit): `app/web/vendor/ocha-app-kit.css`
- `app/web/style.css` is **OCHA QuickVid layout only** — no colors, no component styling.

**When a component looks/works wrong, or you need a new one:**
1. Edit the **kit** (`…/app-kit/ocha-app-kit.css`) — not this app. Reuse an existing
   `cd-*` component before inventing; if truly new, add it to the kit (kit-first).
2. Push it to every app + log it:
   ```bash
   cd "…/app-kit" && python3 sync.py && $EDITOR CHANGELOG.md
   ```
3. Reload — the change is now in OCHA QuickVid *and* every other OCHA app.

Use kit classes: `.cd-card`, `.cd-button` (+`--outline/--small/--export`),
`.cd-block-title` + `.step-num`, `.cd-form__input`, `.field-row`, `.mode-tab`,
`.app-player`, `.cd-alert`. Tokens: `--ocha-cyan`, `--ocha-blue`, `--ink`, `--line`, …

Static files are served no-cache; the launch config has no `--reload`, so **restart
the server for backend (Python) changes**.
