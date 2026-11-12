"""Coursera-style course routes: syllabus, per-item completion and per-item quizzes."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .api import get_progress
from .content import Week, load_course, load_weeks
from .db import get_db
from .models import QuizAttempt, StepProgress, User
from .models_course import ItemProgress
from .security import current_user

router = APIRouter()

MANUAL = {"overview", "lesson", "reading"}  # finished when the learner marks them
# practice: finished on any attempt; quiz: finished when passed;
# project: finished when every step is ticked; voice: finished after one scored call.


def _week(week_id: str) -> Week:
    week = load_weeks().get(week_id)
    if week is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That week isn't available yet.")
    return week


def _done_items(db: Session, user_id: int, week: Week) -> set[str]:
    done = set(db.scalars(select(ItemProgress.item_id).where(
        ItemProgress.user_id == user_id, ItemProgress.week_id == week.id)).all())
    steps = db.scalars(select(StepProgress).where(
        StepProgress.user_id == user_id, StepProgress.week_id == week.id)).all()
    voice_tries = db.scalar(select(QuizAttempt.id).where(
        QuizAttempt.user_id == user_id, QuizAttempt.week_id == week.id, QuizAttempt.kind == "voice").limit(1))
    for item in week.items():
        if item.type == "project":
            project = next(p for p in week.projects if p.id == item.ref)
            ticked = {s.step_index for s in steps if s.project_id == project.id}
            if len(ticked) >= len(project.steps):
                done.add(item.id)
        elif item.type == "voice" and voice_tries:
            done.add(item.id)
    return done & {i.id for i in week.items()}


@router.get("/course")
def course():
    c = load_course()
    weeks = load_weeks()
    out = []
    for w in c.weeks:
        entry = w.model_dump()
        week = weeks.get(w.id) if w.id else None
        entry["open"] = week is not None
        if week:
            entry["due"] = week.due
            entry["modules"] = [{"id": m.id, "title": m.title, "items": len(m.items)} for m in week.modules]
            entry["total_items"] = len(week.items())
        out.append(entry)
    return {"title": c.title, "subtitle": c.subtitle, "weeks": out}


@router.get("/course/progress")
def course_progress(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {
        wid: {"done": len(_done_items(db, user.id, w)), "total": len(w.items())}
        for wid, w in load_weeks().items()
    }


@router.get("/weeks/{week_id}/items/progress")
def item_progress(week_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    week = _week(week_id)
    base = get_progress(week_id, user, db)
    base["items_done"] = sorted(_done_items(db, user.id, week))
    return base


class Done(BaseModel):
    done: bool = True


@router.put("/weeks/{week_id}/items/{item_id}/complete")
def mark_item(week_id: str, item_id: str, body: Done, user: User = Depends(current_user), db: Session = Depends(get_db)):
    week = _week(week_id)
    item = week.item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown item.")
    if item.type not in MANUAL:
        raise HTTPException(status.HTTP_409_CONFLICT, "This item completes itself when you finish it.")
    _set_done(db, user.id, week_id, item_id, body.done)
    db.commit()
    return {"done": body.done}


def _set_done(db: Session, user_id: int, week_id: str, item_id: str, done: bool) -> None:
    row = db.scalar(select(ItemProgress).where(
        ItemProgress.user_id == user_id, ItemProgress.week_id == week_id, ItemProgress.item_id == item_id))
    if done and row is None:
        db.add(ItemProgress(user_id=user_id, week_id=week_id, item_id=item_id))
    elif not done and row is not None:
        db.delete(row)


class Answers(BaseModel):
    answers: dict[str, int]


@router.post("/weeks/{week_id}/items/{item_id}/quiz")
def submit_item_quiz(week_id: str, item_id: str, body: Answers,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Grades a practice quiz or the graded quiz. Answers never leave the server before this."""
    week = _week(week_id)
    item = week.item(item_id)
    if item is None or item.type not in ("practice", "quiz"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown quiz.")
    questions = {q.id: q for q in week.quiz}
    results, score = [], 0
    for qid in item.refs:
        q = questions[qid]
        chosen = body.answers.get(qid)
        correct = chosen == q.answer
        score += correct
        results.append({"id": qid, "chosen": chosen, "answer": q.answer, "correct": correct, "explanation": q.explanation})
    total = len(item.refs)
    passed = score * 100 >= week.pass_percent * total
    kind = "mcq" if item.type == "quiz" else "practice"
    db.add(QuizAttempt(user_id=user.id, week_id=week_id, kind=kind, score=score, total=total,
                       answers={**body.answers, "_item": item_id}))
    if item.type == "practice" or passed:
        _set_done(db, user.id, week_id, item_id, True)
    db.commit()
    return {"score": score, "total": total, "passed": passed, "pass_percent": week.pass_percent, "results": results}
