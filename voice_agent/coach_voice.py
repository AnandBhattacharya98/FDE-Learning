"""The voice side of "Ask the coach": answers questions from the course over a LiveKit call.

What the browser gets, as JSON text messages on topic "fde.coach":
  {"type": "turn", "role": "user"|"coach", "text": ...}   every finished line, for the transcript
  {"type": "refs", "refs": [{"n", "title", "week", "path", "kind"}]}   the passages behind an answer
  {"type": "navigate", "path": ..., "title": ...}   when the learner asks to be taken to one
  {"type": "status", "text": ...}   problems worth showing (e.g. the course search is down)

Course content comes from the API (POST /api/fde/coach/internal/search), the same index the chat
uses, including teacher materials. Each English question is looked up automatically before the
LLM answers; for other languages the LLM looks it up in English with the search_course tool.
"""
import asyncio
import json
import logging
import os

import httpx
from livekit.agents import Agent, RunContext, function_tool, inference, llm

log = logging.getLogger("fde-voice-coach")
TOPIC = "fde.coach"
SEARCH_TIMEOUT = 40  # Render's free plan can take ~30s to wake up

LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "ta": "Tamil", "te": "Telugu", "kn": "Kannada",
    "ml": "Malayalam", "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati",
}


SARVAM_SPEAKER = os.getenv("SARVAM_SPEAKER") or "priya"  # a bulbul:v3 voice; all of them speak every language


def speech_models(language: str, stt_default, tts_default):
    """(stt, tts) for a language. English keeps the worker's defaults. For Indian languages LiveKit
    recommends Sarvam (native speech recognition and voices for each language); it's used when
    SARVAM_API_KEY is set on the worker. Without it, LiveKit Inference picks a speech-to-text
    model for the language and Cartesia Sonic 3 speaks it."""
    if language == "en" or language not in LANGUAGE_NAMES:
        return stt_default, tts_default
    if os.getenv("SARVAM_API_KEY"):
        from livekit.plugins import sarvam
        code = f"{language}-IN"
        return (sarvam.STT(language=code),
                sarvam.TTS(target_language_code=code, model="bulbul:v3", speaker=SARVAM_SPEAKER))
    stt = inference.STT(model="auto", language=language, fallback="cartesia/ink-whisper")
    tts = inference.TTS(model="cartesia/sonic-3", language=language)
    return stt, tts


def instructions(language: str) -> str:
    name = LANGUAGE_NAMES.get(language, "English")
    lang_rule = ("Speak English." if name == "English" else
                 f"Speak {name} throughout (the learner chose it). Keep technical terms like API, webhook, "
                 f"React or LiveKit in English. When you call search_course, write the query in English.")
    return f"""You are the FDE Coach for new Forward Deployed Engineers at RevRag, on a voice call.
{lang_rule}
Answer questions about the course using the course passages you are given. Course passages arrive
in the conversation as a message starting "Course passages", numbered [1], [2]. If none are given
for a question, or they don't fit, call search_course with a short English query before answering.
Only say the course doesn't cover something after a search found nothing useful; then give your
best short pointer and suggest asking their FDE lead.
Keep every turn short and plain: two to four sentences, no lists, no markdown, no emoji, never read
out links or numbers in brackets. The learner sees the references on screen, so you can say
"there's a lesson on this, it's on your screen".
If the learner asks to open, see, or go to a lesson or reference, call open_reference with its number
(the first one if they don't say which).
You can also see and move around the page the learner has open. When they ask about "this page",
what's on screen, or something they're looking at, call read_screen first. To move the page, call
scroll_page. To open a link, tab or button they name, call click_on_screen with its label as shown by
read_screen. You can open links and lessons and mark a reading item complete, but you never choose
quiz answers or submit anything; tell them to do that themselves.
If a request is unclear (which lesson, which button, what they mean), ask one short question before
acting. When it helps, end with a short question to check they understood or to offer the next step.
Never give the answer to a graded quiz question; explain the idea instead.
For project help, give the next step and a hint rather than the whole solution."""


