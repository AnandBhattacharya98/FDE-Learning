"""Voice-quiz coach: a LiveKit agent that asks a week's voice-quiz prompts and scores the answers.

The same worker also runs "Ask the coach" by voice: when the room metadata has mode "coach",
it answers the learner's questions, looking them up in the course through the API.

Run locally:   python agent.py dev
When the coach scores the learner, and again when the call closes, the worker posts a
scorecard (per-question result, missed points and the transcript) to the API.
The backend's token endpoint dispatches this agent (agent_name "fde-voice-quiz") into the
learner's room and puts {"week_id", "user_id"} in the room metadata.
"""
import json
import logging
import os
import random
from pathlib import Path

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel
from livekit.agents import Agent, AgentSession, JobContext, RunContext, WorkerOptions, cli, function_tool
from livekit.plugins import silero

load_dotenv()
log = logging.getLogger("fde-voice-quiz")

CONTENT_DIR = Path(os.getenv("CONTENT_DIR") or Path(__file__).resolve().parents[1] / "content")
QUESTIONS_PER_CALL = 3

STT_MODEL = os.getenv("STT_MODEL") or "assemblyai/universal-streaming:en"
LLM_MODEL = os.getenv("LLM_MODEL") or "openai/gpt-4.1-mini"
TTS_MODEL = os.getenv("TTS_MODEL") or "cartesia/sonic-2"


def load_week(week_id: str) -> dict:
    for path in CONTENT_DIR.glob("week-*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["id"] == week_id:
            return data
    raise ValueError(f"No content for {week_id}")


def build_instructions(week: dict, prompts: list[dict]) -> str:
    lines = [
        "You are a friendly, encouraging coach for new Forward Deployed Engineers at RevRag.",
        f"Topic: {week['title']}.",
        "You are on a voice call, so keep every turn short and plain: no lists, no markdown, no emoji.",
        f"Ask these {len(prompts)} questions one at a time, in order. After each answer, say in one or two sentences",
        "what they got right and the most important thing they missed, then move on. Don't lecture.",
        "If they ask you to repeat or rephrase, do. If they say they don't know, give a one-line hint and let them try once more.",
        "",
    ]
    for i, p in enumerate(prompts, 1):
        lines.append(f"Question {i} (id {p['id']}): {p['prompt']}")
        lines.append(f"  A good answer covers: {'; '.join(p['look_for'])}.")
    lines += [
        "",
        "An answer is correct if it covers most of the points, otherwise it isn't.",
        "After the last question, call record_score once with one result per question id: whether it was correct,",
        "a one-line note, and the listed points they missed (copied from the list above).",
        "Then tell them their score, name the topic to review if they missed any, wish them luck, and say goodbye.",
    ]
    return "\n".join(lines)


class AnswerResult(BaseModel):
    question_id: str
    correct: bool
    note: str
    missed: list[str] = []


def transcript_turn(role: str, text: str | None) -> dict | None:
    """A chat item as a scorecard transcript line, or None for anything that isn't speech."""
    who = {"assistant": "coach", "user": "learner"}.get(role)
    text = " ".join((text or "").split())
    return {"role": who, "text": text} if who and text else None


def call_body(call_id: str, user_id: int, week_id: str, prompts: list[dict], transcript: list[dict],
              results: list[AnswerResult] | None) -> dict:
    """What the API's /internal/voice-quiz/calls expects. results=None means not scored yet."""
    by_id = {r.question_id: r for r in results or []}
    questions = []
    for p in prompts:
        r = by_id.get(p["id"])
        questions.append({"id": p["id"], "correct": r.correct if r else (False if results is not None else None),
                          "note": r.note if r else "", "missed": r.missed if r else []})
    return {"call_id": call_id, "user_id": user_id, "week_id": week_id, "complete": results is not None,
            "questions": questions, "transcript": list(transcript)}


async def post_call(body: dict) -> bool:
    api_url = (os.getenv("API_URL") or "").rstrip("/")
    key = os.getenv("VOICE_WORKER_KEY") or ""
    if not api_url or not key:
        log.warning("API_URL or VOICE_WORKER_KEY not set; scorecard not saved")
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{api_url}/api/fde/internal/voice-quiz/calls", json=body,
                                  headers={"x-worker-key": key})
            r.raise_for_status()
    except httpx.HTTPError as e:
        log.error("saving scorecard failed: %s", e)
        return False
    return True


