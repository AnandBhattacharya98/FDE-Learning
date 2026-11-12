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
