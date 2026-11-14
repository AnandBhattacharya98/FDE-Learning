"""Teacher mode: the /teach dashboard for course authors.

Who is a teacher (checked on the server for every request, like God mode):
  * the account signed in with Google (a password sign-up doesn't prove the email), and
  * its email is in TEACHER_EMAILS (Render env var), or the admin added it in God mode,
    or the person is the admin (ADMIN_EMAILS).
Everyone else gets a plain 404.

What teachers can do:
  * add videos, slides, documents and links to a week or module (files are kept in the
    database; long videos go in as YouTube/Loom/Vimeo/Drive links), and publish them;
  * have Claude write a multiple-choice quiz from those materials and the week's lessons,
    edit every question, then publish it to learners;
  * review learners' GitHub submissions: see the auto-grader's result, check the repo,
    regrade, approve the grade, override it or ask for changes, with written feedback;
  * see the cohort (same view as God mode), quiz results, what learners ask the coach,
    and post announcements.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import (APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, Response,
                     UploadFile, status)
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .admin import is_admin, require_admin
from .config import get_settings
from .content import Week, load_weeks
from .db import SessionLocal, get_db
from .models import Submission, User
from .models_coach import CoachQuestion
from .models_grading import GradingRun
from .models_teacher import (Announcement, GradeReview, Material, MaterialFile, TeacherQuiz, TeacherQuizAttempt,
                             TeacherRole)
from .security import current_user, token_claims

log = logging.getLogger("fde.teacher")
router = APIRouter()

KINDS = ("video", "slides", "doc", "link")
MAX_TEXT = 100_000          # characters of extracted text kept per material
SOURCE_BUDGET = 240_000     # characters of source text sent to Claude for one quiz
FILE_URL_TTL = 6 * 3600     # signed file links stay valid this long
EXTENSIONS = {
    "pdf": ("slides", "application/pdf"),
    "pptx": ("slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    "txt": ("doc", "text/plain"), "md": ("doc", "text/markdown"),
    "vtt": ("doc", "text/vtt"), "srt": ("doc", "text/plain"),
    "mp4": ("video", "video/mp4"), "webm": ("video", "video/webm"), "mov": ("video", "video/quicktime"),
    "m4v": ("video", "video/mp4"),
    "png": ("doc", "image/png"), "jpg": ("doc", "image/jpeg"), "jpeg": ("doc", "image/jpeg"),
}


# ---------- who is a teacher ----------

def teacher_emails_from_db(db: Session) -> set[str]:
    return set(db.scalars(select(TeacherRole.email)).all())


def is_teacher(db: Session, user: User, claims: dict) -> bool:
    if claims.get("via") != "google":
        return False
    if is_admin(user, claims):
        return True
    email = user.email.lower()
    if email in get_settings().teacher_emails:
        return True
    return db.scalar(select(TeacherRole.id).where(TeacherRole.email == email)) is not None


def require_teacher(user: User = Depends(current_user), claims: dict = Depends(token_claims),
                    db: Session = Depends(get_db)) -> User:
    if not is_teacher(db, user, claims):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    return user


def _week(week_id: str) -> Week:
    week = load_weeks().get(week_id)
    if week is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown week.")
    return week


def _check_module(week: Week, module_id: str | None) -> str | None:
    module_id = (module_id or "").strip() or None
    if module_id and module_id not in {m.id for m in week.modules}:
        raise HTTPException(422, "That module isn't in this week.")
    return module_id


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


# ---------- materials: storage helpers ----------

def _sign(material_id: int, exp: int) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"material:{material_id}:{exp}".encode(), hashlib.sha256).hexdigest()[:40]


def file_url(material_id: int) -> str:
    """A link the browser can put in <video>/<iframe> (those can't send our bearer token)."""
    exp = int(time.time()) + FILE_URL_TTL
    return f"/materials/{material_id}/file?exp={exp}&sig={_sign(material_id, exp)}"


def embed_url(url: str) -> str | None:
    """Turn a share link from a video site into a player link, or None if it isn't one we know."""
    u = (url or "").strip()
    m = re.match(r"https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{6,})", u)
    if m:
        return f"https://www.youtube-nocookie.com/embed/{m.group(1)}"
    m = re.match(r"https?://(?:www\.)?loom\.com/(?:share|embed)/([\w]+)", u)
    if m:
        return f"https://www.loom.com/embed/{m.group(1)}"
    m = re.match(r"https?://(?:www\.)?vimeo\.com/(?:video/)?(\d+)", u) or re.match(r"https?://player\.vimeo\.com/video/(\d+)", u)
    if m:
        return f"https://player.vimeo.com/video/{m.group(1)}"
    m = re.match(r"https?://drive\.google\.com/file/d/([\w-]+)", u)
    if m:
        return f"https://drive.google.com/file/d/{m.group(1)}/preview"
    m = re.match(r"https?://docs\.google\.com/presentation/d/([\w-]+)", u)
    if m:
        return f"https://docs.google.com/presentation/d/{m.group(1)}/embed"
    return None


def extract_text(name: str, content_type: str, data: bytes) -> str:
    """Readable text from an upload, for the quiz generator. Best effort: '' when it can't."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    try:
        if ext == "pdf" or content_type == "application/pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            text = "\n\n".join(f"[Page {i + 1}]\n{(p.extract_text() or '').strip()}" for i, p in enumerate(reader.pages))
        elif ext == "pptx":
            from pptx import Presentation

            deck = Presentation(io.BytesIO(data))
            slides = []
            for i, slide in enumerate(deck.slides):
                lines = [s.text_frame.text.strip() for s in slide.shapes if getattr(s, "has_text_frame", False) and s.text_frame.text.strip()]
                if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
                    notes = slide.notes_slide.notes_text_frame.text.strip()
                    if notes:
                        lines.append(f"Speaker notes: {notes}")
                slides.append(f"[Slide {i + 1}]\n" + "\n".join(lines))
            text = "\n\n".join(slides)
        elif ext in ("txt", "md", "vtt", "srt") or content_type.startswith("text/"):
            text = data.decode("utf-8", errors="ignore")
        else:
            return ""
    except Exception as e:  # noqa: BLE001 — a file we can't read still uploads; it just has no text
        log.info("couldn't read text from %s: %s", ext, type(e).__name__)
        return ""
    text = re.sub(r"[ \t]+\n", "\n", text).strip()
    return text[:MAX_TEXT]


def material_view(m: Material, teacher: bool = False) -> dict:
    out = {
        "id": m.id, "week_id": m.week_id, "module_id": m.module_id, "kind": m.kind, "title": m.title,
        "description": m.description, "url": m.url or None, "embed_url": embed_url(m.url) if m.url else None,
        "file_name": m.file_name or None, "content_type": m.content_type or None, "size": m.size,
        "file_url": file_url(m.id) if m.file_name else None, "published": m.published, "position": m.position,
        "updated_at": _iso(m.updated_at),
    }
    if teacher:
        out.update({"notes": m.notes, "text_chars": len(m.text or ""), "has_text": bool((m.text or "").strip() or (m.notes or "").strip())})
    return out


# ---------- materials: teacher endpoints ----------

@router.get("/teacher/materials")
def list_materials(week_id: str | None = None, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    q = select(Material).order_by(Material.week_id, Material.position, Material.id)
    if week_id:
        q = q.where(Material.week_id == week_id)
    return {"materials": [material_view(m, teacher=True) for m in db.scalars(q).all()],
            "max_upload_mb": get_settings().material_max_mb}


@router.post("/teacher/materials", status_code=status.HTTP_201_CREATED)
def add_material(
    week_id: str = Form(...),
    title: str = Form(..., min_length=1, max_length=200),
    kind: str = Form(""),
    module_id: str = Form(""),
    description: str = Form("", max_length=4000),
    url: str = Form("", max_length=2000),
    notes: str = Form("", max_length=MAX_TEXT),
    published: bool = Form(False),
    file: UploadFile | None = File(None),
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Add a material: either a file upload or a link (or both: a link plus the slides behind it)."""
    week = _week(week_id)
    module = _check_module(week, module_id)
    url = url.strip()
    if url and not url.startswith(("https://", "http://")):
        raise HTTPException(422, "Links need to start with https://")
    if file is None and not url:
        raise HTTPException(422, "Upload a file or paste a link.")
    data, name, ctype, guessed = b"", "", "", "link"
    if file is not None:
        name = (file.filename or "upload").rsplit("/", 1)[-1][:255]
        ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
        if ext not in EXTENSIONS:
            raise HTTPException(415, "Upload a PDF, PowerPoint (.pptx), text/markdown/subtitle file, image, "
                                     "or a short MP4/WebM/MOV video.")
        guessed, ctype = EXTENSIONS[ext]
        limit = get_settings().material_max_mb * 1024 * 1024
        data = file.file.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, f"That file is over {get_settings().material_max_mb} MB. Put long videos on "
                                     "YouTube (unlisted), Loom, Vimeo or Google Drive and paste the link instead.")
        if not data:
            raise HTTPException(422, "That file is empty.")
    elif embed_url(url):
        guessed = "slides" if "docs.google.com/presentation" in url else "video"
    kind = kind.strip() or guessed
    if kind not in KINDS:
        raise HTTPException(422, f"kind must be one of {', '.join(KINDS)}.")
    position = (db.scalar(select(func.max(Material.position)).where(Material.week_id == week.id)) or 0) + 1
    m = Material(week_id=week.id, module_id=module, kind=kind, title=title.strip(), description=description.strip(),
                 url=url, file_name=name, content_type=ctype, size=len(data),
                 text=extract_text(name, ctype, data) if data else "", notes=notes.strip(), published=published,
                 position=position, created_by=teacher.id)
    db.add(m)
    db.flush()
    if data:
        db.add(MaterialFile(material_id=m.id, data=data))
    db.commit()
    return material_view(m, teacher=True)


class MaterialPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    module_id: str | None = None
    kind: Literal["video", "slides", "doc", "link"] | None = None
    url: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=MAX_TEXT)
    published: bool | None = None
    position: int | None = None


@router.patch("/teacher/materials/{material_id}")
def edit_material(material_id: int, body: MaterialPatch, teacher: User = Depends(require_teacher),
                  db: Session = Depends(get_db)):
    m = db.get(Material, material_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown material.")
    data = body.model_dump(exclude_unset=True)
    if "module_id" in data:
        m.module_id = _check_module(_week(m.week_id), data.pop("module_id"))
    if "url" in data:
        url = (data.pop("url") or "").strip()
        if url and not url.startswith(("https://", "http://")):
            raise HTTPException(422, "Links need to start with https://")
        if not url and not m.file_name:
            raise HTTPException(422, "A material without a file needs a link.")
        m.url = url
    for k, v in data.items():
        setattr(m, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return material_view(m, teacher=True)


@router.delete("/teacher/materials/{material_id}")
def delete_material(material_id: int, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    m = db.get(Material, material_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown material.")
    f = db.get(MaterialFile, material_id)
    if f:
        db.delete(f)
    db.delete(m)
    db.commit()
    return {"ok": True}


@router.get("/materials/{material_id}/file")
def material_file(material_id: int, exp: int, sig: str, range_: str | None = Header(default=None, alias="range"),
                  db: Session = Depends(get_db)):
    """Serves an uploaded file to a signed link (supports Range, so videos can seek)."""
    if exp < time.time() or not hmac.compare_digest(sig, _sign(material_id, exp)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This link has expired. Reload the page.")
    m = db.get(Material, material_id)
    f = db.get(MaterialFile, material_id)
    if m is None or f is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    data, size = f.data, len(f.data)
    safe = re.sub(r'[^\w.\- ]', "_", m.file_name) or "file"
    headers = {"Accept-Ranges": "bytes", "Content-Disposition": f'inline; filename="{safe}"',
               "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}
    rng = re.match(r"bytes=(\d*)-(\d*)$", range_ or "")
    if rng and (rng.group(1) or rng.group(2)):
        if rng.group(1):
            start = int(rng.group(1))
            end = min(int(rng.group(2)), size - 1) if rng.group(2) else size - 1
        else:  # suffix range: the last N bytes
            start, end = max(0, size - int(rng.group(2))), size - 1
        if start >= size or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(data[start:end + 1], status_code=206, media_type=m.content_type, headers=headers)
    return Response(data, media_type=m.content_type or "application/octet-stream", headers=headers)


# ---------- quizzes: generation with Claude ----------

QUIZ_SYSTEM = """You write multiple-choice quizzes for a Forward Deployed Engineer training course at a company that builds voice AI agents.
Learners are new engineers. Every question must be answerable from the source material you are given; do not test trivia
outside it. Prefer questions that check understanding and application (what would you do, why does this happen) over recall
of exact wording. Each question has 4 options with exactly one correct answer; wrong options must be plausible mistakes a
learner might make, never jokes. The explanation says in one or two sentences why the right answer is right.
"source" names the material (and slide or page when known) the question comes from."""


def _quiz_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "questions": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answer": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "source": {"type": "string"},
                },
                "required": ["question", "options", "answer", "explanation", "source"],
                "additionalProperties": False}},
        },
        "required": ["title", "questions"],
        "additionalProperties": False,
    }


def call_quiz_model(prompt: str, model: str) -> dict:
    """One Claude call with structured output. Tests replace this function."""
    import anthropic

    client = anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=model,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        thinking={"type": "adaptive"},
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _quiz_schema()}},
        system=QUIZ_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("The model declined to write this quiz.")
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("The quiz was too long to finish. Ask for fewer questions.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def build_sources(db: Session, week: Week, material_ids: list[int], use_lessons: bool, module_id: str | None) -> tuple[str, list[str], bool]:
    """The source text for a quiz: chosen materials (their text and teacher notes) and the week's lessons."""
    parts: list[str] = []
    names: list[str] = []
    if material_ids:
        mats = db.scalars(select(Material).where(Material.id.in_(material_ids), Material.week_id == week.id)).all()
        if len(mats) != len(set(material_ids)):
            raise HTTPException(422, "Some of those materials aren't in this week.")
        for m in mats:
            body = "\n\n".join(x for x in ((m.text or "").strip(), (m.notes or "").strip() and f"Teacher's notes:\n{m.notes.strip()}") if x)
            if not body:
                continue
            names.append(m.title)
            parts.append(f'<material title="{m.title}" kind="{m.kind}">\n{m.description}\n\n{body}\n</material>')
    if use_lessons:
        concepts = week.concepts
        if module_id:
            refs = {i.ref for m in week.modules if m.id == module_id for i in m.items if i.type == "lesson"}
            concepts = [c for c in concepts if c.id in refs] or concepts
        for c in concepts:
            parts.append(f'<lesson title="{c.title}">\n{c.summary}\n' + "\n".join(f"- {b}" for b in c.body) + "\n</lesson>")
        names.append(f"Week {week.number} lessons")
    text = "\n\n".join(parts)
    truncated = len(text) > SOURCE_BUDGET
    return text[:SOURCE_BUDGET], names, truncated


def clean_questions(raw: list) -> list[dict]:
    """Keep only well-formed questions, give them ids, and put the answer index in range."""
    out = []
    for q in raw or []:
        if not isinstance(q, dict):
            continue
        options = [str(o).strip() for o in q.get("options") or [] if str(o).strip()][:6]
        try:
            answer = int(q.get("answer", -1))
        except (TypeError, ValueError):
            continue
        if not str(q.get("question", "")).strip() or len(options) < 2 or not 0 <= answer < len(options):
            continue
        out.append({"id": f"q{len(out) + 1}", "question": str(q["question"]).strip(), "options": options,
                    "answer": answer, "explanation": str(q.get("explanation", "")).strip(),
                    "source": str(q.get("source", "")).strip()})
    return out


def run_generation(quiz_id: int, prompt: str) -> None:
    model = get_settings().quiz_model
    with SessionLocal() as db:
        quiz = db.get(TeacherQuiz, quiz_id)
        if quiz is None:
            return
        try:
            result = call_quiz_model(prompt, model)
            questions = clean_questions(result.get("questions", []))
            if not questions:
                raise RuntimeError("The model didn't return any usable questions.")
            quiz.questions = questions
            if not quiz.title.strip() or quiz.title.startswith("Generating"):
                quiz.title = str(result.get("title") or "Quiz").strip()[:200]
            quiz.status, quiz.generated_by = "draft", model
            quiz.message = f"Claude wrote {len(questions)} questions. Check each one before you publish."
        except Exception as e:  # noqa: BLE001 — show the teacher what happened instead of a stuck spinner
            log.warning("quiz generation failed for %s: %s", quiz_id, type(e).__name__)
            quiz.status = "failed"
            quiz.message = str(e) if isinstance(e, RuntimeError) else f"Generation failed ({type(e).__name__}). Try again."
            if quiz.title.startswith("Generating"):
                quiz.title = "Quiz (generation failed)"
        db.commit()


class GenerateIn(BaseModel):
    week_id: str
    module_id: str | None = None
    material_ids: list[int] = Field(default=[], max_length=30)
    use_week_lessons: bool = True
    count: int = Field(default=8, ge=3, le=20)
    difficulty: Literal["easy", "mixed", "hard"] = "mixed"
    focus: str = Field(default="", max_length=600)
    title: str = Field(default="", max_length=200)


@router.post("/teacher/quizzes/generate", status_code=status.HTTP_202_ACCEPTED)
def generate_quiz(body: GenerateIn, background: BackgroundTasks, teacher: User = Depends(require_teacher),
                  db: Session = Depends(get_db)):
    week = _week(body.week_id)
    module = _check_module(week, body.module_id)
    if not get_settings().anthropic_api_key:
        raise HTTPException(503, "Quiz generation needs ANTHROPIC_API_KEY on the server. You can still write a quiz by hand.")
    source, names, truncated = build_sources(db, week, body.material_ids, body.use_week_lessons, module)
    if not source.strip():
        raise HTTPException(422, "Pick at least one material with readable text (or add notes/a transcript to it), "
                                 "or include the week's lessons.")
    level = {"easy": "mostly straightforward checks of the main ideas",
             "mixed": "a mix: some straightforward, most applied, a few that need careful thought",
             "hard": "mostly applied scenarios that need careful thought"}[body.difficulty]
    prompt = (f"Week {week.number}: {week.title}\n\n<sources>\n{source}\n</sources>\n\n"
              f"Write {body.count} questions. Difficulty: {level}."
              + (f"\nThe teacher wants the quiz to focus on: {body.focus.strip()}" if body.focus.strip() else "")
              + "\nGive the quiz a short title.")
    quiz = TeacherQuiz(week_id=week.id, module_id=module, title=body.title.strip() or "Generating…",
                       status="generating", pass_percent=week.pass_percent, questions=[],
                       material_ids=body.material_ids, generated_by=get_settings().quiz_model, created_by=teacher.id,
                       message=f"Claude is reading {', '.join(names)} and writing {body.count} questions."
                               + (" The sources were long, so only the first part was used." if truncated else ""))
    db.add(quiz)
    db.commit()
    background.add_task(run_generation, quiz.id, prompt)
    return quiz_view(quiz, teacher=True)


# ---------- quizzes: teacher endpoints ----------

class QuestionIn(BaseModel):
    id: str | None = None
    question: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=6)
    answer: int
    explanation: str = Field(default="", max_length=2000)
    source: str = Field(default="", max_length=300)

    @field_validator("options")
    @classmethod
    def _options(cls, v):
        v = [o.strip() for o in v]
        if any(not o for o in v):
            raise ValueError("options can't be empty")
        return v

    @model_validator(mode="after")
    def _answer(self):
        if not 0 <= self.answer < len(self.options):
            raise ValueError("answer must point at one of the options")
        return self


