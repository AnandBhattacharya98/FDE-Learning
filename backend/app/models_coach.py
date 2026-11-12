"""Ask-the-coach table: one row per question, for rate limits and God mode's "what learners ask"."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class CoachQuestion(Base):
    __tablename__ = "fde_coach_questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    week_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    question: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(10))  # ai | search
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                                                 index=True)
