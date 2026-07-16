"""Tiny in-process job registry. Transcribe/render run on a daemon thread so the
request returns immediately; the UI polls GET /api/jobs/{id}. Single-user local
tool — no persistence, no queue. Restart clears jobs (their files survive in the
workspace)."""
import threading
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Optional          # PEP 604 "X | None" is 3.10+; the stock macOS
                                     # Command Line Tools Python is 3.9 — use Optional.

_JOBS: dict[str, "Job"] = {}


@dataclass
class Job:
    id: str
    kind: str                       # "transcribe" | "render"
    meta: dict = field(default_factory=dict)
    status: str = "queued"          # queued | running | done | error
    progress: str = ""              # last line of engine output, for the UI
    percent: Optional[int] = None   # 0-100 when the engine emits `PROGRESS n`, else None
    error: str = ""
    result: dict = field(default_factory=dict)
    log: list = field(default_factory=list)


def create(kind: str, meta: dict) -> Job:
    job = Job(id=uuid.uuid4().hex[:12], kind=kind, meta=meta or {})
    _JOBS[job.id] = job
    return job


def get(jid: str) -> Optional[Job]:
    return _JOBS.get(jid)


def run_async(job: Job, target) -> None:
    """Run target(job) on a daemon thread. target sets job.result and may raise."""
    def _wrap():
        job.status = "running"
        try:
            target(job)
            job.status = "done"
        except Exception as exc:                       # noqa: BLE001
            job.status = "error"
            job.error = str(exc)
            job.log.append(traceback.format_exc())

    threading.Thread(target=_wrap, daemon=True).start()