class QuizIn(BaseModel):
    week_id: str | None = None
    module_id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    pass_percent: int = Field(default=80, ge=1, le=100)
    questions: list[QuestionIn] = Field(default=[], max_length=50)


def quiz_view(q: TeacherQuiz, teacher: bool = False) -> dict:
    out = {"id": q.id, "week_id": q.week_id, "module_id": q.module_id, "title": q.title, "status": q.status,
           "pass_percent": q.pass_percent, "count": len(q.questions or []), "updated_at": _iso(q.updated_at)}
    if teacher:
        out.update({"questions": q.questions or [], "message": q.message, "generated_by": q.generated_by,
                    "material_ids": q.material_ids or []})
    else:  # learners never see answers before they submit
        out["questions"] = [{"id": x["id"], "question": x["question"], "options": x["options"]} for x in q.questions or []]
    return out


@router.get("/teacher/quizzes")
def list_quizzes(teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    quizzes = db.scalars(select(TeacherQuiz).order_by(TeacherQuiz.id.desc())).all()
    counts = dict(db.execute(select(TeacherQuizAttempt.quiz_id, func.count(func.distinct(TeacherQuizAttempt.user_id)))
                             .group_by(TeacherQuizAttempt.quiz_id)).all())
    return {"quizzes": [{**quiz_view(q, teacher=True), "learners": counts.get(q.id, 0)} for q in quizzes],
            "ai": bool(get_settings().anthropic_api_key), "model": get_settings().quiz_model}


@router.post("/teacher/quizzes", status_code=status.HTTP_201_CREATED)
def create_quiz(body: QuizIn, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    week = _week(body.week_id or "")
    q = TeacherQuiz(week_id=week.id, module_id=_check_module(week, body.module_id), title=body.title.strip(),
                    pass_percent=body.pass_percent, questions=_with_ids(body.questions), created_by=teacher.id,
                    status="draft", generated_by="manual")
    db.add(q)
    db.commit()
    return quiz_view(q, teacher=True)


def _with_ids(questions: list[QuestionIn]) -> list[dict]:
    out, used = [], set()
    for i, x in enumerate(questions):
        qid = x.id if x.id and re.fullmatch(r"[\w-]{1,20}", x.id) and x.id not in used else f"q{i + 1}"
        while qid in used:
            qid += "x"
        used.add(qid)
        out.append({**x.model_dump(), "id": qid})
    return out


def _quiz(db: Session, quiz_id: int) -> TeacherQuiz:
    q = db.get(TeacherQuiz, quiz_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown quiz.")
    return q


@router.put("/teacher/quizzes/{quiz_id}")
def save_quiz(quiz_id: int, body: QuizIn, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    q = _quiz(db, quiz_id)
    if q.status == "generating":
        raise HTTPException(409, "Claude is still writing this quiz.")
    if q.status == "published" and not body.questions:
        raise HTTPException(422, "A published quiz needs at least one question.")
    q.title, q.pass_percent = body.title.strip(), body.pass_percent
    q.module_id = _check_module(_week(q.week_id), body.module_id)
    q.questions = _with_ids(body.questions)
    if q.status == "failed" and q.questions:
        q.status = "draft"
    db.commit()
    return quiz_view(q, teacher=True)


class PublishIn(BaseModel):
    published: bool


@router.post("/teacher/quizzes/{quiz_id}/publish")
def publish_quiz(quiz_id: int, body: PublishIn, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    q = _quiz(db, quiz_id)
    if body.published:
        if q.status not in ("draft", "published") or not q.questions:
            raise HTTPException(422, "Only a finished quiz with at least one question can be published.")
        q.status = "published"
    elif q.status == "published":
        q.status = "draft"
    db.commit()
    return quiz_view(q, teacher=True)


@router.delete("/teacher/quizzes/{quiz_id}")
def delete_quiz(quiz_id: int, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    q = _quiz(db, quiz_id)
    for a in db.scalars(select(TeacherQuizAttempt).where(TeacherQuizAttempt.quiz_id == q.id)).all():
        db.delete(a)
    db.delete(q)
    db.commit()
    return {"ok": True}


@router.get("/teacher/quizzes/{quiz_id}/results")
def quiz_results(quiz_id: int, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    q = _quiz(db, quiz_id)
    rows = db.execute(select(TeacherQuizAttempt, User.name).join(User, User.id == TeacherQuizAttempt.user_id)
                      .where(TeacherQuizAttempt.quiz_id == q.id).order_by(TeacherQuizAttempt.id)).all()
    learners: dict[int, dict] = {}
    right = {x["id"]: 0 for x in q.questions or []}
    for a, name in rows:
        r = learners.setdefault(a.user_id, {"user_id": a.user_id, "name": name, "attempts": 0, "best": None, "last": None})
        r["attempts"] += 1
        pct = round(100 * a.score / a.total) if a.total else 0
        if r["best"] is None or pct > r["best"]:
            r["best"] = pct
        r["last"], r["last_at"] = pct, _iso(a.created_at)
        r["passed"] = (r["best"] or 0) >= q.pass_percent
    # Per-question: how often learners' latest attempt got it right.
    latest = {}
    for a, _ in rows:
        latest[a.user_id] = a
    for a in latest.values():
        for x in q.questions or []:
            if (a.answers or {}).get(x["id"]) == x["answer"]:
                right[x["id"]] += 1
    n = len(latest)
    return {"quiz": quiz_view(q, teacher=True),
            "learners": sorted(learners.values(), key=lambda r: (r["best"] or 0)),
            "questions": [{"id": x["id"], "question": x["question"], "correct_percent": round(100 * right[x["id"]] / n) if n else None}
                          for x in q.questions or []]}


# ---------- learner side: class materials and quizzes ----------

@router.get("/weeks/{week_id}/class")
def class_materials(week_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    week = _week(week_id)
    mats = db.scalars(select(Material).where(Material.week_id == week.id, Material.published.is_(True))
                      .order_by(Material.position, Material.id)).all()
    quizzes = db.scalars(select(TeacherQuiz).where(TeacherQuiz.week_id == week.id, TeacherQuiz.status == "published")
                         .order_by(TeacherQuiz.id)).all()
    attempts = db.scalars(select(TeacherQuizAttempt).where(TeacherQuizAttempt.user_id == user.id,
                                                           TeacherQuizAttempt.quiz_id.in_([q.id for q in quizzes] or [-1]))).all()
    out_q = []
    for q in quizzes:
        mine = [a for a in attempts if a.quiz_id == q.id]
        best = max(mine, key=lambda a: a.score / a.total if a.total else 0, default=None)
        out_q.append({**quiz_view(q), "attempts": len(mine),
                      "best": {"score": best.score, "total": best.total,
                               "passed": best.score * 100 >= q.pass_percent * best.total} if best else None})
    return {"materials": [material_view(m) for m in mats], "quizzes": out_q}


class AttemptIn(BaseModel):
    answers: dict[str, int]


@router.post("/class-quizzes/{quiz_id}/attempt")
def attempt_quiz(quiz_id: int, body: AttemptIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.get(TeacherQuiz, quiz_id)
    if q is None or q.status != "published":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown quiz.")
    results, score = [], 0
    for x in q.questions:
        chosen = body.answers.get(x["id"])
        ok = chosen == x["answer"]
        score += ok
        results.append({"id": x["id"], "chosen": chosen, "answer": x["answer"], "correct": ok,
                        "explanation": x.get("explanation", "")})
    total = len(q.questions)
    db.add(TeacherQuizAttempt(quiz_id=q.id, user_id=user.id, score=score, total=total,
                              answers={k: v for k, v in body.answers.items() if isinstance(v, int)}))
    db.commit()
    return {"score": score, "total": total, "passed": score * 100 >= q.pass_percent * total,
            "pass_percent": q.pass_percent, "results": results}


# ---------- submissions: review learners' GitHub repos ----------

def _review_view(r: GradeReview | None) -> dict | None:
    if r is None:
        return None
    return {"decision": r.decision, "score": r.score, "feedback": r.feedback, "teacher": r.teacher_name,
            "updated_at": _iso(r.updated_at)}


@router.get("/teacher/submissions")
def submissions(teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from .grading import _expire_if_stale, load_grading, run_view

    rubrics = load_grading()[1]
    weeks = load_weeks()
    subs = db.execute(select(Submission, User.name).join(User, User.id == Submission.user_id)
                      .where(Submission.field_id == "repo_url", Submission.value != "")).all()
    runs = db.scalars(select(GradingRun).order_by(GradingRun.id.desc())).all()
    latest: dict[tuple[int, str], GradingRun] = {}
    for run in runs:
        latest.setdefault((run.user_id, run.project_id), run)
    reviews = {r.run_id: r for r in db.scalars(select(GradeReview).where(
        GradeReview.run_id.in_([r.id for r in latest.values()] or [-1]))).all()}
    rows = []
    for sub, name in subs:
        week = weeks.get(sub.week_id)
        project = next((p for p in week.projects if p.id == sub.project_id), None) if week else None
        run = latest.get((sub.user_id, sub.project_id)) if sub.project_id in rubrics else None
        if run:
            _expire_if_stale(db, run)
        review = reviews.get(run.id) if run else None
        view = run_view(run) if run else None
        if run is None:
            state = "not_graded"
        elif run.status in ("queued", "running", "reviewing"):
            state = "grading"
        elif review:
            state = "changes" if review.decision == "changes" else "reviewed"
        else:
            state = "needs_review"
        final = review.score if review and review.decision == "override" else (run.score if run and run.status == "done" else None)
        rows.append({"user_id": sub.user_id, "learner": name, "week_id": sub.week_id, "project_id": sub.project_id,
                     "project_title": project.title if project else sub.project_id, "repo_url": sub.value,
                     "submitted_at": _iso(sub.updated_at), "run": view, "review": _review_view(review),
                     "final_score": final, "pass_mark": load_grading()[0], "state": state})
    order = {"needs_review": 0, "not_graded": 1, "changes": 2, "grading": 3, "reviewed": 4}
    rows.sort(key=lambda r: (order[r["state"]], r["submitted_at"] or ""), reverse=False)
    return {"submissions": rows,
            "counts": {k: sum(r["state"] == k for r in rows) for k in order}}


@router.get("/teacher/submissions/runs/{run_id}")
def submission_run(run_id: int, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from .grading import _submission, run_view

    run = db.get(GradingRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown run.")
    learner = db.get(User, run.user_id)
    review = db.scalar(select(GradeReview).where(GradeReview.run_id == run.id))
    return {**run_view(run, detail=True), "learner": learner.name if learner else "",
            "submission": _submission(db, run.user_id, run.week_id, run.project_id), "teacher_review": _review_view(review)}


@router.post("/teacher/submissions/{user_id}/{project_id}/grade", status_code=status.HTTP_202_ACCEPTED)
def teacher_regrade(user_id: int, project_id: str, background: BackgroundTasks, teacher: User = Depends(require_teacher),
                    db: Session = Depends(get_db)):
    """Start (or restart) auto-grading for a learner's saved repo link."""
    from .grading import ACTIVE, _latest, dispatch, run_view, start_run

    latest = _latest(db, user_id, project_id)
    if latest and latest.status in ACTIVE:
        latest.status, latest.message = "error", "Replaced by a regrade from teacher mode."
        db.commit()
    run, token = start_run(db, user_id, project_id, "teacher")
    if token:
        background.add_task(dispatch, run.id, token)
    return {"run": run_view(run)}


class ReviewIn(BaseModel):
    decision: Literal["approved", "override", "changes"]
    score: int | None = Field(default=None, ge=0, le=100)
    feedback: str = Field(default="", max_length=8000)

    @model_validator(mode="after")
    def _score(self):
        if self.decision == "override" and self.score is None:
            raise ValueError("An override needs a score from 0 to 100.")
        if self.decision == "changes" and not self.feedback.strip():
            raise ValueError("Tell the learner what to change.")
        return self


@router.put("/teacher/submissions/runs/{run_id}/review")
def review_run(run_id: int, body: ReviewIn, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    run = db.get(GradingRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown run.")
    if body.decision == "approved" and run.score is None:
        raise HTTPException(422, "There's no automatic grade to approve yet. Override it with your own score instead.")
    r = db.scalar(select(GradeReview).where(GradeReview.run_id == run.id))
    if r is None:
        r = GradeReview(run_id=run.id, user_id=run.user_id, project_id=run.project_id, decision=body.decision,
                        teacher_id=teacher.id)
        db.add(r)
    r.decision, r.feedback = body.decision, body.feedback.strip()
    r.score = body.score if body.decision == "override" else None
    r.teacher_id, r.teacher_name = teacher.id, teacher.name
    r.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"teacher_review": _review_view(r)}


@router.delete("/teacher/submissions/runs/{run_id}/review")
def clear_review(run_id: int, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    r = db.scalar(select(GradeReview).where(GradeReview.run_id == run_id))
    if r:
        db.delete(r)
        db.commit()
    return {"teacher_review": None}


def _gh_get(path: str, token: str) -> httpx.Response:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "fde-learning-teacher"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.get(f"https://api.github.com{path}", headers=headers, timeout=15)


@router.get("/teacher/repo-check")
def repo_check(url: str = Query(max_length=500), teacher: User = Depends(require_teacher)):
    """Quick facts about a learner's GitHub link: does it exist, is it public, when was it last pushed."""
    m = re.match(r"https?://(?:www\.)?github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?(?:[#?].*)?$", url.strip())
    if not m:
        return {"ok": False, "problem": "This isn't a GitHub repository link (https://github.com/owner/repo)."}
    owner, repo = m.group(1), m.group(2)
    from .grading import grader_config

    token = grader_config()["github_token"]
    try:
        r = _gh_get(f"/repos/{owner}/{repo}", token)
        if r.status_code == 404:
            return {"ok": False, "problem": "GitHub says this repo doesn't exist or is private, so the grader can't clone it."}
        if r.status_code != 200:
            return {"ok": False, "problem": f"GitHub answered {r.status_code}. Try again in a minute."}
        info = r.json()
        commits = _gh_get(f"/repos/{owner}/{repo}/commits?per_page=1", token)
        last = commits.json()[0] if commits.status_code == 200 and commits.json() else None
        readme = _gh_get(f"/repos/{owner}/{repo}/readme", token).status_code == 200
    except (httpx.HTTPError, ValueError, KeyError, IndexError) as e:
        return {"ok": False, "problem": f"Couldn't reach GitHub ({type(e).__name__})."}
    warnings = []
    if info.get("private"):
        warnings.append("The repo is private: the grader can only clone public repos.")
    if info.get("archived"):
        warnings.append("The repo is archived.")
    if info.get("fork"):
        warnings.append("This is a fork. Check the learner's own commits.")
    if not readme:
        warnings.append("No README.")
    if not info.get("size"):
        warnings.append("The repo looks empty.")
    return {"ok": True, "full_name": info.get("full_name"), "private": bool(info.get("private")),
            "default_branch": info.get("default_branch"), "language": info.get("language"),
            "pushed_at": info.get("pushed_at"), "size_kb": info.get("size"), "readme": readme, "fork": bool(info.get("fork")),
            "last_commit": {"message": (last["commit"]["message"] or "").split("\n")[0][:200],
                            "at": last["commit"]["committer"]["date"], "author": last["commit"]["author"]["name"]} if last else None,
            "warnings": warnings}


# ---------- announcements ----------

class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=8000)
    week_id: str | None = None
    pinned: bool = False


def _announcement_view(a: Announcement) -> dict:
    return {"id": a.id, "title": a.title, "body": a.body, "week_id": a.week_id, "pinned": a.pinned,
            "author": a.author_name, "created_at": _iso(a.created_at)}


@router.get("/announcements")
def announcements(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Announcement).order_by(Announcement.pinned.desc(), Announcement.id.desc()).limit(20)).all()
    return {"announcements": [_announcement_view(a) for a in rows]}


@router.post("/teacher/announcements", status_code=status.HTTP_201_CREATED)
def post_announcement(body: AnnouncementIn, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    if body.week_id:
        _week(body.week_id)
    a = Announcement(title=body.title.strip(), body=body.body.strip(), week_id=body.week_id or None, pinned=body.pinned,
                     created_by=teacher.id, author_name=teacher.name)
    db.add(a)
    db.commit()
    return _announcement_view(a)


@router.patch("/teacher/announcements/{ann_id}")
def edit_announcement(ann_id: int, body: AnnouncementIn, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    a = db.get(Announcement, ann_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown announcement.")
    if body.week_id:
        _week(body.week_id)
    a.title, a.body, a.week_id, a.pinned = body.title.strip(), body.body.strip(), body.week_id or None, body.pinned
    db.commit()
    return _announcement_view(a)


@router.delete("/teacher/announcements/{ann_id}")
def delete_announcement(ann_id: int, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    a = db.get(Announcement, ann_id)
    if a:
        db.delete(a)
        db.commit()
    return {"ok": True}


# ---------- overview and cohort ----------

@router.get("/teacher/overview")
def overview(teacher: User = Depends(require_teacher), claims: dict = Depends(token_claims), db: Session = Depends(get_db)):
    from .cohort import _rows

    weeks = load_weeks()
    learners = _rows(db, db.scalars(select(User)).all())
    subs = submissions(teacher, db)
    count = lambda model, *where: db.scalar(select(func.count()).select_from(model).where(*where))  # noqa: E731
    asked = db.execute(select(CoachQuestion, User.name).join(User, User.id == CoachQuestion.user_id)
                       .order_by(CoachQuestion.id.desc()).limit(15)).all()
    return {
        "me": {"name": teacher.name, "admin": is_admin(teacher, claims)},
        "weeks": [{"id": w.id, "number": w.number, "title": w.title,
                   "modules": [{"id": m.id, "title": m.title} for m in w.modules]} for w in weeks.values()],
        "setup": {"quiz_ai": bool(get_settings().anthropic_api_key), "quiz_model": get_settings().quiz_model,
                  "max_upload_mb": get_settings().material_max_mb},
        "counts": {
            "materials": count(Material), "materials_published": count(Material, Material.published.is_(True)),
            "quizzes_draft": count(TeacherQuiz, TeacherQuiz.status.in_(("draft", "generating", "failed"))),
            "quizzes_published": count(TeacherQuiz, TeacherQuiz.status == "published"),
            "submissions": len(subs["submissions"]), "needs_review": subs["counts"]["needs_review"],
            "learners": len(learners), "stuck": sum(r["state"] == "stuck" for r in learners),
            "announcements": count(Announcement),
        },
        "coach_questions": [{"who": name, "question": q.question, "week_id": q.week_id, "at": _iso(q.created_at)}
                            for q, name in asked],
    }


@router.get("/teacher/learners")
def teacher_learners(teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from .cohort import learners

    return learners(teacher, db)


@router.get("/teacher/learners/{user_id}")
def teacher_learner(user_id: int, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from .cohort import learner

    return learner(user_id, teacher, db)


@router.get("/teacher/voice-scorecards")
def teacher_scorecards(user_id: int | None = None, limit: int = Query(default=50, ge=1, le=200),
                       teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from .voice import admin_scorecards

    return admin_scorecards(user_id, limit, teacher, db)


# ---------- God mode: who is a teacher ----------

class TeacherIn(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.get("/admin/teachers")
def admin_teachers(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    names = {u.email: u.name for u in db.scalars(select(User)).all()}
    rows = [{"id": None, "email": e, "name": names.get(e), "source": "env"} for e in sorted(get_settings().teacher_emails)]
    rows += [{"id": t.id, "email": t.email, "name": names.get(t.email), "source": "god_mode", "added_at": _iso(t.created_at)}
             for t in db.scalars(select(TeacherRole).order_by(TeacherRole.id)).all()]
    return {"teachers": rows}


@router.post("/admin/teachers", status_code=status.HTTP_201_CREATED)
def add_teacher(body: TeacherIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not get_settings().email_allowed(email):
        raise HTTPException(422, "That address can't sign in to this site (ALLOWED_EMAIL_DOMAINS).")
    if db.scalar(select(TeacherRole).where(TeacherRole.email == email)) is None:
        db.add(TeacherRole(email=email, added_by=admin.id))
        db.commit()
    return admin_teachers(admin, db)


@router.delete("/admin/teachers/{teacher_id}")
def remove_teacher(teacher_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    t = db.get(TeacherRole, teacher_id)
    if t:
        db.delete(t)
        db.commit()
    return admin_teachers(admin, db)
