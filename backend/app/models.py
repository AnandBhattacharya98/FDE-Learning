"""Tables are prefixed fde_ so they can live beside sunny-side's tables."""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "fde_users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class QuizAttempt(Base):
    __tablename__ = "fde_quiz_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    week_id: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="mcq")  # mcq | voice
    score: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    answers: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class StepProgress(Base):
    __tablename__ = "fde_step_progress"
    __table_args__ = (UniqueConstraint("user_id", "week_id", "project_id", "step_index"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    week_id: Mapped[str] = mapped_column(String(40))
    project_id: Mapped[str] = mapped_column(String(10))
    step_index: Mapped[int] = mapped_column(Integer)
    done_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Submission(Base):
    __tablename__ = "fde_submissions"
    __table_args__ = (UniqueConstraint("user_id", "week_id", "project_id", "field_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    week_id: Mapped[str] = mapped_column(String(40))
    project_id: Mapped[str] = mapped_column(String(10))
    field_id: Mapped[str] = mapped_column(String(40))
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
