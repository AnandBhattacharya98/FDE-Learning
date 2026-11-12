"""Loads and validates the week content files in content/."""
import json
from functools import lru_cache

from pydantic import BaseModel, Field, model_validator

from .config import get_settings


class Concept(BaseModel):
    id: str
    part: str
    title: str
    summary: str
    body: list[str]
    illustration: str | None = None


class Resource(BaseModel):
    title: str
    url: str | None = None
    note: str = ""


class ResourceGroup(BaseModel):
    group: str
    items: list[Resource]


class SubmitField(BaseModel):
    id: str
    label: str
    kind: str = Field(pattern="^(url|text)$")


class Project(BaseModel):
    id: str
    title: str
    summary: str
    steps: list[str]
    done_when: str
    submit: list[SubmitField]
    warning: str = ""


class QuizQuestion(BaseModel):
    id: str
    concept: str
    question: str
    options: list[str] = Field(min_length=2)
    answer: int
    explanation: str

    @model_validator(mode="after")
    def _answer_in_range(self):
        if not 0 <= self.answer < len(self.options):
            raise ValueError(f"{self.id}: answer index out of range")
        return self


class VoicePrompt(BaseModel):
    id: str
    concept: str
    prompt: str
    look_for: list[str]


class Illustration(BaseModel):
    id: str
    title: str
    brief: str


ITEM_TYPES = "^(overview|lesson|reading|practice|quiz|project|voice)$"


class Item(BaseModel):
    id: str
    type: str = Field(pattern=ITEM_TYPES)
    title: str
    ref: str | None = None
    refs: list[str] = []


class Module(BaseModel):
    id: str
    title: str
    summary: str = ""
    items: list[Item]


class Week(BaseModel):
    id: str
    number: int
    title: str
    goal: str
    due: str
    kickoff: str = ""
    learn: list[str] = []
    pass_percent: int = Field(default=80, ge=1, le=100)
    modules: list[Module]
    concepts: list[Concept]
    resources: list[ResourceGroup]
    projects: list[Project]
    quiz: list[QuizQuestion]
    voice_quiz: list[VoicePrompt]
    illustrations: list[Illustration]

    @model_validator(mode="after")
    def _references_resolve(self):
        concept_ids = {c.id for c in self.concepts}
        for q in [*self.quiz, *self.voice_quiz]:
            if q.concept not in concept_ids:
                raise ValueError(f"{q.id}: unknown concept {q.concept!r}")
        ids = [q.id for q in self.quiz] + [v.id for v in self.voice_quiz]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate quiz ids")

        known = {
            "lesson": concept_ids,
            "reading": {g.group for g in self.resources},
            "project": {p.id for p in self.projects},
        }
        many = {"practice": {q.id for q in self.quiz}, "quiz": {q.id for q in self.quiz},
                "voice": {v.id for v in self.voice_quiz}}
        seen = set()
        for item in self.items():
            if item.id in seen:
                raise ValueError(f"duplicate item id {item.id!r}")
            seen.add(item.id)
            if item.type in known and item.ref not in known[item.type]:
                raise ValueError(f"{item.id}: unknown {item.type} {item.ref!r}")
            if item.type in many and (not item.refs or not set(item.refs) <= many[item.type]):
                raise ValueError(f"{item.id}: bad refs {item.refs}")
        return self

    def items(self) -> list[Item]:
        return [i for m in self.modules for i in m.items]

    def item(self, item_id: str) -> Item | None:
        return next((i for i in self.items() if i.id == item_id), None)

    def public(self) -> dict:
        """The week as sent to the browser: quiz answers and explanations removed."""
        data = self.model_dump()
        data["quiz"] = [
            {"id": q.id, "concept": q.concept, "question": q.question, "options": q.options}
            for q in self.quiz
        ]
        return data


class OutlineWeek(BaseModel):
    number: int
    id: str | None = None
    title: str
    focus: str
    build: str


class Course(BaseModel):
    title: str
    subtitle: str
    weeks: list[OutlineWeek]


@lru_cache
def load_course() -> Course:
    path = get_settings().content_dir / "course.json"
    course = Course.model_validate(json.loads(path.read_text(encoding="utf-8")))
    weeks = load_weeks()
    for w in course.weeks:
        if w.id is not None and w.id not in weeks:
            raise ValueError(f"course.json points to missing week {w.id!r}")
    return course


@lru_cache
def load_weeks() -> dict[str, Week]:
    weeks: dict[str, Week] = {}
    for path in sorted(get_settings().content_dir.glob("week-*.json")):
        week = Week.model_validate(json.loads(path.read_text(encoding="utf-8")))
        weeks[week.id] = week
    return weeks
