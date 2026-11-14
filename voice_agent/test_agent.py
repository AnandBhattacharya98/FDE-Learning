"""Offline checks for the parts of the worker that don't need LiveKit."""
from agent import build_instructions, load_week
from coach_voice import format_passages


def test_instructions_include_every_prompt():
    week = load_week("week-01")
    text = build_instructions(week, week["voice_quiz"][:3])
    for p in week["voice_quiz"][:3]:
        assert p["prompt"] in text
    assert "record_score" in text


def test_coach_passages_are_read_as_plain_text():
    assert format_passages([]) == "Nothing in the course matches."
    text = format_passages([{"week": "Week 1: Basics", "title": "APIs", "text": "The waiter is the API."}])
    assert text == "[1] Week 1: Basics · APIs: The waiter is the API."

def test_transcript_turn_keeps_only_speech():
    from agent import transcript_turn

    assert transcript_turn("assistant", " Hi  there ") == {"role": "coach", "text": "Hi there"}
    assert transcript_turn("user", "the waiter") == {"role": "learner", "text": "the waiter"}
    assert transcript_turn("system", "secret prompt") is None
    assert transcript_turn("user", "   ") is None


def test_call_body_before_and_after_scoring():
    from agent import AnswerResult, call_body

    prompts = load_week("week-01")["voice_quiz"][:2]
    ids = [p["id"] for p in prompts]
    early = call_body("job1", 7, "week-01", prompts, [{"role": "coach", "text": "Hi"}], None)
    assert early["complete"] is False and [q["correct"] for q in early["questions"]] == [None, None]

    results = [AnswerResult(question_id=ids[0], correct=True, note="good")]
    done = call_body("job1", 7, "week-01", prompts, [], results)
    assert done["complete"] is True
    assert [q["correct"] for q in done["questions"]] == [True, False]  # an unscored question counts as missed
    assert done["questions"][0]["note"] == "good"


def test_load_week_falls_back_to_the_api(monkeypatch, tmp_path):
    import agent

    calls = []

    class Reply:
        def raise_for_status(self):
            pass

        def json(self):
            return {"id": "week-01", "title": "From the API", "voice_quiz": []}

    def fake_get(url, timeout):
        calls.append(url)
        return Reply()

    monkeypatch.setattr(agent, "CONTENT_DIR", tmp_path / "missing")
    monkeypatch.setattr(agent.httpx, "get", fake_get)
    monkeypatch.setenv("API_URL", "https://api.example.com/")
    assert agent.load_week("week-01")["title"] == "From the API"
    assert calls == ["https://api.example.com/api/fde/weeks/week-01"]


def test_call_metadata_prefers_the_first_non_empty_source():
    from agent import call_metadata

    assert call_metadata("", None, '{"mode": "coach", "user_id": 1}') == {"mode": "coach", "user_id": 1}
    assert call_metadata('{"week_id": "week-01", "user_id": 2}', "{}", "") == {"week_id": "week-01", "user_id": 2}
    assert call_metadata("not json", "", None) == {}


def test_coach_helpers():
    from coach_voice import instructions, looks_english, refs_message, speech_models

    assert looks_english("what is a webhook?") and not looks_english("वेबहुक क्या है")
    msg = refs_message([{"title": "APIs", "week": "Week 1", "path": "/weeks/week-01/lesson-api", "kind": "lesson", "text": "x"}])
    assert msg == {"type": "refs", "refs": [{"n": 1, "title": "APIs", "week": "Week 1", "path": "/weeks/week-01/lesson-api", "kind": "lesson"}]}
    assert speech_models("en", "stt-default", "tts-default") == ("stt-default", "tts-default")
    assert "Hindi" in instructions("hi") and "open_reference" in instructions("en")


def test_coach_search_sends_refs_and_open_reference_navigates(monkeypatch):
    import asyncio

    import coach_voice

    sent = []

    async def send(msg):
        sent.append(msg)

    class Reply:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"passages": [{"title": "APIs", "week": "Week 1", "path": "/weeks/week-01/lesson-api",
                                  "kind": "lesson", "text": "The waiter is the API."}]}

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def post(self, url, json, headers):
            assert url.endswith("/api/fde/coach/internal/search") and headers["x-worker-key"] == "k"
            return Reply()

    monkeypatch.setenv("API_URL", "https://api.example.com")
    monkeypatch.setenv("VOICE_WORKER_KEY", "k")
    monkeypatch.setattr(coach_voice.httpx, "AsyncClient", Client)
    coach = coach_voice.CourseCoach("week-01", 1, "en", send=send)

    async def run():
        out = await coach.search_course._func(coach, None, "what is an api")  # noqa: SLF001
        assert "[1] Week 1 · APIs" in out
        await coach.open_reference._func(coach, None, 1)  # noqa: SLF001

    asyncio.run(run())
    assert sent[0]["type"] == "refs" and sent[1] == {"type": "navigate", "path": "/weeks/week-01/lesson-api", "title": "APIs"}
