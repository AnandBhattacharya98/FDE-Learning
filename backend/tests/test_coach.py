import httpx

from app import coach
from app.coach import get_index
from app.config import get_settings
from app.content import load_weeks

API = "/api/fde"


def test_index_covers_lessons_projects_and_skips_the_graded_quiz():
    index = get_index()
    kinds = {p.kind for p in index.passages}
    assert {"overview", "lesson", "reading", "project", "voice"} <= kinds
    quiz_explanations = [q.explanation for w in load_weeks().values() for q in w.quiz]
    blob = " ".join(p.text for p in index.passages)
    assert not any(e and e in blob for e in quiz_explanations)


def test_search_finds_the_right_lesson_and_links_to_it():
    hits = [p for _, p in get_index().search("what does the waiter do in the restaurant analogy?")]
    lesson = next(p for p in hits[:2] if p.kind == "lesson")
    assert lesson.item_id == "lesson-restaurant" and lesson.week_id == "week-01"


def test_every_source_points_at_a_real_course_page():
    weeks = load_weeks()
    for p in get_index().passages:
        assert p.item_id and weeks[p.week_id].item(p.item_id), p


def test_ask_needs_sign_in(client):
    assert client.post(f"{API}/coach/ask", json={"question": "What is an API?"}).status_code == 401


def test_ask_without_a_key_answers_from_the_course(client, auth):
    headers, _ = auth
    assert client.get(f"{API}/coach/status", headers=headers).json()["ai"] is False
    r = client.post(f"{API}/coach/ask", json={"question": "What is an API?", "week_id": "week-01"}, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "search" and body["sources"] and "[1]" in body["answer"]


def test_ask_with_a_key_uses_claude_with_course_passages(client, auth, monkeypatch):
    headers, _ = auth
    seen = {}

    def fake(question, history, hits):
        seen.update(question=question, history=history, hits=hits)
        return "An API is the waiter [1]."

    s = get_settings()
    monkeypatch.setattr(s, "anthropic_api_key", "test-key")
    monkeypatch.setattr(coach, "_ask_claude", fake)
    r = client.post(f"{API}/coach/ask", headers=headers, json={
        "question": "and what about the kitchen?",
        "history": [{"role": "user", "content": "What is an API?"}, {"role": "assistant", "content": "The waiter."}],
    }).json()
    assert r == {"answer": "An API is the waiter [1].", "mode": "ai", "sources": r["sources"]}
    assert len(seen["history"]) == 2 and seen["hits"]


def test_ask_falls_back_to_search_when_claude_fails(client, auth, monkeypatch):
    headers, _ = auth

    def broken(*_):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")
    monkeypatch.setattr(coach, "_ask_claude", broken)
    r = client.post(f"{API}/coach/ask", json={"question": "What is a database?"}, headers=headers).json()
    assert r["mode"] == "search" and r["sources"]


def test_hourly_limit(client, auth, monkeypatch):
    headers, _ = auth
    monkeypatch.setattr(get_settings(), "coach_hourly_limit", 2)
    for _ in range(2):
        assert client.post(f"{API}/coach/ask", json={"question": "What is JSON?"}, headers=headers).status_code == 200
    assert client.post(f"{API}/coach/ask", json={"question": "What is JSON?"}, headers=headers).status_code == 429


def test_voice_token_needs_livekit(client, auth):
    headers, _ = auth
    assert client.post(f"{API}/coach/voice/token", json={}, headers=headers).status_code == 503


def test_internal_search_needs_the_worker_key(client, auth):
    _, user = auth
    url = f"{API}/coach/internal/search"
    assert client.post(url, json={"query": "webhook"}).status_code == 401
    r = client.post(url, json={"query": "What is a webhook?", "user_id": user["id"]},
                    headers={"x-worker-key": "test-worker-key"})
    assert r.status_code == 200 and r.json()["passages"][0]["text"]
