"""Voice-quiz coach: a LiveKit agent that asks a week's voice-quiz prompts and scores the answers.

The same worker also runs "Ask the coach" by voice: when the room metadata has mode "coach",
it answers the learner's questions, looking them up in the course through the API.

Run locally:   python agent.py dev
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
        "Score each answer 1 if it covers most of the points, otherwise 0.",
        "After the last question, call record_score once with the total and a one-line note per question id,",
        "then tell them their score, wish them luck, and say goodbye.",
    ]
    return "\n".join(lines)


class QuizCoach(Agent):
    def __init__(self, week: dict, user_id: int, prompts: list[dict]):
        super().__init__(instructions=build_instructions(week, prompts))
        self.week_id = week["id"]
        self.user_id = user_id
        self.total = len(prompts)
        self.recorded = False

    async def on_enter(self):
        self.session.generate_reply(
            instructions="Greet the learner in one sentence, say you'll ask a few quick questions out loud, then ask question 1."
        )

    @function_tool
    async def record_score(self, context: RunContext, score: int, notes: dict[str, str]) -> str:
        """Save the learner's voice-quiz result. Call once, after the last question.

        Args:
            score: How many questions they answered well.
            notes: One short note per question id about what they covered or missed.
        """
        if self.recorded:
            return "Already saved."
        api_url = (os.getenv("API_URL") or "").rstrip("/")
        key = os.getenv("VOICE_WORKER_KEY") or ""
        if not api_url or not key:
            log.warning("API_URL or VOICE_WORKER_KEY not set; score not saved")
            return "Couldn't save the score, but carry on and tell them their score."
        body = {"user_id": self.user_id, "score": max(0, min(score, self.total)), "total": self.total, "notes": notes}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    f"{api_url}/api/fde/internal/weeks/{self.week_id}/voice-quiz/result",
                    json=body,
                    headers={"x-worker-key": key},
                )
                r.raise_for_status()
        except httpx.HTTPError as e:
            log.error("saving score failed: %s", e)
            return "Couldn't save the score, but carry on and tell them their score."
        self.recorded = True
        return "Saved."


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
    await session.start(agent=QuizCoach(week, int(meta["user_id"]), prompts), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="fde-voice-quiz"))
