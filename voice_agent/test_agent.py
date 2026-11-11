"""Offline checks for the parts of the worker that don't need LiveKit."""
from agent import build_instructions, load_week


def test_instructions_include_every_prompt():
    week = load_week("week-01-02")
    text = build_instructions(week, week["voice_quiz"][:3])
    for p in week["voice_quiz"][:3]:
        assert p["prompt"] in text
    assert "record_score" in text
