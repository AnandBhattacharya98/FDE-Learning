import uuid

from app.config import get_settings
from app.content import load_weeks
from app.security import create_token

CALLS = "/api/fde/internal/voice-quiz/calls"
KEY = {"x-worker-key": "test-worker-key"}


def _signup(client, name="Learner"):
    r = client.post("/api/fde/auth/signup", json={"email": f"{uuid.uuid4().hex[:8]}@example.com",
                                                  "name": name, "password": "correct horse"})
    body = r.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]


def _call(user_id, *, complete=True, correct=(True, False, True), transcript=None, call_id=None, week="week-01"):
    prompts = load_weeks()[week].voice_quiz[:len(correct)]
    return {
        "call_id": call_id or uuid.uuid4().hex, "user_id": user_id, "week_id": week, "complete": complete,
        "questions": [{"id": p.id, "correct": c, "note": f"note {p.id}", "missed": [] if c else [p.look_for[0]]}
                      for p, c in zip(prompts, correct)],
        "transcript": transcript if transcript is not None else [
            {"role": "coach", "text": "Hi! First question."}, {"role": "learner", "text": "  The waiter is the API. "}],
    }


def test_worker_key_and_validation(client, auth):
    _, user = auth
    body = _call(user["id"])
    assert client.post(CALLS, json=body).status_code == 401
    assert client.post(CALLS, json=body, headers={"x-worker-key": "nope"}).status_code == 401
    bad = {**body, "questions": [{"id": "nope", "correct": True}]}
    assert client.post(CALLS, json=bad, headers=KEY).status_code == 422
    assert client.post(CALLS, json={**body, "user_id": 999999}, headers=KEY).status_code == 404
    assert client.post(CALLS, json={**body, "week_id": "week-99"}, headers=KEY).status_code == 404


def test_scorecard_shows_score_weak_topics_and_transcript(client):
    headers, user = _signup(client)
    r = client.post(CALLS, json=_call(user["id"]), headers=KEY)
    assert r.status_code == 201 and r.json()["score"] == 2 and r.json()["total"] == 3

    cards = client.get("/api/fde/weeks/week-01/voice-quiz/scorecards", headers=headers).json()["scorecards"]
    assert len(cards) == 1
    card = cards[0]
    week = load_weeks()["week-01"]
    missed = week.voice_quiz[1]
    title = next(c.title for c in week.concepts if c.id == missed.concept)
    assert card["complete"] and card["weak_topics"] == [title]
    assert card["questions"][1]["correct"] is False and card["questions"][1]["missed"] == [missed.look_for[0]]
    assert card["questions"][0]["prompt"] == week.voice_quiz[0].prompt
    assert card["transcript"][1] == {"role": "learner", "text": "The waiter is the API."}

    # The scored call also counts as a voice attempt, so the course item and best score update.
    prog = client.get("/api/fde/weeks/week-01/progress", headers=headers).json()
    assert prog["voice_quiz"] == {"best": {"score": 2, "total": 3}, "attempts": 1}

    # Other learners can't see it.
    other, _ = _signup(client)
    assert client.get("/api/fde/weeks/week-01/voice-quiz/scorecards", headers=other).json()["scorecards"] == []


def test_end_of_call_post_adds_transcript_without_downgrading(client):
    headers, user = _signup(client)
    body = _call(user["id"])
    client.post(CALLS, json=body, headers=KEY)
    longer = body["transcript"] + [{"role": "coach", "text": "You got 2 of 3. Good luck!"}]
    end = {**body, "complete": False, "transcript": longer}
    r = client.post(CALLS, json=end, headers=KEY).json()
    assert (r["complete"], r["score"], r["total"]) == (True, 2, 3)
    card = client.get("/api/fde/weeks/week-01/voice-quiz/scorecards", headers=headers).json()["scorecards"][0]
    assert card["complete"] and len(card["transcript"]) == 3
    assert client.get("/api/fde/weeks/week-01/progress", headers=headers).json()["voice_quiz"]["attempts"] == 1