def format_passages(passages: list[dict]) -> str:
    if not passages:
        return "Nothing in the course matches."
    return "\n\n".join(f"[{i}] {p['week']} · {p['title']}: {p['text']}" for i, p in enumerate(passages, 1))


def refs_message(passages: list[dict]) -> dict:
    return {"type": "refs", "refs": [
        {"n": i, "title": p["title"], "week": p.get("week", ""), "path": p.get("path", ""), "kind": p.get("kind", "")}
        for i, p in enumerate(passages, 1)]}


def search_problem(e: Exception) -> str:
    """A line for the transcript saying why the course search failed, so it can be fixed."""
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        if code == 401:
            return "Course search refused the worker key (401): VOICE_WORKER_KEY on LiveKit Cloud must match Render."
        if code == 404:
            return "Course search not found (404): check API_URL on LiveKit Cloud is https://fde-learnings.onrender.com."
        return f"Course search failed on the server ({code}). Try again in a moment."
    if isinstance(e, httpx.TimeoutException):
        return "The course server is waking up. Try again in a moment."
    return f"Couldn't reach the course server ({type(e).__name__}): check API_URL on LiveKit Cloud."


def looks_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(c.isascii() for c in letters) / len(letters) > 0.8


class CourseCoach(Agent):
    def __init__(self, week_id: str | None, user_id: int, language: str = "en", send=None, screen=None):
        super().__init__(instructions=instructions(language))
        self.week_id = week_id
        self.user_id = user_id
        self.language = language
        self.refs: list[dict] = []
        self._send = send  # async callable(dict) -> None, posts a message to the browser
        self._screen = screen  # async callable(method, dict) -> dict, runs a screen action in the browser

    async def emit(self, message: dict) -> None:
        if self._send:
            try:
                await self._send(message)
            except Exception as e:  # the call goes on even if the browser misses a message
                log.warning("couldn't send %s to the browser: %s", message.get("type"), e)

    async def search(self, query: str) -> list[dict] | None:
        """Top course passages for a query, or None if the API can't be reached."""
        api_url = (os.getenv("API_URL") or "").rstrip("/")
        key = (os.getenv("VOICE_WORKER_KEY") or "").strip()
        if not api_url or not key:
            log.error("API_URL or VOICE_WORKER_KEY isn't set on the worker; the coach can't search the course")
            await self.emit({"type": "status", "text": "The coach can't reach the course right now."})
            return None
        try:
            async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
                r = await client.post(f"{api_url}/api/fde/coach/internal/search",
                                      json={"query": query, "week_id": self.week_id, "user_id": self.user_id},
                                      headers={"x-worker-key": key})
                r.raise_for_status()
        except httpx.HTTPError as e:
            log.error("course search failed (%s): %r", api_url, e)
            await self.emit({"type": "status", "text": search_problem(e)})
            return None
        passages = r.json().get("passages", [])
        log.info("search %r -> %d passages", query[:80], len(passages))
        if passages:
            self.refs = passages
            await self.emit(refs_message(passages))
        return passages

    async def warm_up(self) -> None:
        """Wake the API (Render's free plan sleeps) so the first question doesn't time out."""
        api_url = (os.getenv("API_URL") or "").rstrip("/")
        key = (os.getenv("VOICE_WORKER_KEY") or "").strip()
        if not api_url or not key:
            log.error("API_URL or VOICE_WORKER_KEY isn't set on the worker")
            return
        try:
            async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
                r = await client.get(f"{api_url}/api/fde/coach/internal/ping", headers={"x-worker-key": key})
            if r.status_code == 401:
                log.error("the API refused VOICE_WORKER_KEY: it must match the value on Render")
            else:
                log.info("API reachable (%s)", r.status_code)
        except httpx.HTTPError as e:
            log.error("API not reachable at %s: %r", api_url, e)

    async def on_enter(self):
        asyncio.create_task(self.warm_up())
        self.session.generate_reply(
            instructions="Say hi in one short sentence and ask what they'd like help with from the course."
        )

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        text = (new_message.text_content or "").strip()
        if len(text) < 4 or not looks_english(text):
            return  # too short to search, or not English: the LLM searches in English itself
        passages = await self.search(text)
        if passages:
            turn_ctx.add_message(role="assistant", content="Course passages for this question:\n\n" + format_passages(passages))

    @function_tool
    async def search_course(self, context: RunContext, query: str) -> str:
        """Look up the course (lessons, readings, projects, teacher materials) for the learner's question.

        Args:
            query: A short search in English, e.g. "what is a webhook" or "deploy P1 to Render".
        """
        passages = await self.search(query)
        if passages is None:
            return "The course search isn't available right now. Say so briefly and offer to try again."
        return "Course passages:\n\n" + format_passages(passages)

    @function_tool
    async def open_reference(self, context: RunContext, number: int = 1) -> str:
        """Open one of the references on the learner's screen, when they ask to see or go to it.

        Args:
            number: The reference number, starting at 1.
        """
        if not self.refs:
            return "There are no references on screen yet. Search the course first."
        ref = self.refs[max(1, min(number, len(self.refs))) - 1]
        await self.emit({"type": "navigate", "path": ref.get("path", ""), "title": ref["title"]})
        return f"Opened \"{ref['title']}\" on their screen. Tell them briefly."


    async def screen(self, method: str, args: dict | None = None) -> dict:
        if not self._screen:
            return {"error": "The learner's screen isn't connected."}
        try:
            return await self._screen(method, args or {})
        except Exception as e:  # browser gone, old page version, timeout
            log.warning("screen %s failed: %r", method, e)
            return {"error": "Couldn't reach the learner's screen."}

    @function_tool
    async def read_screen(self, context: RunContext) -> str:
        """Read what the learner has on screen: the page title, the visible text, and the links and
        buttons you can open for them."""
        r = await self.screen("screen.read")
        return json.dumps(r, ensure_ascii=False)[:6000]

    @function_tool
    async def scroll_page(self, context: RunContext, direction: str = "down") -> str:
        """Scroll the learner's page.

        Args:
            direction: "down", "up", "top" or "bottom".
        """
        r = await self.screen("screen.scroll", {"direction": direction})
        return json.dumps(r, ensure_ascii=False)[:3000]

    @function_tool
    async def click_on_screen(self, context: RunContext, label: str) -> str:
        """Open a link, tab or button on the learner's page, by its label from read_screen.
        Quiz answers and submit buttons are refused.

        Args:
            label: The text of the link or button, e.g. "Next" or "Week 2".
        """
        r = await self.screen("screen.click", {"label": label})
        return json.dumps(r, ensure_ascii=False)[:3000]


