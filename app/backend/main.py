"""OCHA QuickVid — local web app backend.

Serves the SPA and a small REST API that drives the engine/. Files never leave
the machine. Run: uvicorn app.backend.main:app --reload --port 8000
"""
import json
import re
import subprocess
import sys
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


def _native_pick(kind: str, prompt: str) -> str:
    """Native picker, cross-platform. macOS: AppleScript. Windows/Linux: a
    tkinter dialog run in a SUBPROCESS (tkinter must own its own main thread —
    embedding it in the server thread wedges uvicorn). Empty string = cancelled."""
    if sys.platform == "darwin":
        safe = prompt.replace('"', "'")[:120]              # keep it inside the AppleScript literal
        kw = "choose folder" if kind == "folder" else "choose file"
        r = subprocess.run(["osascript", "-e", f'POSIX path of ({kw} with prompt "{safe}")'],
                           capture_output=True, text=True, timeout=300)
        return r.stdout.strip() if r.returncode == 0 else ""
    fn = "askdirectory" if kind == "folder" else "askopenfilename"
    code = (
        "from tkinter import Tk, filedialog\n"
        "r = Tk(); r.withdraw(); r.attributes('-topmost', True)\n"   # topmost or the dialog hides behind the browser
        f"print(filedialog.{fn}(title={prompt!r}), end='')\n"
    )
    r = subprocess.run([sys.executable, "-c", code],
                       capture_output=True, text=True, timeout=300, encoding="utf-8")
    return (r.stdout or "").strip() if r.returncode == 0 else ""


@app.post("/api/pick-folder")
def pick_folder(prompt: str = "Select the folder of raw clips"):
    """Native folder picker, for non-technical staff. Falls back to the manual
    path field in the UI if this isn't available / is cancelled."""
    try:
        path = _native_pick("folder", prompt)
    except Exception as exc:                              # noqa: BLE001
        raise HTTPException(400, f"Folder picker unavailable: {exc}")
    if not path:
        raise HTTPException(400, "No folder chosen.")
    return {"path": path}


@app.post("/api/pick-file")
def pick_file():
    """Native file picker for a single finished video (Titles & branding mode)."""
    try:
        path = _native_pick("file", "Select your video")
    except Exception as exc:                              # noqa: BLE001
        raise HTTPException(400, f"File picker unavailable: {exc}")
    if not path:
        raise HTTPException(400, "No file chosen.")
    return {"path": path}


class OpenFolderReq(BaseModel):
    path: str


@app.post("/api/open-folder")
def open_folder(req: OpenFolderReq):
    """Show the job folder in Finder/Explorer — so users SEE where everything saved
    (Paolo's Windows test shipped a loose browser download instead of the export/)."""
    p = Path(req.path)
    if not p.is_dir():
        raise HTTPException(400, f"Not a folder: {req.path}")
    opener = {"darwin": ["open"], "win32": ["explorer"]}.get(sys.platform, ["xdg-open"])
    subprocess.Popen(opener + [str(p)])
    return {"ok": True}


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
    org2: str = ""                           # optional 2nd title line (bilingual)
    start: float = 0.0
    duration: float = 4.0
    align: str = "left"                      # left | center — left is the OCHA default


class EndingReq(BaseModel):
    style: str = "over_footage"               # over_footage | over_black | none — over_footage is the default
    darken: float = 0.0


class SubtitlesReq(BaseModel):
    on: bool = False
    style: str = "box"                        # box (social) | gradient (event)


class PinReq(BaseModel):
    on: bool = False
    place: str = ""                           # top line (Raleway ExtraBold)
    date: str = ""                            # bottom line (Raleway Medium)
    icon: bool = True                         # the map-pin icon; off -> text shifts left
    color: str = "red"                        # red (#ED1847) | blue (#004987)
    start: float = 1.2
    duration: float = 5.0


class BugReq(BaseModel):
    on: bool = False                          # off by default — small OCHA vertical-logo watermark, top-right


class FinishReq(BaseModel):
    video: str
    lower_thirds: list[LowerThirdReq] = []
    bug: BugReq = BugReq()
    pin: PinReq = PinReq()                     # top-left location strip (animated)
    ending: EndingReq = EndingReq()
    subtitles: SubtitlesReq = SubtitlesReq()  # engine-only: transcribe + burn captions


