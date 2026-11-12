"""Offline checks for the parts of the worker that don't need LiveKit."""
from agent import build_instructions, format_passages, load_week


def test_instructions_include_every_prompt():
    week = load_week("week-01")
    text = build_instructions(week, week["voice_quiz"][:3])
    for p in week["voice_quiz"][:3]:
        assert p["prompt"] in text
    assert "record_score" in text


def test_coach_passages_are_read_as_plain_text():
    assert format_passages([]) == "Nothing in the course matches."
    text = format_passages([{"week": "Week 1: Basics", "title": "APIs", "text": "The waiter is the API."}])
    assert text == "Week 1: Basics · APIs: The waiter is the API."

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