def wire_transcript(session, coach: CourseCoach) -> None:
    """Send every finished line of the conversation to the browser for the transcript."""

    @session.on("conversation_item_added")
    def _on_item(ev):
        item = ev.item
        role = getattr(item, "role", "")
        text = (getattr(item, "text_content", None) or "").strip()
        if role in ("user", "assistant") and text and not text.startswith("Course passages"):
            asyncio.create_task(coach.emit({"type": "turn", "role": "user" if role == "user" else "coach", "text": text}))


def browser_identity(room) -> str | None:
    """The learner's participant in the room (anyone who isn't an agent)."""
    from livekit import rtc
    for p in room.remote_participants.values():
        if p.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            return p.identity
    return None


def screen_caller(room):
    """Calls the screen actions the browser registers as LiveKit RPC methods (Coach.jsx)."""
    async def call(method: str, args: dict) -> dict:
        who = browser_identity(room)
        if not who:
            return {"error": "The learner isn't in the call."}
        raw = await room.local_participant.perform_rpc(destination_identity=who, method=method,
                                                       payload=json.dumps(args), response_timeout=8)
        return json.loads(raw or "{}")
    return call


def sender(room):
    async def send(message: dict) -> None:
        await room.local_participant.send_text(json.dumps(message), topic=TOPIC)
    return send
