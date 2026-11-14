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


def test_published_teacher_materials_are_searchable(client, auth, monkeypatch):
    import io
    import uuid

    from app.security import create_token

    r = client.post(f"{API}/auth/signup", json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "T", "password": "correct horse"})
    uid, email = r.json()["user"]["id"], r.json()["user"]["email"]
    monkeypatch.setattr(get_settings(), "teacher_emails", {email})
    teacher = {"Authorization": f"Bearer {create_token(uid, via='google')}"}
    text = b"Zebracorn retries: every webhook delivery carries an idempotency key so retries are safe."
    m = client.post(f"{API}/teacher/materials", headers=teacher,
                    data={"week_id": "week-01", "module_id": "m1", "title": "Zebracorn deck"},
                    files={"file": ("deck.md", io.BytesIO(text), "text/markdown")}).json()
    headers, user = auth
    ask = lambda: client.post(f"{API}/coach/ask", json={"question": "zebracorn retries"}, headers=headers).json()  # noqa: E731
    assert not any(s["kind"] == "material" for s in ask()["sources"])  # drafts stay out

    client.patch(f"{API}/teacher/materials/{m['id']}", json={"published": True}, headers=teacher)
    src = ask()["sources"][0]
    assert src["kind"] == "material" and "Zebracorn deck" in src["title"]
    assert src["path"] == f"/weeks/week-01/{src['item_id']}#class-h"

    voice = client.post(f"{API}/coach/internal/search", json={"query": "zebracorn idempotency", "user_id": user["id"]},
                        headers={"x-worker-key": "test-worker-key"}).json()["passages"]
    assert voice[0]["kind"] == "material" and "idempotency" in voice[0]["text"]
    client.delete(f"{API}/teacher/materials/{m['id']}", headers=teacher)


def test_voice_token_languages_and_ping(client, auth):
    headers, _ = auth
    langs = client.get(f"{API}/coach/status", headers=headers).json()["languages"]
    assert {"en", "hi", "ta", "te", "kn"} <= {lang["code"] for lang in langs}
    assert client.get(f"{API}/coach/internal/ping").status_code == 401
    assert client.get(f"{API}/coach/internal/ping", headers={"x-worker-key": "test-worker-key"}).json() == {"ok": True}


def test_unicode_tokens():
    from app.coach import _tokens

    assert "वेबहुक" in _tokens("वेबहुक क्या है")


def test_worker_key_ignores_stray_whitespace(monkeypatch):
    from app.config import Settings
    monkeypatch.setenv("VOICE_WORKER_KEY", "abc123\n")
    assert Settings().voice_worker_key == "abc123"
