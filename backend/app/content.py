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


class PaceWeek(BaseModel):
    week: int
    focus: str
    items: list[str]


class Week(BaseModel):
    id: str
    weeks: list[int]
    title: str
    goal: str
    due: str
    pace: list[PaceWeek] = []
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
        return self

    def public(self) -> dict:
        """The week as sent to the browser: quiz answers and explanations removed."""
        data = self.model_dump()
        data["quiz"] = [
            {"id": q.id, "concept": q.concept, "question": q.question, "options": q.options}
            for q in self.quiz
        ]
        return data


@lru_cache
def load_weeks() -> dict[str, Week]:
    weeks: dict[str, Week] = {}
    for path in sorted(get_settings().content_dir.glob("week-*.json")):
        week = Week.model_validate(json.loads(path.read_text(encoding="utf-8")))
        weeks[week.id] = week
    return weeks
