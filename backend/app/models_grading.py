"""Auto-grading tables (kept apart from models.py so other changes don't collide)."""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class GradingRun(Base):
    """One attempt at grading one learner's project. The newest run per (user, project) is the grade."""

    __tablename__ = "fde_grading_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    week_id: Mapped[str] = mapped_column(String(40))
    project_id: Mapped[str] = mapped_column(String(10), index=True)
    repo_url: Mapped[str] = mapped_column(Text)
    # queued → running → reviewing → done; or error / not_configured
    status: Mapped[str] = mapped_column(String(20), default="queued")
    token_hash: Mapped[str] = mapped_column(String(64), default="")
    requested_by: Mapped[str] = mapped_column(String(20), default="learner")  # learner | admin
    run_url: Mapped[str] = mapped_column(Text, default="")
    checks: Mapped[list | None] = mapped_column(JSON, nullable=True)
    review: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    report: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # repo facts and log tails
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