def test_call_ended_early_keeps_transcript_but_doesnt_count(client):
    headers, user = _signup(client)
    client.post(CALLS, json=_call(user["id"], complete=False, correct=(None,)), headers=KEY)
    card = client.get("/api/fde/weeks/week-01/voice-quiz/scorecards", headers=headers).json()["scorecards"][0]
    assert not card["complete"] and card["score"] == 0 and card["questions"][0]["correct"] is None
    assert card["transcript"]
    assert client.get("/api/fde/weeks/week-01/progress", headers=headers).json()["voice_quiz"]["attempts"] == 0
    board = client.get("/api/fde/voice-quiz/leaderboard", headers=headers).json()["entries"]
    assert not any(e["you"] for e in board)


def test_call_id_cannot_be_reused_by_another_learner(client):
    _, a = _signup(client)
    _, b = _signup(client)
    body = _call(a["id"])
    client.post(CALLS, json=body, headers=KEY)
    assert client.post(CALLS, json={**body, "user_id": b["id"]}, headers=KEY).status_code == 409


def test_leaderboard_ranks_best_call_per_week(client):
    ha, a = _signup(client, "Ana")
    _, b = _signup(client, "Ben")
    client.post(CALLS, json=_call(a["id"], correct=(False, False, True)), headers=KEY)
    client.post(CALLS, json=_call(a["id"], correct=(True, True, True)), headers=KEY)  # Ana's best: 3/3
    client.post(CALLS, json=_call(b["id"], correct=(True, True, False)), headers=KEY)

    week = client.get("/api/fde/voice-quiz/leaderboard?week_id=week-01", headers=ha).json()["entries"]
    mine = {e["name"]: e for e in week if e["name"] in ("Ana", "Ben")}
    assert mine["Ana"]["percent"] == 100 and mine["Ana"]["calls"] == 2 and mine["Ana"]["you"]
    assert mine["Ana"]["rank"] < mine["Ben"]["rank"] and not mine["Ben"]["you"]
    assert [e["rank"] for e in week] == list(range(1, len(week) + 1))

    # Course-wide: a second week adds to the total.
    client.post(CALLS, json=_call(b["id"], correct=(True, True), week="week-02"), headers=KEY)
    course = client.get("/api/fde/voice-quiz/leaderboard", headers=ha).json()["entries"]
    ben = next(e for e in course if e["name"] == "Ben")
    assert ben["weeks"] == 2 and (ben["score"], ben["total"]) == (4, 5)
    assert client.get("/api/fde/voice-quiz/leaderboard").status_code == 401
    assert client.get("/api/fde/voice-quiz/leaderboard?week_id=week-99", headers=ha).status_code == 404


def test_admin_scorecards_and_summary(client, monkeypatch):
    from app.db import SessionLocal
    from app.voice import voice_summary

    headers, user = _signup(client, "Cara")
    client.post(CALLS, json=_call(user["id"], correct=(False, False, True)), headers=KEY)
    assert client.get("/api/fde/admin/voice-scorecards", headers=headers).status_code == 404

    email = f"boss-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setattr(get_settings(), "admin_emails", {email})
    r = client.post("/api/fde/auth/signup", json={"email": email, "name": "Boss", "password": "correct horse"})
    google = {"Authorization": f"Bearer {create_token(r.json()['user']['id'], via='google')}"}
    cards = client.get(f"/api/fde/admin/voice-scorecards?user_id={user['id']}", headers=google).json()["scorecards"]
    assert [c["name"] for c in cards] == ["Cara"] and cards[0]["transcript"]

    with SessionLocal() as db:
        summary = voice_summary(db, [user["id"]])
    assert summary[user["id"]]["latest"]["score"] == 1 and summary[user["id"]]["calls"] == 1
    assert len(summary[user["id"]]["weak_topics"]) == 2
