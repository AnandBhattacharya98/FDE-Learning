"""Voice-quiz scorecards (kept apart from models.py so other changes don't collide)."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class VoiceScorecard(Base):
    """One voice-quiz call: what was asked, how each answer did, and the transcript.

    complete is False when the learner hung up before the coach scored them; those calls keep
    their transcript but don't count for the score, the leaderboard or course progress.
    """

    __tablename__ = "fde_voice_scorecards"
    id: Mapped[int] = mapped_column(primary_key=True)
    call_id: Mapped[str] = mapped_column(String(80), unique=True)  # the LiveKit job id, so retries update one row
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    week_id: Mapped[str] = mapped_column(String(40), index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("fde_quiz_attempts.id"), nullable=True)
    complete: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    # [{id, concept, concept_title, prompt, correct, note, missed: [..]}]
    questions: Mapped[list] = mapped_column(JSON, default=list)
    weak_topics: Mapped[list] = mapped_column(JSON, default=list)  # concept titles of the missed questions
    transcript: Mapped[list] = mapped_column(JSON, default=list)  # [{role: coach|learner, text}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
