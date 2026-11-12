"""God mode cohort view: every learner's progress and quiz scores, and who looks stuck.

Admin only (same check as the rest of God mode). Learner emails are never sent, only names.
The whole cohort is read in a handful of queries and grouped in Python, which is fine for a
training cohort of tens of people.

Other features plug in through LEARNER_EXTRAS: a function (db, user_ids) -> {user_id: {...}}
whose dict is merged into each learner row under its key. Voice-quiz scorecards and project
grading register theirs there, so the cohort table shows their data without changing this file.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .admin import require_admin
from .content import Week, load_weeks
from .db import get_db
from .models import QuizAttempt, StepProgress, Submission, User
from .models_course import ItemProgress

router = APIRouter(prefix="/admin")

# Stuck rules. Kept as constants so they're easy to tune.
INACTIVE_DAYS = 3        # no activity for this long while the course isn't finished
NOT_STARTED_DAYS = 2     # joined this long ago and has done nothing
QUIZ_FAILS = 2           # this many graded-quiz attempts on a week without passing
PRACTICE_LOW = 0.5       # average practice score below this, over at least 2 attempts

LEARNER_EXTRAS: dict[str, Callable[[Session, list[int]], dict[int, dict]]] = {}


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return _utc(dt).isoformat() if dt else None


class _Data:
    """Every progress row for the given users, grouped by user."""

    def __init__(self, db: Session, user_ids: list[int]):
        def by_user(model):
            out = defaultdict(list)
            if user_ids:
                for r in db.scalars(select(model).where(model.user_id.in_(user_ids))).all():
                    out[r.user_id].append(r)
            return out

        self.items = by_user(ItemProgress)
        self.steps = by_user(StepProgress)
        self.subs = by_user(Submission)
        self.quizzes = by_user(QuizAttempt)


def _done_items(week: Week, items, steps, quizzes) -> set[str]:
    """Same rules as course._done_items, on rows that are already loaded."""
    done = {r.item_id for r in items if r.week_id == week.id}
    voice = any(q.week_id == week.id and q.kind == "voice" for q in quizzes)
    for item in week.items():
        if item.type == "project":
            project = next(p for p in week.projects if p.id == item.ref)
            ticked = {s.step_index for s in steps if s.week_id == week.id and s.project_id == project.id}
            if len(ticked) >= len(project.steps):
                done.add(item.id)
        elif item.type == "voice" and voice:
            done.add(item.id)
    return done & {i.id for i in week.items()}


def _best(attempts):
    if not attempts:
        return None
    b = max(attempts, key=lambda q: (q.score / q.total if q.total else 0, _utc(q.created_at)))
    return {"score": b.score, "total": b.total, "attempts": len(attempts)}


def _learner(user: User, d: _Data, weeks: dict[str, Week], now: datetime) -> dict:
    items, steps, subs, quizzes = d.items[user.id], d.steps[user.id], d.subs[user.id], d.quizzes[user.id]
    stamps = ([r.done_at for r in items] + [r.done_at for r in steps]
              + [r.updated_at for r in subs if r.value] + [q.created_at for q in quizzes])
    last = max((_utc(t) for t in stamps if t), default=None)

    week_rows, flags = [], []
    done_all = total_all = 0
    next_up = None
    for week in weeks.values():
        done = _done_items(week, items, steps, quizzes)
        all_items = week.items()
        done_all += len(done)
        total_all += len(all_items)
        if next_up is None:
            nxt = next((i for i in all_items if i.id not in done), None)
            if nxt:
                next_up = {"week_id": week.id, "week": week.number, "item_id": nxt.id, "title": nxt.title, "type": nxt.type}

        wq = [q for q in quizzes if q.week_id == week.id]
        graded = [q for q in wq if q.kind == "mcq"]
        practice = [q for q in wq if q.kind == "practice"]
        voice = [q for q in wq if q.kind == "voice"]
        passed = any(q.total and q.score * 100 >= week.pass_percent * q.total for q in graded)
        if len(graded) >= QUIZ_FAILS and not passed:
            flags.append({"code": "quiz_fails", "label": f"Failed the week {week.number} quiz {len(graded)} times"})
        practice_avg = (sum(q.score / q.total for q in practice if q.total) / len(practice)) if practice else None
        if practice_avg is not None and len(practice) >= 2 and practice_avg < PRACTICE_LOW:
            flags.append({"code": "practice_low", "label": f"Week {week.number} practice averages {round(practice_avg * 100)}%"})

        projects = []
        for p in week.projects:
            projects.append({
                "id": p.id, "title": p.title,
                "steps_done": len({s.step_index for s in steps if s.week_id == week.id and s.project_id == p.id}),
                "steps_total": len(p.steps),
                "fields_done": sum(1 for s in subs if s.week_id == week.id and s.project_id == p.id and s.value),
                "fields_total": len(p.submit),
            })
        week_rows.append({
            "id": week.id, "number": week.number, "title": week.title,
            "done": len(done), "total": len(all_items),
            "quiz": _best(graded), "quiz_passed": passed, "pass_percent": week.pass_percent,
            "voice": _best(voice),
            "practice_avg": round(practice_avg * 100) if practice_avg is not None else None,
            "projects": projects,
        })

    finished = total_all > 0 and done_all >= total_all
    joined = _utc(user.created_at)
    if last is None:
        if joined and now - joined >= timedelta(days=NOT_STARTED_DAYS):
            flags.insert(0, {"code": "not_started", "label": f"Joined {(now - joined).days} days ago, nothing done yet"})
    elif not finished and now - last >= timedelta(days=INACTIVE_DAYS):
        where = f" on {next_up['title']}" if next_up else ""
        flags.insert(0, {"code": "inactive", "label": f"No activity for {(now - last).days} days{where}"})

    state = "done" if finished else "stuck" if flags else "not_started" if last is None else "on_track"
    return {
        "id": user.id, "name": user.name,
        "joined_at": _iso(joined), "last_active": _iso(last),
        "state": state, "flags": flags,
        "done": done_all, "total": total_all,
        "percent": round(100 * done_all / total_all) if total_all else 0,
        "next_up": None if finished else next_up,
        "weeks": week_rows,
    }


def _rows(db: Session, users: list[User]) -> list[dict]:
    weeks = load_weeks()
    now = datetime.now(timezone.utc)
    ids = [u.id for u in users]
    data = _Data(db, ids)
    rows = [_learner(u, data, weeks, now) for u in users]
    for key, fn in LEARNER_EXTRAS.items():
        extra = fn(db, ids)
        for r in rows:
            r[key] = extra.get(r["id"])
    return rows


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs)) if xs else None


@router.get("/learners")
def learners(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.scalars(select(User).order_by(User.created_at)).all()
    rows = _rows(db, users)
    for r in rows:
        r["is_you"] = r["id"] == admin.id
    order = {"stuck": 0, "not_started": 1, "on_track": 2, "done": 3}
    rows.sort(key=lambda r: (order[r["state"]], r["percent"], r["name"].lower()))
    week_ids = list(load_weeks())
    quiz_pct = lambda r, wid: next(  # noqa: E731
        (round(100 * w["quiz"]["score"] / w["quiz"]["total"]) for w in r["weeks"]
         if w["id"] == wid and w["quiz"] and w["quiz"]["total"]), None)
    return {
        "summary": {
            "learners": len(rows),
            "stuck": sum(r["state"] == "stuck" for r in rows),
            "not_started": sum(r["last_active"] is None for r in rows),  # includes stuck ones
            "on_track": sum(r["state"] == "on_track" for r in rows),
            "done": sum(r["state"] == "done" for r in rows),
            "avg_percent": _avg([r["percent"] for r in rows]),
            "quiz_avg": {wid: _avg([quiz_pct(r, wid) for r in rows]) for wid in week_ids},
        },
        "rules": {"inactive_days": INACTIVE_DAYS, "not_started_days": NOT_STARTED_DAYS,
                  "quiz_fails": QUIZ_FAILS, "practice_low_percent": round(PRACTICE_LOW * 100)},
        "learners": rows,
    }


@router.get("/learners/{user_id}")
def learner(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown learner.")
    row = _rows(db, [user])[0]
    row["is_you"] = user.id == admin.id
    weeks = load_weeks()
    d = _Data(db, [user.id])
    for w in row["weeks"]:
        week = weeks[w["id"]]
        done = _done_items(week, d.items[user.id], d.steps[user.id], d.quizzes[user.id])
        w["modules"] = [{"title": m.title, "items": [
            {"id": i.id, "title": i.title, "type": i.type, "done": i.id in done} for i in m.items]}
            for m in week.modules]
        for p in w["projects"]:
            p["submission"] = [
                {"label": f.label, "kind": f.kind,
                 "value": next((s.value for s in d.subs[user.id]
                                if s.week_id == week.id and s.project_id == p["id"] and s.field_id == f.id), "")}
                for f in next(x for x in week.projects if x.id == p["id"]).submit]
    row["attempts"] = [
        {"week_id": q.week_id, "kind": q.kind, "score": q.score, "total": q.total,
         "item": (q.answers or {}).get("_item") if isinstance(q.answers, dict) else None, "at": _iso(q.created_at)}
        for q in sorted(d.quizzes[user.id], key=lambda q: _utc(q.created_at), reverse=True)[:30]]
    return row
