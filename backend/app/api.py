"""Every route the site needs, on one router, so sunny-side can mount it with include_router."""
from datetime import timedelta

import hmac

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .content import Week, load_weeks
from .db import get_db
from .models import QuizAttempt, StepProgress, Submission, User
from .security import create_token, current_user, token_claims, hash_password, verify_password, not_allowed_message

router = APIRouter()


# ---------- auth ----------

class SignUp(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LogIn(BaseModel):
    email: EmailStr
    password: str


def _user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name}


@router.post("/auth/signup", status_code=status.HTTP_201_CREATED)
def signup(body: SignUp, db: Session = Depends(get_db)):
    if not get_settings().password_signup_open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "New accounts use Sign in with Google. " + not_allowed_message())
    user = User(email=body.email.lower(), name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists. Try logging in.")
    return {"token": create_token(user.id), "user": _user_out(user)}


@router.post("/auth/login")
def login(body: LogIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That email and password don't match.")
    if not get_settings().email_allowed(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, not_allowed_message())
    return {"token": create_token(user.id), "user": _user_out(user)}


@router.get("/me")
def me(user: User = Depends(current_user), claims: dict = Depends(token_claims), db: Session = Depends(get_db)):
    from .admin import is_admin
    from .teacher import is_teacher

    out = _user_out(user)
    if is_admin(user, claims):
        out["admin"] = True  # only ever sent to the admin, so others can't tell God mode exists
    if is_teacher(db, user, claims):
        out["teacher"] = True  # teachers (and the admin) get the Teach link
    return out


# ---------- weeks ----------

def _week(week_id: str) -> Week:
    week = load_weeks().get(week_id)
    if week is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That week isn't available yet.")
    return week


@router.get("/weeks")
def list_weeks():
    return [
        {"id": w.id, "number": w.number, "title": w.title, "goal": w.goal, "due": w.due}
        for w in load_weeks().values()
    ]


@router.get("/weeks/{week_id}")
def get_week(week_id: str):
    return _week(week_id).public()


# ---------- multiple-choice quiz ----------

class QuizSubmit(BaseModel):
    answers: dict[str, int]


@router.post("/weeks/{week_id}/quiz")
def submit_quiz(week_id: str, body: QuizSubmit, user: User = Depends(current_user), db: Session = Depends(get_db)):
    week = _week(week_id)
    results = []
    score = 0
    for q in week.quiz:
        chosen = body.answers.get(q.id)
        correct = chosen == q.answer
        score += correct
        results.append({"id": q.id, "chosen": chosen, "answer": q.answer, "correct": correct, "explanation": q.explanation})
    db.add(QuizAttempt(user_id=user.id, week_id=week_id, kind="mcq", score=score, total=len(week.quiz), answers=body.answers))
    db.commit()
    return {"score": score, "total": len(week.quiz), "results": results}


def _best(db: Session, user_id: int, week_id: str, kind: str):
    row = db.execute(
        select(QuizAttempt.score, QuizAttempt.total)
        .where(QuizAttempt.user_id == user_id, QuizAttempt.week_id == week_id, QuizAttempt.kind == kind)
        .order_by(QuizAttempt.score.desc(), QuizAttempt.created_at.desc())
        .limit(1)
    ).first()
    count = db.scalar(
        select(func.count()).select_from(QuizAttempt)
        .where(QuizAttempt.user_id == user_id, QuizAttempt.week_id == week_id, QuizAttempt.kind == kind)
    )
    return {"best": {"score": row.score, "total": row.total} if row else None, "attempts": count}


# ---------- progress: project steps and submissions ----------

class StepToggle(BaseModel):
    done: bool


class SubmissionIn(BaseModel):
    value: str = Field(max_length=5000)


def _project(week: Week, project_id: str):
    for p in week.projects:
        if p.id == project_id:
            return p
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown project.")


@router.get("/weeks/{week_id}/progress")
def get_progress(week_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    week = _week(week_id)
    steps = db.scalars(select(StepProgress).where(StepProgress.user_id == user.id, StepProgress.week_id == week_id)).all()
    subs = db.scalars(select(Submission).where(Submission.user_id == user.id, Submission.week_id == week_id)).all()
    projects = {}
    for p in week.projects:
        done = sorted(s.step_index for s in steps if s.project_id == p.id)
        projects[p.id] = {
            "steps_done": done,
            "submission": {s.field_id: s.value for s in subs if s.project_id == p.id},
        }
    return {"projects": projects, "quiz": _best(db, user.id, week_id, "mcq"), "voice_quiz": _best(db, user.id, week_id, "voice")}


@router.put("/weeks/{week_id}/projects/{project_id}/steps/{step_index}")
def set_step(week_id: str, project_id: str, step_index: int, body: StepToggle,
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _project(_week(week_id), project_id)
    if not 0 <= step_index < len(project.steps):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown step.")
    existing = db.scalar(select(StepProgress).where(
        StepProgress.user_id == user.id, StepProgress.week_id == week_id,
        StepProgress.project_id == project_id, StepProgress.step_index == step_index))
    if body.done and existing is None:
        db.add(StepProgress(user_id=user.id, week_id=week_id, project_id=project_id, step_index=step_index))
    elif not body.done and existing is not None:
        db.delete(existing)
    db.commit()
    return {"done": body.done}


@router.put("/weeks/{week_id}/projects/{project_id}/submission/{field_id}")
def set_submission(week_id: str, project_id: str, field_id: str, body: SubmissionIn, background: BackgroundTasks,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _project(_week(week_id), project_id)
    field = next((f for f in project.submit if f.id == field_id), None)
    if field is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown field.")
    value = body.value.strip()
    if field.kind == "url" and value and not value.startswith(("https://", "http://")):
        raise HTTPException(422, "Links need to start with https://")
    existing = db.scalar(select(Submission).where(
        Submission.user_id == user.id, Submission.week_id == week_id,
        Submission.project_id == project_id, Submission.field_id == field_id))
    if existing:
        existing.value = value
    else:
        db.add(Submission(user_id=user.id, week_id=week_id, project_id=project_id, field_id=field_id, value=value))
    db.commit()
    # A new repo link starts auto-grading (see grading.py).
    from .grading import queue_for_submission

    queue_for_submission(db, user.id, week_id, project_id, field_id, background)
    return {"value": value}


# ---------- voice quiz (LiveKit) ----------

@router.post("/weeks/{week_id}/voice-quiz/token")
def voice_quiz_token(week_id: str, user: User = Depends(current_user)):
    """Gives the browser a short-lived LiveKit token for a private quiz room.

    The voice-quiz worker (voice_agent/) is dispatched into the same room and reads
    the week id from the room metadata.
    """
    _week(week_id)
    s = get_settings()
    if not s.livekit_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The voice quiz isn't set up yet. Ask an admin to add the LiveKit keys.")
    from livekit import api as lk

    room = f"fde-quiz-{week_id}-u{user.id}"
    token = (
        lk.AccessToken(s.livekit_api_key, s.livekit_api_secret)
        .with_identity(f"user-{user.id}")
        .with_name(user.name)
        .with_ttl(timedelta(minutes=15))
        .with_grants(lk.VideoGrants(room_join=True, room=room))
        .with_room_config(lk.RoomConfiguration(
            metadata=f'{{"week_id": "{week_id}", "user_id": {user.id}}}',
            agents=[lk.RoomAgentDispatch(agent_name="fde-voice-quiz")],
        ))
        .to_jwt()
    )
    return {"url": s.livekit_url, "token": token, "room": room}


class VoiceResult(BaseModel):
    user_id: int
    score: int = Field(ge=0)
    total: int = Field(ge=1)
    notes: dict[str, str] = {}


@router.post("/internal/weeks/{week_id}/voice-quiz/result", status_code=status.HTTP_201_CREATED)
def record_voice_result(week_id: str, body: VoiceResult, x_worker_key: str = Header(default=""),
                        db: Session = Depends(get_db)):
    """Called by the voice-quiz worker when a quiz call ends. Not for browsers."""
    _week(week_id)
    expected = get_settings().voice_worker_key
    if not expected or not hmac.compare_digest(x_worker_key, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad worker key.")
    if db.get(User, body.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown user.")
    db.add(QuizAttempt(user_id=body.user_id, week_id=week_id, kind="voice",
                       score=body.score, total=body.total, answers=body.notes))
    db.commit()
    return {"ok": True}
