"""Voice-quiz scorecards and the leaderboard.

The voice worker (voice_agent/agent.py) posts each call here: what it asked, whether each
answer was good, what was missed and the transcript. The browser then shows a scorecard
for the call and a leaderboard for everyone on the course.
"""
import hmac
from collections import Counter
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .admin import require_admin
from .config import get_settings
from .content import Week, load_weeks
from .db import get_db
from .models import QuizAttempt, User
from .models_voice import VoiceScorecard
from .security import current_user

router = APIRouter()

MAX_TURNS = 400
MAX_TEXT = 2000


def _week(week_id: str) -> Week:
    week = load_weeks().get(week_id)
    if week is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That week isn't available yet.")
    return week


# ---------- from the worker ----------

class Turn(BaseModel):
    role: Literal["coach", "learner"]
    text: str


class QuestionResult(BaseModel):
    id: str
    correct: bool | None = None  # None: asked but not scored (the call ended early)
    note: str = Field(default="", max_length=1000)
    missed: list[str] = []


class CallIn(BaseModel):
    call_id: str = Field(min_length=1, max_length=80)
    user_id: int
    week_id: str
    complete: bool
    questions: list[QuestionResult] = []
    transcript: list[Turn] = []


def _check_worker(key: str) -> None:
    expected = get_settings().voice_worker_key
    if not expected or not hmac.compare_digest(key, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad worker key.")


def _clean_transcript(turns: list[Turn]) -> list[dict]:
    out = []
    for t in turns:
        text = " ".join(t.text.split())[:MAX_TEXT]
        if text:
            out.append({"role": t.role, "text": text})
    return out[-MAX_TURNS:]


@router.post("/internal/voice-quiz/calls", status_code=status.HTTP_201_CREATED)
def record_call(body: CallIn, x_worker_key: str = Header(default=""), db: Session = Depends(get_db)):
    """Saves (or updates) one call's scorecard. Called by the voice worker, never by browsers.

    The worker posts once when the coach scores the learner (complete=true) and again when the
    call closes with the full transcript. The second post only fills in the transcript, so
    the order doesn't matter and a retry is harmless.
    """
    _check_worker(x_worker_key)
    week = _week(body.week_id)
    if db.get(User, body.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown user.")
    prompts = {v.id: v for v in week.voice_quiz}
    concepts = {c.id: c.title for c in week.concepts}
    unknown = [q.id for q in body.questions if q.id not in prompts]
    if unknown:
        raise HTTPException(422, f"Unknown question ids: {', '.join(unknown)}")

    card = db.scalar(select(VoiceScorecard).where(VoiceScorecard.call_id == body.call_id))
    if card is None:
        card = VoiceScorecard(call_id=body.call_id, user_id=body.user_id, week_id=body.week_id)
        db.add(card)
    elif card.user_id != body.user_id or card.week_id != body.week_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "That call belongs to someone else.")

    transcript = _clean_transcript(body.transcript)
    if len(transcript) >= len(card.transcript or []):
        card.transcript = transcript

    # A scored card is never downgraded by the end-of-call post.
    if body.questions and (body.complete or not card.complete):
        questions = []
        for q in body.questions:
            p = prompts[q.id]
            correct = q.correct if body.complete else None
            questions.append({
                "id": q.id, "concept": p.concept, "concept_title": concepts.get(p.concept, p.concept),
                "prompt": p.prompt, "correct": correct, "note": q.note.strip(),
                "missed": [m.strip() for m in q.missed if m.strip()][:8],
            })
        card.questions = questions
        card.total = len(questions)
        card.score = sum(1 for q in questions if q["correct"])
        card.weak_topics = list(dict.fromkeys(q["concept_title"] for q in questions if q["correct"] is False))

    if body.complete and not card.complete:
        card.complete = True
        attempt = QuizAttempt(user_id=body.user_id, week_id=body.week_id, kind="voice", score=card.score,
                              total=card.total, answers={q["id"]: q["note"] for q in card.questions})
        db.add(attempt)
        db.flush()
        card.attempt_id = attempt.id
    elif body.complete and card.attempt_id:
        attempt = db.get(QuizAttempt, card.attempt_id)
        attempt.score, attempt.total = card.score, card.total
    db.commit()
    return {"id": card.id, "complete": card.complete, "score": card.score, "total": card.total}


# ---------- for the learner ----------

def _card_out(c: VoiceScorecard) -> dict:
    return {
        "id": c.id, "week_id": c.week_id, "complete": c.complete, "score": c.score, "total": c.total,
        "questions": c.questions or [], "weak_topics": c.weak_topics or [], "transcript": c.transcript or [],
        "created_at": c.created_at.isoformat(),
    }


@router.get("/weeks/{week_id}/voice-quiz/scorecards")
def my_scorecards(week_id: str, limit: int = Query(default=10, ge=1, le=50),
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The signed-in learner's calls for a week, newest first."""
    _week(week_id)
    cards = db.scalars(select(VoiceScorecard)
                       .where(VoiceScorecard.user_id == user.id, VoiceScorecard.week_id == week_id)
                       .order_by(VoiceScorecard.created_at.desc(), VoiceScorecard.id.desc()).limit(limit)).all()
    return {"scorecards": [_card_out(c) for c in cards]}


def _leaderboard(db: Session, week_ids: list[str], me: int) -> list[dict]:
    rows = db.execute(
        select(VoiceScorecard, User.name).join(User, User.id == VoiceScorecard.user_id)
        .where(VoiceScorecard.complete.is_(True), VoiceScorecard.week_id.in_(week_ids))
    ).all()
    # Best call per learner per week; across weeks the bests add up.
    best: dict[tuple[int, str], VoiceScorecard] = {}
    calls: Counter = Counter()
    names: dict[int, str] = {}
    for card, name in rows:
        names[card.user_id] = name
        calls[card.user_id] += 1
        key = (card.user_id, card.week_id)
        cur = best.get(key)
        ratio = card.score / card.total if card.total else 0
        if cur is None or ratio > cur.score / cur.total or (ratio == cur.score / cur.total and card.created_at < cur.created_at):
            best[key] = card
    people: dict[int, dict] = {}
    for (uid, _), card in best.items():
        p = people.setdefault(uid, {"score": 0, "total": 0, "weeks": 0, "reached_at": card.created_at})
        p["score"] += card.score
        p["total"] += card.total
        p["weeks"] += 1
        p["reached_at"] = max(p["reached_at"], card.created_at)
    board = sorted(people.items(), key=lambda kv: (-kv[1]["score"] / kv[1]["total"], -kv[1]["weeks"],
                                                   kv[1]["reached_at"]))
    out = []
    for i, (uid, p) in enumerate(board):
        out.append({
            "rank": i + 1, "name": names[uid], "you": uid == me, "score": p["score"], "total": p["total"],
            "percent": round(100 * p["score"] / p["total"]), "weeks": p["weeks"], "calls": calls[uid],
        })
    return out


@router.get("/voice-quiz/leaderboard")
def leaderboard(week_id: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everyone's best scored voice call. With week_id, one week; without, the whole course."""
    week_ids = [_week(week_id).id] if week_id else list(load_weeks())
    return {"week_id": week_id, "entries": _leaderboard(db, week_ids, user.id)}


# ---------- for God mode and the cohort view ----------

def voice_summary(db: Session, user_ids: list[int]) -> dict[int, dict]:
    """{user_id: {"latest": {...}, "weak_topics": [...], "calls": n}} over complete calls."""
    if not user_ids:
        return {}
    cards = db.scalars(select(VoiceScorecard)
                       .where(VoiceScorecard.complete.is_(True), VoiceScorecard.user_id.in_(user_ids))
                       .order_by(VoiceScorecard.created_at.desc(), VoiceScorecard.id.desc())).all()
    out: dict[int, dict] = {}
    weak: dict[int, Counter] = {}
    for c in cards:
        if c.user_id not in out:
            out[c.user_id] = {"latest": {"week_id": c.week_id, "score": c.score, "total": c.total,
                                         "created_at": c.created_at.isoformat()}, "calls": 0}
        out[c.user_id]["calls"] += 1
        weak.setdefault(c.user_id, Counter()).update(c.weak_topics or [])
    for uid, entry in out.items():
        entry["weak_topics"] = [t for t, _ in weak[uid].most_common(5)]
    return out


@router.get("/admin/voice-scorecards")
def admin_scorecards(user_id: int | None = None, limit: int = Query(default=50, ge=1, le=200),
                     _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Recent calls from every learner (or one), with transcripts, for God mode."""
    q = select(VoiceScorecard, User.name).join(User, User.id == VoiceScorecard.user_id)
    if user_id is not None:
        q = q.where(VoiceScorecard.user_id == user_id)
    rows = db.execute(q.order_by(VoiceScorecard.created_at.desc(), VoiceScorecard.id.desc()).limit(limit)).all()
    return {"scorecards": [{**_card_out(c), "user_id": c.user_id, "name": name} for c, name in rows]}
