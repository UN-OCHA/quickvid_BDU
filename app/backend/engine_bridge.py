"""Thin wrappers that drive the proven engine/ scripts as subprocesses, capturing
output into the job log. No engine logic is duplicated here — the contract stays
in engine/run.py and engine/transcribe.py."""
import json
import os
import subprocess
import sys
from pathlib import Path

from . import settings


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
        raise RuntimeError(
            f"{Path(cmd[1]).name if len(cmd) > 1 else cmd[0]} exited {proc.returncode}. "
            f"See the job log."
        )


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
