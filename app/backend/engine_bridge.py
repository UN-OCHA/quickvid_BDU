"""Thin wrappers that drive the proven engine/ scripts as subprocesses, capturing
output into the job log. No engine logic is duplicated here — the contract stays
in engine/run.py and engine/transcribe.py."""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import settings

# preset -> canvas label, for naming the export file (mirrors engine/statement.py PRESETS)
CANVAS = {"reels": "1080x1920", "square": "1080x1080", "feed45": "1080x1350", "event": "1920x1080"}


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s or "").strip("_")


def _job_dirs(dir_path):
    """The standard 4-folder job structure under the user's chosen folder (created on
    demand), or None when no folder was picked — then callers fall back to the hidden
    workspace. Matches the OCHA video-job folder rule: source/export/info/assets."""
    if not dir_path:
        return None
    root = Path(dir_path)
    dirs = {n: root / n for n in ("source", "export", "info", "assets")}
    for p in (root, *dirs.values()):
        p.mkdir(parents=True, exist_ok=True)
    dirs["root"] = root
    return dirs


def save_still_to_export(still_path, dir_path):
    """Keep the chosen thumbnail beside the final video, in the job's export/ folder."""
    dirs = _job_dirs(dir_path)
    if not dirs:
        return None
    dest = dirs["export"] / "thumbnail.jpg"
    shutil.copy2(still_path, dest)
    return str(dest)


def _write_job_info(dirs, job, final_path):
    """The kept sentences + a root README, so the folder is self-explanatory later
    (per the OCHA video-job structure rule)."""
    segs = job.meta.get("segments", [])
    script = "\n".join((s.get("text") or "").strip() for s in segs if s.get("text")).strip()
    (dirs["info"] / "script.txt").write_text(script + "\n")
    (dirs["info"] / "segments_selected.json").write_text(json.dumps(segs, indent=2))
    readme = dirs["root"] / "README.md"
    if not readme.exists():
        readme.write_text(
            f"# {dirs['root'].name}\n\n"
            "OCHA statement clip, made with **QuickVid** (Edit -> Statement clip).\n\n"
            "## Folders\n"
            "- `source/` - the original UN Web TV download (floor audio).\n"
            f"- `export/` - the finished clip (`{final_path.name}`) + `thumbnail.jpg`. **The deliverable.**\n"
            "- `info/` - the kept sentences (`script.txt`) and their timings (`segments_selected.json`).\n"
            "- `assets/` - spare room for extra material.\n\n"
            "## How it was made\n"
            "UN Web TV download -> optional lip-sync -> transcribe -> pick the sentences -> punch-in "
            "cut -> OCHA branding (captions + lower third + logo-click ending).\n\n"
            "## To re-edit\n"
            "Re-open QuickVid, pick this same folder, and load `source/` - or hand this folder to "
            "Claude Code with the `ocha-statement-clip` skill.\n"
        )


def _run(cmd: list[str], job) -> None:
    job.log.append("$ " + " ".join(str(c) for c in cmd))
    proc = subprocess.Popen(
        [str(c) for c in cmd], cwd=settings.ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, env={**os.environ},
    )
    for line in proc.stdout:                            # stream so the UI sees progress
        line = line.rstrip()
        if line:
            job.log.append(line)
            job.progress = line
    proc.wait()
    if proc.returncode != 0:
        # Engine scripts print `ERROR: <human message>` on a clean failure — surface that
        # to the UI instead of the useless "exited 1".
        clear = next((l[7:] for l in reversed(job.log) if l.startswith("ERROR:")), None)
        raise RuntimeError(clear or
            f"{Path(cmd[1]).name if len(cmd) > 1 else cmd[0]} exited {proc.returncode}. See the job log.")


def transcribe(job) -> None:
    folder = job.meta["folder"]
    model = job.meta.get("model") or settings.DEFAULT_MODEL
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    job.progress = f"Transcribing with Whisper ({model})… long 4K clips take a bit."
    _run([sys.executable, settings.ENGINE_DIR / "transcribe.py",
          "--folder", folder, "--out", workdir, "--model", model], job)
    segments = json.loads((workdir / "segments.json").read_text())
    job.result = {
        "workdir": str(workdir),
        "segments": segments,
        "segment_count": len(segments),
        "transcript": (workdir / "transcript.txt").read_text(),
    }


