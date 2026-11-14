"""Teacher mode tables (kept apart from models.py so other changes don't collide)."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TeacherRole(Base):
    """An email the admin made a teacher from God mode (TEACHER_EMAILS on Render also works)."""

    __tablename__ = "fde_teachers"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    added_by: Mapped[int | None] = mapped_column(ForeignKey("fde_users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Material(Base):
    """A video, slide deck, document or link a teacher added to a week (and optionally a module)."""

    __tablename__ = "fde_materials"
    id: Mapped[int] = mapped_column(primary_key=True)
    week_id: Mapped[str] = mapped_column(String(40), index=True)
    module_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    kind: Mapped[str] = mapped_column(String(10))  # video | slides | doc | link
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text, default="")  # for links: YouTube, Loom, Drive, Vimeo...
    file_name: Mapped[str] = mapped_column(String(255), default="")
    content_type: Mapped[str] = mapped_column(String(120), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    # Text the quiz generator reads: extracted from PDF/PPTX/text uploads, plus the teacher's own
    # notes or a pasted transcript (videos can't be read directly).
    text: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int] = mapped_column(ForeignKey("fde_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class MaterialFile(Base):
    """The uploaded bytes, in their own table so listing materials never loads them."""

    __tablename__ = "fde_material_files"
    material_id: Mapped[int] = mapped_column(ForeignKey("fde_materials.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class TeacherQuiz(Base):
    """A quiz a teacher generated with Claude (or wrote by hand). Learners only see published ones."""

    __tablename__ = "fde_teacher_quizzes"
    id: Mapped[int] = mapped_column(primary_key=True)
    week_id: Mapped[str] = mapped_column(String(40), index=True)
    module_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(12), default="draft")  # generating | draft | published | failed
    message: Mapped[str] = mapped_column(Text, default="")
    pass_percent: Mapped[int] = mapped_column(Integer, default=80)
    # [{id, question, options: [..], answer: int, explanation, source}]
    questions: Mapped[list] = mapped_column(JSON, default=list)
    material_ids: Mapped[list] = mapped_column(JSON, default=list)
    generated_by: Mapped[str] = mapped_column(String(40), default="manual")  # manual | model id
    created_by: Mapped[int] = mapped_column(ForeignKey("fde_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class TeacherQuizAttempt(Base):
    __tablename__ = "fde_teacher_quiz_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    quiz_id: Mapped[int] = mapped_column(ForeignKey("fde_teacher_quizzes.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    answers: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GradeReview(Base):
    """A teacher's decision on one grading run: accept the auto grade, override it, or ask for changes."""

    __tablename__ = "fde_grade_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("fde_grading_runs.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"), index=True)
    project_id: Mapped[str] = mapped_column(String(10))
    decision: Mapped[str] = mapped_column(String(12))  # approved | override | changes
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # set when decision = override
    feedback: Mapped[str] = mapped_column(Text, default="")
    teacher_id: Mapped[int] = mapped_column(ForeignKey("fde_users.id"))
    teacher_name: Mapped[str] = mapped_column(String(120), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Announcement(Base):
    __tablename__ = "fde_announcements"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    week_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("fde_users.id"))
    author_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
