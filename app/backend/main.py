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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel

from . import settings, jobs, engine_bridge


class NoCacheStatic(StaticFiles):
    """Local dev tool — never let the browser cache CSS/JS, so edits show on
    reload (a stale style.css cache caused hours of 'why didn't my change apply')."""
    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp


app = FastAPI(title="OCHA QuickVid Engine")

# The engine is a LOCAL companion the web app talks to over localhost. Lock it
# down hard: bound to 127.0.0.1 (in the launch command), Host-header validated
# (blocks DNS-rebinding), and CORS limited to our GitHub Pages origin + localhost
# — no other website can reach it.
ALLOWED_ORIGIN_RE = r"^https://un-ocha\.github\.io$|^http://(localhost|127\.0\.0\.1)(:\d+)?$"
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_RE,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _private_network_access(request, call_next):
    """Chrome Private-Network-Access: an HTTPS page reaching this localhost engine
    must get this header on the preflight, or the browser blocks the request."""
    resp = await call_next(request)
    if request.headers.get("access-control-request-private-network"):
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


@app.get("/api/health")
def health():
    """The web app pings this to choose full vs browser mode. The distinctive
    `app` value is how it confirms it's really us, not some other localhost server."""
    return {
        "app": "ocha-quickvid-engine",
        "version": settings.VERSION,
        "modes": ["titles", "edit"],
        "ffmpeg": bool(settings.FFMPEG),
    }


@app.get("/api/config")
def config():
    return {
        "formats": list(settings.brand().get("formats", {}).keys()),
        "ffmpeg": settings.FFMPEG,
        "default_model": settings.DEFAULT_MODEL,
    }


@app.post("/api/pick-folder")
def pick_folder(prompt: str = "Select the folder of raw clips"):
    """Native macOS folder picker, for non-technical staff. Falls back to the
    manual path field in the UI if this isn't available / is cancelled."""
    safe_prompt = prompt.replace('"', "'")[:120]           # keep it inside the AppleScript string literal
    script = f'POSIX path of (choose folder with prompt "{safe_prompt}")'
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
    if not job or job.kind not in ("render", "finish", "statement") or job.status != "done":
        raise HTTPException(404, "No rendered video for that id.")
    return job.result["mp4"]


@app.get("/api/preview/{jid}")
def preview(jid: str):
    return FileResponse(_rendered_mp4(jid), media_type="video/mp4")


@app.get("/api/export/{jid}")
def export(jid: str):
    return FileResponse(_rendered_mp4(jid), media_type="video/mp4",
                        filename="ocha_quickvid.mp4")


# ---------------------------------------------------------------------------
# Statement clips (Edit mode) — clips of a principal's remarks from UN Web TV
# or a piece-to-camera file. Heavy steps run as jobs via engine/statement.py;
# quick lookups (probe, framing stills, sync previews) are inline.
# ---------------------------------------------------------------------------
import sys as _sys
_sys.path.insert(0, str(settings.ENGINE_DIR))
import statement as statement_engine                   # pure helpers: PRESETS, crops()

FFPROBE = settings.FFPROBE or "ffprobe"


class StDownloadReq(BaseModel):
    url: str
    lang: str = "floor"
    quality: str = "1080"
    dir: Optional[str] = None                          # the job folder → saves into <dir>/source/


@app.post("/api/statement/download")
def st_download(req: StDownloadReq):
    if not re.search(r"webtv\.un\.org|^1_[a-z0-9]+$", req.url.strip()):
        raise HTTPException(400, "That doesn't look like a UN Web TV link.")
    job = jobs.create("download", {"url": req.url.strip(), "lang": req.lang,
                                   "quality": req.quality, "dir": req.dir})
    jobs.run_async(job, engine_bridge.webtv_download)
    return {"job_id": job.id}


@app.get("/api/statement/file")
def st_file(src: str):
    """Stream a local video for in-app scrubbing. FileResponse is range-enabled, so
    the browser seeks without downloading the whole file — this is how the user finds
    the speaker's window in a long recording without leaving the app."""
    if not Path(src).is_file():
        raise HTTPException(400, f"Not a file: {src}")
    return FileResponse(str(src), media_type="video/mp4")


@app.get("/api/statement/probe")
def st_probe(src: str):
    if not Path(src).is_file():
        raise HTTPException(400, f"Not a file: {src}")
    r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height,r_frame_rate",
                        "-show_entries", "format=duration", "-of", "json", src],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise HTTPException(400, "Could not read that video.")
    j = json.loads(r.stdout)
    st = j["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    return {"width": st["width"], "height": st["height"],
            "fps": round(float(num) / float(den), 2),
            "duration": float(j["format"]["duration"])}