class QuizCoach(Agent):
    def __init__(self, week: dict, user_id: int, prompts: list[dict], call_id: str, transcript: list[dict]):
        super().__init__(instructions=build_instructions(week, prompts))
        self.week_id = week["id"]
        self.user_id = user_id
        self.prompts = prompts
        self.call_id = call_id
        self.transcript = transcript
        self.results: list[AnswerResult] | None = None

    async def on_enter(self):
        self.session.generate_reply(
            instructions="Greet the learner in one sentence, say you'll ask a few quick questions out loud, then ask question 1."
        )

    def body(self) -> dict:
        return call_body(self.call_id, self.user_id, self.week_id, self.prompts, self.transcript, self.results)

    @function_tool
    async def record_score(self, context: RunContext, results: list[AnswerResult]) -> str:
        """Save the learner's voice-quiz scorecard. Call once, after the last question.

        Args:
            results: One entry per question id: whether the answer was correct, a one-line note,
                and the points from the list that they missed.
        """
        if self.results is not None:
            return "Already saved."
        self.results = results
        score = sum(r.correct for r in results)
        if not await post_call(self.body()):
            return f"Couldn't save the scorecard, but carry on and tell them they got {score} of {len(self.prompts)}."
        return f"Saved. They got {score} of {len(self.prompts)}."


COACH_INSTRUCTIONS = """You are the FDE Coach for new Forward Deployed Engineers at RevRag, on a voice call.
Answer the learner's questions about the course. Before answering anything about the course, call
search_course with their question and answer only from what it returns. If it returns nothing useful,
say the course doesn't cover it and suggest asking their FDE lead.
Keep every turn short and plain: two to four sentences, no lists, no markdown, no emoji, no links read out.
Never give the answer to a graded quiz question; explain the idea instead.
For project help, give the next step and a hint rather than the whole solution."""


class CourseCoach(Agent):
    def __init__(self, week_id: str | None, user_id: int):
        super().__init__(instructions=COACH_INSTRUCTIONS)
        self.week_id = week_id
        self.user_id = user_id

    async def on_enter(self):
        self.session.generate_reply(
            instructions="Say hi in one short sentence and ask what they'd like help with from the course."
        )

    @function_tool
    async def search_course(self, context: RunContext, question: str) -> str:
        """Look up the course content for a learner's question.

        Args:
            question: The learner's question, in their words.
        """
        api_url = (os.getenv("API_URL") or "").rstrip("/")
        key = os.getenv("VOICE_WORKER_KEY") or ""
        if not api_url or not key:
            return "The course search isn't connected. Say you can't look it up right now."
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(f"{api_url}/api/fde/coach/internal/search",
                                      json={"query": question, "week_id": self.week_id, "user_id": self.user_id},
                                      headers={"x-worker-key": key})
                r.raise_for_status()
        except httpx.HTTPError as e:
            log.error("course search failed: %s", e)
            return "The course search failed. Say you can't look it up right now."
        return format_passages(r.json().get("passages", []))


def format_passages(passages: list[dict]) -> str:
    if not passages:
        return "Nothing in the course matches."
    return "\n\n".join(f"{p['week']} · {p['title']}: {p['text']}" for p in passages)


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    transcript: list[dict] = []
    meta = json.loads(ctx.room.metadata or "{}")
    if meta.get("mode") == "coach":
        session = AgentSession(stt=STT_MODEL, llm=LLM_MODEL, tts=TTS_MODEL, vad=silero.VAD.load())
        await session.start(agent=CourseCoach(meta.get("week_id"), int(meta["user_id"])), room=ctx.room)
        return
    week = load_week(meta["week_id"])
    prompts = random.sample(week["voice_quiz"], k=min(QUESTIONS_PER_CALL, len(week["voice_quiz"])))

    session = AgentSession(
        stt=STT_MODEL,
        llm=LLM_MODEL,
        tts=TTS_MODEL,
        vad=silero.VAD.load(),
    )
    coach = QuizCoach(week, int(meta["user_id"]), prompts, call_id=ctx.job.id, transcript=transcript)

    @session.on("conversation_item_added")
    def _on_item(ev):
        turn = transcript_turn(getattr(ev.item, "role", ""), getattr(ev.item, "text_content", None))
        if turn:
            transcript.append(turn)

    async def _save_transcript():
        # Runs when the call closes: saves the full transcript, or an unscored card if they hung up early.
        await post_call(coach.body())

    ctx.add_shutdown_callback(_save_transcript)
    await session.start(agent=coach, room=ctx.room)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="fde-voice-quiz"))
