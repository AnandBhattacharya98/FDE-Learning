"""God mode tables (kept apart from models.py so other changes don't collide)."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AssignmentStatus(Base):
    """The admin's own status for each required assignment in content/assignments.json."""

    __tablename__ = "fde_admin_assignment_status"
    __table_args__ = (UniqueConstraint("user_id", "assignment_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    assignment_id: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(10))  # todo | doing | done
    note: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