@app.post("/api/finish")
def finish(req: FinishReq):
    """Titles & branding: add lower thirds + an ending to an already-edited video."""
    if not Path(req.video).is_file():
        raise HTTPException(400, f"Not a video file: {req.video}")
    if (not req.lower_thirds and req.ending.style == "none" and not req.subtitles.on
            and not req.bug.on and not req.pin.on):
        raise HTTPException(400, "Nothing to add — set a lower third, subtitles, the bug, a location strip, or an ending.")
    job = jobs.create("finish", {
        "video": req.video,
        "lower_thirds": [lt.model_dump() for lt in req.lower_thirds],
        "bug": req.bug.model_dump(),
        "pin": req.pin.model_dump(),
        "ending": req.ending.model_dump(),
        "subtitles": req.subtitles.model_dump(),
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
        "progress": job.progress, "percent": job.percent, "error": job.error,
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
def export(jid: str, name: str = ""):
    # cross-origin downloads ignore the <a download> attribute — this header is the only
    # filename that sticks, so let the UI pass the project name
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(" ._") or "ocha_quickvid"
    return FileResponse(_rendered_mp4(jid), media_type="video/mp4",
                        filename=f"{safe}.mp4")


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
             sx: float = 0.5, sy: float = 0.40, zoom: Optional[float] = None,
             width: int = 540, download: int = 0, dir: Optional[str] = None):
    """A framing still: the general or close crop at time t (drives the framing
    previews, per-segment shot thumbs, and — at full width — the thumbnail). Each
    shot carries its own position AND zoom (no zoom param → the shot's default:
    general 1.0, close 1.5). When it's the thumbnail (download=1) and a job folder
    is set, also drop a copy in export/."""
    if not Path(src).is_file():
        raise HTTPException(400, f"Not a file: {src}")
    pr = st_probe(src)
    p = statement_engine.PRESETS.get(preset, statement_engine.PRESETS["reels"])
    z = zoom if zoom is not None else (1.0 if shot == "general" else 1.5)
    w, h, x, y = statement_engine.crop_rect(pr["width"], pr["height"],
                                            p["canvas"][0], p["canvas"][1], sx, sy, z)
    key = abs(hash((src, round(t, 2), shot, preset, round(sx, 3), round(sy, 3), round(z, 3), width)))
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
    subject: dict = {"x": 0.5, "y": 0.40}               # legacy single-point framing (kept for old projects)
    framing: Optional[dict] = None                      # {"general": {x,y,zoom}, "close": {x,y,zoom}}
    preset: str = "reels"
    lower_third: dict = {}                              # legacy single LT (old projects)
    lower_thirds: Optional[list] = None                 # [{name,org,org2,start,duration,align}] — the multi-row UI
    ending: dict = {"style": "over_footage"}           # {"style", "tail"?} — tail = footage secs after last sentence
    captions: bool = True
    subtitles: Optional[dict] = None                   # {"on": bool, "style": "box"|"gradient"}
    bug: Optional[dict] = None                         # {"on": bool} — off by default, top-right vertical logo
    pin: Optional[dict] = None                         # {"on","place","date","icon","color","start","duration"} — location strip
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
    name: Optional[str] = None                         # project name → <name>.ochaquickvid.json


# Every shape we recognise as a OCHA QuickVid project file, in preference order.
# ".ochaquickvid.json" is current; ".quickvid.json" and the fixed
# "quickvid-project.json" are older forms we still open (and clean up on save).
PROJECT_GLOBS = ("*.ochaquickvid.json", "*.quickvid.json")
PROJECT_LEGACY = "quickvid-project.json"


def _project_files(d: Path):
    """All project files in `d`, newest first."""
    found = set()
    for pat in PROJECT_GLOBS:
        found |= set(d.glob(pat))
    legacy = d / PROJECT_LEGACY
    if legacy.is_file():
        found.add(legacy)
    return sorted(found, key=lambda p: p.stat().st_mtime, reverse=True)


@app.post("/api/statement/save-project")
def st_save_project(req: StSaveProjectReq):
    """Autosave the wizard state as <job folder>/<name>.ochaquickvid.json — the
    durable, portable copy so a project can be reopened days later (or on another
    Mac). The browser keeps its own localStorage copy for instant refresh recovery.
    Creates the folder (named projects: <chosen parent>/<project name>/ may not
    exist yet)."""
    d = Path(req.dir)
    d.mkdir(parents=True, exist_ok=True)
    fname = (engine_bridge._slug(req.name) + ".ochaquickvid.json") if req.name else PROJECT_LEGACY
    for old in _project_files(d):                      # renamed/upgraded project → don't leave stale twins
        if old.name != fname:
            old.unlink(missing_ok=True)
    (d / fname).write_text(json.dumps(req.project, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "file": str(d / fname)}


@app.get("/api/statement/load-project")
def st_load_project(dir: str):
    """Return a folder's saved project (for 'reopen this folder → resume'), or 404.
    Accepts the current <name>.ochaquickvid.json and the older forms, newest wins."""
    candidates = _project_files(Path(dir))
    if not candidates:
        raise HTTPException(404, "No saved project in that folder.")
    try:
        return json.loads(candidates[0].read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(400, "That folder's project file is unreadable.")


@app.post("/api/statement/open-project")
def st_open_project():
    """Reopen an earlier project: pick its <name>.ochaquickvid.json file and get
    the state back to keep editing. Returns the project + the folder it ACTUALLY
    lives in now (authoritative — a folder can be moved after it was saved)."""
    try:
        path = _native_pick("file", "Open a OCHA QuickVid project (.ochaquickvid.json)")
    except Exception as exc:                              # noqa: BLE001
        raise HTTPException(400, f"File picker unavailable: {exc}")
    if not path:
        raise HTTPException(400, "No file chosen.")
    p = Path(path)
    try:
        proj = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(400, "That file isn't a readable OCHA QuickVid project.")
    if not isinstance(proj, dict) or "v" not in proj:
        raise HTTPException(400, "That doesn't look like a OCHA QuickVid project file.")
    return {"project": proj, "dir": str(p.parent)}


# The single unified UI (also the Safari / offline fallback). Mounted LAST so every
# /api/* route above takes precedence; html=True serves browser/index.html at "/".
app.mount("/", NoCacheStatic(directory=str(settings.UI_DIR), html=True), name="ui")
