"""God mode: an admin dashboard only the people in ADMIN_EMAILS can open.

Access needs both of these, checked on every request:
  1. the signed-in account's email is in ADMIN_EMAILS (an env var, never in code), and
  2. the token came from Google sign-in, so the email is proven, not just typed at sign-up.
Anyone else gets a plain 404, so the dashboard doesn't advertise that it exists.
"""
import json
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, status
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .content import load_course, load_weeks
from .db import get_db
from .models import QuizAttempt, StepProgress, Submission, User
from .models_admin import AssignmentStatus
from .models_course import ItemProgress
from .security import current_user, token_claims

router = APIRouter(prefix="/admin")
STARTED = time.time()
STATUSES = ("todo", "doing", "done")


class Assignment(BaseModel):
    id: str
    week: str
    kind: str
    title: str
    due: str
    deliver: list[str] = []
    done_when: str = ""
    project: dict[str, str] | None = None


@lru_cache
def load_assignments() -> list[Assignment]:
    raw = json.loads((get_settings().content_dir / "assignments.json").read_text())
    items = [Assignment(**a) for a in raw["assignments"]]
    ids = [a.id for a in items]
    if len(ids) != len(set(ids)):
        raise ValueError("assignments.json has duplicate ids")
    return items


class DemoLine(BaseModel):
    kind: Literal["cmd", "out", "note"]
    text: str


class Demo(BaseModel):
    title: str
    lines: list[DemoLine] = Field(min_length=1)


class StatusUpdate(BaseModel):
    """A thread moving one of the admin's assignments forward when it ships work."""
    assignment: str
    status: Literal["todo", "doing", "done"]
    note: str = ""
    at: datetime  # ISO time, with timezone, when the update was made


