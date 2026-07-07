#!/usr/bin/env bash
# Launch the OCHA QuickVid local web app (auto-reload) on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
exec uvicorn app.backend.main:app --reload --port 8000