def render(job) -> None:
    src = job.meta["source_job"]
    folder = src.meta["folder"]
    segments_path = Path(src.result["workdir"]) / "segments.json"
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    instruction = workdir / "instruction.json"
    instruction.write_text(json.dumps(job.meta["instruction"], indent=2))

    # Step 1 — the cut: run.py assembles the kept segments into a clean piece.
    cut = workdir / "final.mp4"
    job.progress = "Assembling the clean cut…"
    _run([sys.executable, settings.ENGINE_DIR / "run.py",
          "--instruction", instruction,
          "--segments", segments_path,
          "--source-dir", folder,
          "--out", cut], job)
    timeline = workdir / "final_timeline.json"           # emitted by run.py for the captions engine

    # Step 2 — the branding pass: render.py bakes the OCHA look (grade, logo,
    # captions, name strips, click ending) via per-segment compositing.
    branded = workdir / "final_branded.mp4"
    job.progress = "Baking the OCHA branding (grade, captions, logo)…"
    _run([sys.executable, settings.ENGINE_DIR / "render.py",
          "--video", cut,
          "--timeline", timeline,
          "--instruction", instruction,
          "--out", branded], job)

    job.result = {
        "workdir": str(workdir),
        "mp4": str(branded),                             # what preview/export serve
        "cut_mp4": str(cut),                             # clean cut kept for reference
        "timeline": json.loads(timeline.read_text()) if timeline.exists() else [],
    }


def _result_json(job) -> dict:
    """Engine statement/webtv scripts print `RESULT {json}` as their last line."""
    for line in reversed(job.log):
        if line.startswith("RESULT "):
            return json.loads(line[7:])
    return {}


def _statement_action(job, action: str, spec: dict) -> dict:
    """Run one engine/statement.py action with a spec file; return its RESULT."""
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    spec_path = workdir / f"{action}.json"
    spec_path.write_text(json.dumps(spec, indent=2))
    _run([sys.executable, settings.ENGINE_DIR / "statement.py",
          "--do", action, "--spec", spec_path], job)
    return _result_json(job)


def webtv_download(job) -> None:
    """Statement clips: pull a UN Web TV recording (floor audio) into the job's
    source/ folder (or the hidden workspace when no folder was picked)."""
    dirs = _job_dirs(job.meta.get("dir"))
    workdir = dirs["source"] if dirs else settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    job.progress = "Contacting UN Web TV…"
    _run([sys.executable, settings.ENGINE_DIR / "webtv.py",
          "--url", job.meta["url"], "--out", workdir,
          "--lang", job.meta.get("lang") or "floor",
          "--quality", job.meta.get("quality") or "1080"], job)
    job.result = _result_json(job)


def statement_applysync(job) -> None:
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    src = Path(job.meta["src"])
    out = workdir / f"{src.stem}_synced.mp4"
    job.result = _statement_action(job, "applysync", {
        "src": str(src), "offset": job.meta["offset"], "out": str(out)})


def statement_transcribe(job) -> None:
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    out_json = workdir / "segments.json"
    _statement_action(job, "transcribe", {
        "src": job.meta["src"], "start": job.meta.get("start"),
        "end": job.meta.get("end"), "ranges": job.meta.get("ranges"),
        "model": settings.DEFAULT_MODEL, "out_json": str(out_json)})
    segments = json.loads(out_json.read_text())
    job.result = {"workdir": str(workdir), "segments": segments,
                  "segment_count": len(segments)}


def statement_render(job) -> None:
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    out = workdir / "statement.mp4"
    res = _statement_action(job, "render", {**job.meta, "out": str(out)})
    result = {"workdir": str(workdir), "mp4": str(out), **res}
    # If a job folder was chosen, drop the finished clip in export/ with a descriptive
    # name and leave a self-explanatory folder behind. Preview still serves the
    # workspace copy (result["mp4"]); "export" tells the UI where it was saved.
    dirs = _job_dirs(job.meta.get("dir"))
    if dirs:
        canvas = CANVAS.get(job.meta.get("preset", "reels"), "")
        name = _slug(dirs["root"].name) or "statement"
        final = dirs["export"] / (f"{name}_{canvas}.mp4" if canvas else f"{name}.mp4")
        shutil.copy2(out, final)
        _write_job_info(dirs, job, final)
        result["export"] = str(final)
    job.result = result


def finish(job) -> None:
    """Titles & branding mode: add lower thirds + ending to an already-edited
    video via engine/finish.py. No transcribe/cut — just the branding pass."""
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    out = workdir / "branded.mp4"
    spec = {
        "video": job.meta["video"],
        "out": str(out),
        "lower_thirds": job.meta.get("lower_thirds", []),
        "ending": job.meta.get("ending", {"style": "none"}),
    }
    spec_path = workdir / "spec.json"
    spec_path.write_text(json.dumps(spec, indent=2))
    job.progress = "Adding titles & branding…"
    _run([sys.executable, settings.ENGINE_DIR / "finish.py", "--spec", spec_path], job)
    job.result = {"workdir": str(workdir), "mp4": str(out)}