class BuildEntry(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str
    pr: int | None = None
    assignments: list[str] = []
    where: list[str] = Field(min_length=1)
    how: list[str] = Field(min_length=1)
    demo: Demo
    status_updates: list[StatusUpdate] = []


@lru_cache
def load_build_log() -> list[BuildEntry]:
    """content/build-log.json: one entry per shipped feature, appended by whoever ships it."""
    raw = json.loads((get_settings().content_dir / "build-log.json").read_text())
    entries = [BuildEntry(**e) for e in raw["entries"]]
    known = {a.id for a in load_assignments()}
    seen: set[str] = set()
    for e in entries:
        if e.id in seen:
            raise ValueError(f"build-log.json: duplicate id {e.id!r}")
        seen.add(e.id)
        for u in e.status_updates:
            if u.at.tzinfo is None:
                raise ValueError(f"build-log.json: {e.id!r} status update needs a timezone in 'at'")
        unknown = (set(e.assignments) | {u.assignment for u in e.status_updates}) - known
        if unknown:
            raise ValueError(f"build-log.json: {e.id!r} names unknown assignments {sorted(unknown)}")
    return entries


def is_admin(user: User, claims: dict) -> bool:
    admins = get_settings().admin_emails
    return bool(admins) and claims.get("via") == "google" and user.email.lower() in admins


def require_admin(user: User = Depends(current_user), claims: dict = Depends(token_claims)) -> User:
    if not is_admin(user, claims):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    return user


def _project_progress(db: Session, user_id: int, ref: dict[str, str]) -> dict | None:
    week = load_weeks().get(ref["week_id"])
    project = next((p for p in week.projects if p.id == ref["project_id"]), None) if week else None
    if project is None:
        return None
    ticked = db.scalar(select(func.count()).select_from(StepProgress).where(
        StepProgress.user_id == user_id, StepProgress.week_id == week.id, StepProgress.project_id == project.id))
    filled = db.scalar(select(func.count()).select_from(Submission).where(
        Submission.user_id == user_id, Submission.week_id == week.id, Submission.project_id == project.id,
        Submission.value != ""))
    return {"steps_done": ticked, "steps_total": len(project.steps),
            "fields_done": filled, "fields_total": len(project.submit)}


def _auto_status(p: dict | None) -> str:
    if not p:
        return "todo"
    if p["steps_done"] >= p["steps_total"] and p["fields_done"] >= p["fields_total"]:
        return "done"
    return "doing" if p["steps_done"] or p["fields_done"] else "todo"


@router.get("/overview")
def overview(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    s = get_settings()
    saved = {r.assignment_id: r for r in db.scalars(
        select(AssignmentStatus).where(AssignmentStatus.user_id == admin.id)).all()}
    log = load_build_log()
    # The newest build-log status update for each assignment.
    shipped: dict[str, tuple[StatusUpdate, BuildEntry]] = {}
    for e in log:
        for u in e.status_updates:
            if u.assignment not in shipped or u.at >= shipped[u.assignment][0].at:
                shipped[u.assignment] = (u, e)
    assignments = []
    for a in load_assignments():
        progress = _project_progress(db, admin.id, a.project) if a.project else None
        note_row = saved.get(a.id)
        row = note_row if note_row and note_row.status else None  # status "" = note only, status automatic
        row_at = (row.updated_at if row.updated_at.tzinfo else row.updated_at.replace(tzinfo=timezone.utc)) if row else None
        upd = shipped.get(a.id)
        # Newest wins between your own click in God mode and a thread's build-log update;
        # with neither, build projects follow the course checklist.
        if row and (not upd or row_at >= upd[0].at):
            status, source, at, by = row.status, "manual", row_at, None
        elif upd:
            status, source, at, by = upd[0].status, "build-log", upd[0].at, {
                "entry": upd[1].id, "title": upd[1].title, "pr": upd[1].pr, "note": upd[0].note}
        else:
            status, source, at, by = _auto_status(progress), ("course" if progress else "default"), None, None
        assignments.append({
            **a.model_dump(),
            "progress": progress,
            "status": status,
            "status_source": source,
            "status_by": by,
            "manual_status": row.status if row else None,
            "note": note_row.note if note_row else "",
            "updated_at": at.isoformat() if at else None,
            "features": [e.id for e in log if a.id in e.assignments],
        })

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    count = lambda model, *where: db.scalar(select(func.count()).select_from(model).where(*where))  # noqa: E731
    events = []
    for kind, model, ts, label in (
        ("quiz", QuizAttempt, QuizAttempt.created_at, lambda r: f"{r.kind} quiz {r.week_id}: {r.score}/{r.total}"),
        ("step", StepProgress, StepProgress.done_at, lambda r: f"ticked {r.week_id} {r.project_id} step {r.step_index + 1}"),
        ("item", ItemProgress, ItemProgress.done_at, lambda r: f"finished {r.week_id} · {r.item_id}"),
    ):
        for r, name in db.execute(select(model, User.name).join(User, User.id == model.user_id)
                                  .order_by(ts.desc()).limit(12)).all():
            when = getattr(r, ts.key)
            events.append({"kind": kind, "who": name, "what": label(r),
                           "at": (when if when.tzinfo else when.replace(tzinfo=timezone.utc)).isoformat()})
    events.sort(key=lambda e: e["at"], reverse=True)

    weeks = load_weeks()
    return {
        "admin": {"name": admin.name},
        "assignments": assignments,
        "build_log": [e.model_dump() for e in reversed(log)],  # newest first
        "machine": {
            "uptime_s": int(time.time() - STARTED),
            "database": "postgres" if s.database_url.startswith("postgresql") else "sqlite",
            "services": {
                "api": True,
                "database": True,
                "google_sign_in": s.google_configured,
                "livekit_voice": s.livekit_configured,
                "voice_worker_key": bool(s.voice_worker_key),
            },
            "content": {"weeks_open": len(weeks), "weeks_planned": len(load_course().weeks),
                        "quiz_questions": sum(len(w.quiz) for w in weeks.values())},
            "counts": {
                "users": count(User),
                "users_24h": count(User, User.created_at >= since),
                "quiz_attempts": count(QuizAttempt),
                "voice_calls": count(QuizAttempt, QuizAttempt.kind == "voice"),
                "items_done": count(ItemProgress),
                "steps_done": count(StepProgress),
                "submissions": count(Submission),
            },
            "events": events[:20],
        },
    }


class StatusIn(BaseModel):
    status: str | None = Field(default=None, pattern="^(todo|doing|done)$")
    note: str = Field(default="", max_length=2000)


@router.put("/assignments/{assignment_id}")
def set_status(assignment_id: str, body: StatusIn, admin: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    """Set an assignment's status and note. status=null hands the status back to automatic."""
    if assignment_id not in {a.id for a in load_assignments()}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown assignment.")
    row = db.scalar(select(AssignmentStatus).where(
        AssignmentStatus.user_id == admin.id, AssignmentStatus.assignment_id == assignment_id))
    note = body.note.strip()
    if body.status is None and not note:
        if row:
            db.delete(row)
            db.commit()
        return {"status": None, "note": ""}
    if row is None:
        row = AssignmentStatus(user_id=admin.id, assignment_id=assignment_id, status="")
        db.add(row)
    # status None keeps the note but hands the status back to automatic ("").
    row.status, row.note = body.status or "", note
    db.commit()
    return {"status": body.status, "note": row.note}
