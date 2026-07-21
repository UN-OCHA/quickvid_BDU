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
    """The standard job structure under the user's chosen folder, or None when no
    folder was picked — then callers fall back to the hidden workspace. Matches the
    OCHA video-job folder rule: source/export/info/assets.

    Only the ROOT is created here. The sub-folders are made lazily by `_ensure()` at
    the moment something is written into them, so a job never ships empty folders —
    a Titles & branding job, for instance, has no `source/` to collect."""
    if not dir_path:
        return None
    root = Path(dir_path)
    root.mkdir(parents=True, exist_ok=True)
    dirs = {n: root / n for n in ("source", "export", "info", "assets")}
    dirs["root"] = root
    return dirs


def _ensure(p: Path) -> Path:
    """Create a job sub-folder at the moment it's first written to (see _job_dirs)."""
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_still_to_export(still_path, dir_path):
    """Keep the chosen thumbnail beside the final video, in the job's export/ folder."""
    dirs = _job_dirs(dir_path)
    if not dirs:
        return None
    dest = _ensure(dirs["export"]) / "thumbnail.jpg"
    shutil.copy2(still_path, dest)
    return str(dest)


def _write_job_info(dirs, job, final_path):
    """The kept sentences + a root README, so the folder is self-explanatory later
    (per the OCHA video-job structure rule)."""
    segs = job.meta.get("segments", [])
    script = "\n".join((s.get("text") or "").strip() for s in segs if s.get("text")).strip()
    info = _ensure(dirs["info"])
    (info / "script.txt").write_text(script + "\n")
    (info / "segments_selected.json").write_text(json.dumps(segs, indent=2))
    _write_readme(dirs, final_path,
                  "OCHA statement clip, made with **OCHA QuickVid** (Edit -> Statement clip).",
                  "UN Web TV download -> optional lip-sync -> transcribe -> pick the sentences -> "
                  "punch-in cut -> OCHA branding (captions + lower third + logo-click ending).")


# What each folder is for — only the ones that actually exist get listed, since
# folders are created lazily (see _job_dirs).
_FOLDER_BLURB = {
    "source": "the material this was built from.",
    "export": "the finished video{extra}. **The deliverable.**",
    "info":   "the script and timings behind the edit.",
    "assets": "extra material for this job.",
}


def _write_readme(dirs, final_path, what: str, how: str) -> None:
    """Root README describing the job. Lists ONLY the folders present, so a job that
    never needed `source/` doesn't advertise one."""
    readme = dirs["root"] / "README.md"
    if readme.exists():
        return
    lines = [f"# {dirs['root'].name}", "", what, "", "## Folders"]
    for name in ("source", "export", "info", "assets"):
        d = dirs[name]
        if not d.exists():
            continue
        extra = ""
        if name == "export" and final_path is not None:
            extra = f" (`{Path(final_path).name}`)"
        lines.append(f"- `{name}/` - " + _FOLDER_BLURB[name].format(extra=extra))
    lines += ["", "## How it was made", how, "",
              "## To re-edit",
              "Re-open OCHA QuickVid and pick this same folder - the project file "
              "(`*.ochaquickvid.json`) restores your settings.", ""]
    readme.write_text("\n".join(lines))


