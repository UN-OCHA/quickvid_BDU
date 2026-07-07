"""OCHA QuickVid — local web app backend.

Serves the SPA and a small REST API that drives the engine/. Files never leave
the machine. Run: uvicorn app.backend.main:app --reload --port 8000
"""
import json
import re
import subprocess
from pathlib import Path
from typing import Optional, Union

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import settings, jobs, engine_bridge


class NoCacheStatic(StaticFiles):
    """Local dev tool — never let the browser cache CSS/JS, so edits show on
    reload (a stale style.css cache caused hours of 'why didn't my change apply')."""
    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp


app = FastAPI(title="OCHA QuickVid")
app.mount("/static", NoCacheStatic(directory=str(settings.WEB_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    return (settings.WEB_DIR / "index.html").read_text()


@app.get("/api/config")
def config():
    return {
        "formats": list(settings.brand().get("formats", {}).keys()),
        "ffmpeg": settings.FFMPEG,
        "default_model": settings.DEFAULT_MODEL,
    }


@app.post("/api/pick-folder")
def pick_folder():
    """Native macOS folder picker, for non-technical staff. Falls back to the
    manual path field in the UI if this isn't available / is cancelled."""
    script = 'POSIX path of (choose folder with prompt "Select the folder of raw clips")'
    try:
        result = subprocess.run(["osascript", "-e", script],
                                capture_output=True, text=True, timeout=300)
    except Exception as exc:                              # noqa: BLE001
        raise HTTPException(400, f"Folder picker unavailable: {exc}")
    if result.returncode != 0:
        raise HTTPException(400, "No folder chosen.")
    return {"path": result.stdout.strip()}


@app.post("/api/pick-file")
def pick_file():
    """Native macOS file picker for a single finished video (Titles & branding mode)."""
    script = 'POSIX path of (choose file with prompt "Select your video")'
    try:
        result = subprocess.run(["osascript", "-e", script],
                                capture_output=True, text=True, timeout=300)
    except Exception as exc:                              # noqa: BLE001
        raise HTTPException(400, f"File picker unavailable: {exc}")
    if result.returncode != 0:
        raise HTTPException(400, "No file chosen.")
    return {"path": result.stdout.strip()}


class TranscribeReq(BaseModel):
    folder: str
    model: Optional[str] = None


@app.post("/api/transcribe")
def transcribe(req: TranscribeReq):
    folder = req.folder.strip()
    if not Path(folder).is_dir():
        raise HTTPException(400, f"Not a folder: {folder}")
    job = jobs.create("transcribe", {"folder": folder, "model": req.model})
    jobs.run_async(job, engine_bridge.transcribe)
    return {"job_id": job.id}


def _extract_instruction(raw: Union[str, dict]) -> dict:
    """Tolerate the LLM wrapping the JSON in prose / code fences (same contract
    as engine/run.py), and validate it before we launch a render."""
    if isinstance(raw, dict):
        inst = raw
    else:
        match = re.search(r"\{.*\}", str(raw), re.S)
        if not match:
            raise HTTPException(400, "Couldn't find a JSON object in the instruction.")
        try:
            inst = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise HTTPException(400, f"Instruction isn't valid JSON: {exc}")
    if not inst.get("keep"):
        raise HTTPException(400, "Instruction has no 'keep' segments.")
    return inst


class RenderReq(BaseModel):
    source_job_id: str
    instruction: Union[str, dict]


@app.post("/api/render")
def render(req: RenderReq):
    src = jobs.get(req.source_job_id)
    if not src or src.kind != "transcribe" or src.status != "done":
        raise HTTPException(400, "Transcribe first — no finished transcript for that id.")
    inst = _extract_instruction(req.instruction)
    job = jobs.create("render", {"source_job": src, "instruction": inst})
    jobs.run_async(job, engine_bridge.render)
    return {"job_id": job.id}


class LowerThirdReq(BaseModel):
    name: str
    org: str = ""
    start: float = 0.0
    duration: float = 4.0
    align: str = "left"                      # left | center — left is the OCHA default


class EndingReq(BaseModel):
    style: str = "over_footage"               # over_footage | over_black | none — over_footage is the default
    darken: float = 0.0


class FinishReq(BaseModel):
    video: str
    lower_thirds: list[LowerThirdReq] = []
    ending: EndingReq = EndingReq()


@app.post("/api/finish")
def finish(req: FinishReq):
    """Titles & branding: add lower thirds + an ending to an already-edited video."""
    if not Path(req.video).is_file():
        raise HTTPException(400, f"Not a video file: {req.video}")
    if not req.lower_thirds and req.ending.style == "none":
        raise HTTPException(400, "Nothing to add — set at least a lower third or an ending.")
    job = jobs.create("finish", {
        "video": req.video,
        "lower_thirds": [lt.model_dump() for lt in req.lower_thirds],
        "ending": req.ending.model_dump(),
    })
    jobs.run_async(job, engine_bridge.finish)
    return {"job_id": job.id}


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    job = jobs.get(jid)
    if not job:
        raise HTTPException(404, "No such job.")
    res = dict(job.result)
    res.pop("transcript", None)            # heavy; fetch via /transcript instead
    res.pop("segments", None)
    return {
        "id": job.id, "kind": job.kind, "status": job.status,
        "progress": job.progress, "error": job.error,
        "result": res, "log_tail": job.log[-12:],
    }


@app.get("/api/jobs/{jid}/transcript")
def job_transcript(jid: str):
    job = jobs.get(jid)
    if not job or job.kind != "transcribe" or job.status != "done":
        raise HTTPException(404, "No transcript ready for that id.")
    return {"transcript": job.result.get("transcript", ""),
            "segments": job.result.get("segments", [])}


def _rendered_mp4(jid: str) -> str:
    job = jobs.get(jid)
    if not job or job.kind not in ("render", "finish") or job.status != "done":
        raise HTTPException(404, "No rendered video for that id.")
    return job.result["mp4"]


@app.get("/api/preview/{jid}")
def preview(jid: str):
    return FileResponse(_rendered_mp4(jid), media_type="video/mp4")


@app.get("/api/export/{jid}")
def export(jid: str):
    return FileResponse(_rendered_mp4(jid), media_type="video/mp4",
                        filename="ocha_quickvid.mp4")