@app.get("/api/statement/sync-preview")
def st_sync_preview(src: str, offset: float = 0.0, t: float = 60.0):
    """5-second lip-sync test at a given A/V offset (+ = audio later). Rendered
    inline (a couple of seconds) so the user can flip through offsets quickly."""
    if not Path(src).is_file():
        raise HTTPException(400, f"Not a file: {src}")
    out = settings.WORKSPACE / f"_syncprev_{abs(hash((src, round(offset, 3), round(t, 1)))):x}.mp4"
    if not out.exists():
        cmd = [settings.FFMPEG, "-y", "-loglevel", "error",
               "-ss", str(max(0, t)), "-t", "5", "-i", src,
               "-ss", str(max(0, t - offset)), "-t", "5", "-i", src,
               "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise HTTPException(500, "Preview render failed.")
    return FileResponse(str(out), media_type="video/mp4")


class StSyncReq(BaseModel):
    src: str
    offset: float


@app.post("/api/statement/apply-sync")
def st_apply_sync(req: StSyncReq):
    if not Path(req.src).is_file():
        raise HTTPException(400, f"Not a file: {req.src}")
    if abs(req.offset) < 0.001:                        # already in sync — use the original
        return {"job_id": None, "path": req.src}
    job = jobs.create("applysync", {"src": req.src, "offset": req.offset})
    jobs.run_async(job, engine_bridge.statement_applysync)
    return {"job_id": job.id}


class StTranscribeReq(BaseModel):
    src: str
    start: Optional[float] = None
    end: Optional[float] = None
    ranges: Optional[list[list[float]]] = None         # several [start, end] windows (speaker talks in blocks)


@app.post("/api/statement/transcribe")
def st_transcribe(req: StTranscribeReq):
    if not Path(req.src).is_file():
        raise HTTPException(400, f"Not a file: {req.src}")
    job = jobs.create("sttranscribe", req.model_dump())
    jobs.run_async(job, engine_bridge.statement_transcribe)
    return {"job_id": job.id}


@app.get("/api/statement/segments/{jid}")
def st_segments(jid: str):
    job = jobs.get(jid)
    if not job or job.kind != "sttranscribe" or job.status != "done":
        raise HTTPException(404, "No transcript ready for that id.")
    return {"segments": job.result.get("segments", [])}


@app.get("/api/statement/still")
def st_still(src: str, t: float, shot: str = "general", preset: str = "reels",
             sx: float = 0.5, sy: float = 0.40, width: int = 540, download: int = 0,
             dir: Optional[str] = None):
    """A framing still: the general or close crop at time t (drives the framing
    sliders, per-segment shot thumbs, and — at full width — the thumbnail). When it's
    the thumbnail (download=1) and a job folder is set, also drop a copy in export/."""
    if not Path(src).is_file():
        raise HTTPException(400, f"Not a file: {src}")
    pr = st_probe(src)
    p = statement_engine.PRESETS.get(preset, statement_engine.PRESETS["reels"])
    general, close = statement_engine.crops(pr["width"], pr["height"],
                                            p["canvas"][0], p["canvas"][1], {"x": sx, "y": sy})
    w, h, x, y = general if shot == "general" else close
    key = abs(hash((src, round(t, 2), shot, preset, round(sx, 3), round(sy, 3), width)))
    out = settings.WORKSPACE / f"_still_{key:x}.jpg"
    if not out.exists():
        scale = f",scale={p['canvas'][0]}:{p['canvas'][1]}" + (f",scale={width}:-2" if width else "")
        r = subprocess.run([settings.FFMPEG, "-y", "-loglevel", "error", "-ss", str(t), "-i", src,
                            "-vf", f"crop={w}:{h}:{x}:{y}{scale}", "-frames:v", "1", "-q:v", "3", str(out)],
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            raise HTTPException(500, "Still render failed.")
    if download and dir:
        engine_bridge.save_still_to_export(out, dir)   # keep the thumbnail with the job
    kwargs = {"filename": "quickvid_thumbnail.jpg"} if download else {}
    return FileResponse(str(out), media_type="image/jpeg", **kwargs)


class StRenderReq(BaseModel):
    src: str
    segments: list[dict]                                # [{in,out,shot?,text?,words?}]
    subject: dict = {"x": 0.5, "y": 0.40}
    preset: str = "reels"
    lower_third: dict = {}
    ending: dict = {"style": "over_footage"}
    captions: bool = True
    dir: Optional[str] = None                          # job folder → final lands in <dir>/export/


@app.post("/api/statement/render")
def st_render(req: StRenderReq):
    if not Path(req.src).is_file():
        raise HTTPException(400, f"Not a file: {req.src}")
    if not req.segments:
        raise HTTPException(400, "Select at least one sentence to keep.")
    for s in req.segments:
        if "in" not in s or "out" not in s:
            raise HTTPException(400, "Each segment needs in/out times.")
    job = jobs.create("statement", req.model_dump())
    jobs.run_async(job, engine_bridge.statement_render)
    return {"job_id": job.id}


class StSaveProjectReq(BaseModel):
    dir: str
    project: dict


@app.post("/api/statement/save-project")
def st_save_project(req: StSaveProjectReq):
    """Autosave the wizard state as <job folder>/quickvid-project.json — the durable,
    portable copy so a project can be reopened days later (or on another Mac). The
    browser keeps its own localStorage copy for instant refresh recovery."""
    d = Path(req.dir)
    if not d.is_dir():
        raise HTTPException(400, "That job folder doesn't exist.")
    (d / "quickvid-project.json").write_text(
        json.dumps(req.project, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


@app.get("/api/statement/load-project")
def st_load_project(dir: str):
    """Return a folder's saved project (for 'reopen this folder → resume'), or 404."""
    f = Path(dir) / "quickvid-project.json"
    if not f.is_file():
        raise HTTPException(404, "No saved project in that folder.")
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(400, "That folder's project file is unreadable.")


# The single unified UI (also the Safari / offline fallback). Mounted LAST so every
# /api/* route above takes precedence; html=True serves browser/index.html at "/".
app.mount("/", NoCacheStatic(directory=str(settings.UI_DIR), html=True), name="ui")