def _run(cmd: list[str], job) -> None:
    job.log.append("$ " + " ".join(str(c) for c in cmd))
    proc = subprocess.Popen(
        [str(c) for c in cmd], cwd=settings.ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        # UTF-8 on both ends: Windows would otherwise decode with cp1252 and
        # mangle/crash on accents in names ("Dnipró…") in the engine's output.
        text=True, bufsize=1, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    job.percent = None                                  # fresh subprocess → no bar until it reports
    for line in proc.stdout:                            # stream so the UI sees progress
        line = line.rstrip()
        if not line:
            continue
        m = re.match(r"^PROGRESS (\d+)$", line)          # machine progress token → the % bar
        if m:
            job.percent = min(100, int(m.group(1)))
            continue                                     # don't show the token as text
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
        final = _ensure(dirs["export"]) / (f"{name}_{canvas}.mp4" if canvas else f"{name}.mp4")
        shutil.copy2(out, final)
        _write_job_info(dirs, job, final)
        result["export"] = str(final)
    job.result = result


def finish(job) -> None:
    """Titles & branding mode: add lower thirds + ending to an already-edited
    video. Plain branding runs engine/finish.py; with SUBTITLES ON the job routes
    through the statement renderer instead: transcribe the finished clip, then
    social_brand burns captions + lower thirds + ending in one pass."""
    workdir = settings.WORKSPACE / job.id
    workdir.mkdir(parents=True, exist_ok=True)
    out = workdir / "branded.mp4"
    if (job.meta.get("subtitles") or {}).get("on"):
        _finish_with_subtitles(job, workdir, out)
    else:
        spec = {
            "video": job.meta["video"],
            "out": str(out),
            "lower_thirds": job.meta.get("lower_thirds", []),
            "bug": job.meta.get("bug", {}),
            "pin": job.meta.get("pin", {}),
            "ending": job.meta.get("ending", {"style": "none"}),
        }
        spec_path = workdir / "spec.json"
        spec_path.write_text(json.dumps(spec, indent=2))
        job.progress = "Adding titles & branding…"
        _run([sys.executable, settings.ENGINE_DIR / "finish.py", "--spec", spec_path], job)

    result = {"workdir": str(workdir), "mp4": str(out)}
    # Same deal as the Edit tab: when a job folder was chosen, the deliverable lands
    # in export/ under the project's name instead of "branded.mp4" in the hidden
    # workspace (which a reinstall would wipe). Folders are made only as needed, so a
    # Titles job doesn't ship an empty source/.
    dirs = _job_dirs(job.meta.get("dir"))
    if dirs:
        name = _slug(dirs["root"].name) or "branded"
        final = _ensure(dirs["export"]) / f"{name}.mp4"
        shutil.copy2(out, final)
        _write_readme(dirs, final,
                      "OCHA titles & branding, made with **OCHA QuickVid** "
                      "(Titles & branding).",
                      "An already-edited video -> OCHA branding (lower thirds"
                      + (", subtitles" if (job.meta.get("subtitles") or {}).get("on") else "")
                      + ", optional location pin and logo bug, logo-click ending).")
        result["export"] = str(final)
    job.result = result


def _finish_with_subtitles(job, workdir, out) -> None:
    """Titles + subtitles: Whisper the finished clip → burn captions (chosen
    style) + lower thirds + ending via engine/social_brand.py."""
    sys.path.insert(0, str(settings.ENGINE_DIR))
    import statement as st                              # noqa: E402 — cue/timing helpers
    import lower_third as LT                            # noqa: E402 — shared animation constants

    video = job.meta["video"]
    seg_json = workdir / "segments.json"
    job.progress = "Transcribing the video for subtitles…"
    _statement_action(job, "transcribe", {"src": video, "model": settings.DEFAULT_MODEL,
                                          "out_json": str(seg_json)})
    segments = json.loads(seg_json.read_text())
    cues = st.cues_real_timeline(segments)

    pw, ph, _, dur = st._probe(video)
    style = (job.meta.get("subtitles") or {}).get("style", "box")
    sub = {                                             # preset numbers as fractions → any canvas
        "size": max(24, round(ph * 0.024)), "max_w": round(pw * 0.85),
        "bottom_hi": round(ph * 0.6875), "bottom_lo": round(ph * 0.77),
        "box": style != "gradient",
    }
    lts = [{"name": l["name"],
            "titles": [t for t in [l.get("org"), l.get("org2")] if t],
            "align": l.get("align", "left"), "in": float(l.get("start", 1.0)),
            "hold": max(0.5, float(l.get("duration", 5)) - LT.ENTER_END - LT.EXIT_DUR)}
           for l in job.meta.get("lower_thirds", []) if l.get("name")]

    est = (job.meta.get("ending") or {}).get("style", "none")
    if est == "over_footage":                           # logo over the last 1.5s (finish.py's HOLD)
        ending = {"style": "over_footage", "at": max(0.0, round(dur - 1.5, 2)), "click": True}
        footage_end = ending["at"]                      # no caption under the logo
    elif est == "over_black":
        ending = {"style": "over_black", "at": round(dur, 2), "hold": 1.5, "click": True}
        footage_end = dur
    else:
        ending = {"style": "none"}
        footage_end = dur

    spec = {"src": video, "out": str(out), "canvas": [pw, ph],
            "bitrate": "12M",                           # 6M default reads soft at 1080p+
            "footage_end": round(footage_end, 2), "subtitle": sub, "cues": cues,
            "lower_thirds": lts, "bug": job.meta.get("bug", {}),
            "pin": job.meta.get("pin", {}), "ending": ending}
    spec_path = workdir / "brand_spec.json"
    spec_path.write_text(json.dumps(spec, indent=2, ensure_ascii=False))
    job.progress = "Burning subtitles + branding…"
    _run([sys.executable, settings.ENGINE_DIR / "social_brand.py", "--spec", spec_path], job)
