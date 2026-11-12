"""Course-progress tables (kept apart from models.py so auth changes don't collide)."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class ItemProgress(Base):
    """One row per course item a learner has finished (lessons, readings, practice, graded quiz)."""

    __tablename__ = "fde_item_progress"
    __table_args__ = (UniqueConstraint("user_id", "week_id", "item_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    week_id: Mapped[str] = mapped_column(String(40))
    item_id: Mapped[str] = mapped_column(String(80))
    done_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
