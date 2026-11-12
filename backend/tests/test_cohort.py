import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.config import get_settings
from app.db import SessionLocal
from app.models import QuizAttempt, User
from app.security import create_token

LEARNERS = "/api/fde/admin/learners"


def _signup(client, name="Learner"):
    r = client.post("/api/fde/auth/signup", json={"email": f"{uuid.uuid4().hex[:8]}@example.com",
                                                  "name": name, "password": "correct horse"})
    assert r.status_code == 201
    body = r.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]["id"]


@pytest.fixture
def google_admin(client, monkeypatch):
    email = f"boss-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setattr(get_settings(), "admin_emails", {email})
    r = client.post("/api/fde/auth/signup", json={"email": email, "name": "Boss", "password": "correct horse"})
    return {"Authorization": f"Bearer {create_token(r.json()['user']['id'], via='google')}"}


def _row(client, headers, uid):
    return next(r for r in client.get(LEARNERS, headers=headers).json()["learners"] if r["id"] == uid)


def test_only_google_admin_can_list_learners(client, auth, google_admin):
    headers, uid = auth
    assert client.get(LEARNERS).status_code == 401
    assert client.get(LEARNERS, headers=headers).status_code == 404
    assert client.get(f"{LEARNERS}/{uid['id']}", headers=headers).status_code == 404
    body = client.get(LEARNERS, headers=google_admin).json()
    assert body["summary"]["learners"] >= 2
    assert all("email" not in r for r in body["learners"])
    assert sum(r["is_you"] for r in body["learners"]) == 1


def test_progress_and_quiz_scores_show_up(client, google_admin):
    headers, uid = _signup(client, "Progressing")
    row = _row(client, google_admin, uid)
    assert row["state"] == "not_started" and row["percent"] == 0 and row["next_up"]["item_id"] == "overview"

    client.put("/api/fde/weeks/week-01/items/overview/complete", json={"done": True}, headers=headers)
    client.put("/api/fde/weeks/week-01/projects/P1/steps/0", json={"done": True}, headers=headers)
    client.post("/api/fde/weeks/week-01/items/graded-quiz/quiz", json={"answers": {}}, headers=headers)
    row = _row(client, google_admin, uid)
    assert row["state"] == "on_track" and row["done"] == 1 and row["last_active"]
    w1 = row["weeks"][0]
    assert w1["quiz"]["score"] == 0 and w1["quiz"]["attempts"] == 1 and not w1["quiz_passed"]
    assert w1["projects"][0]["steps_done"] == 1

    detail = client.get(f"{LEARNERS}/{uid}", headers=google_admin).json()
    assert detail["weeks"][0]["modules"][0]["items"][0]["done"] is True
    assert detail["attempts"][0]["item"] == "graded-quiz"
    assert client.get(f"{LEARNERS}/999999", headers=google_admin).status_code == 404


def test_stuck_flags(client, google_admin):
    headers, uid = _signup(client, "Stuck")
    for _ in range(2):
        client.post("/api/fde/weeks/week-01/items/graded-quiz/quiz", json={"answers": {}}, headers=headers)
    row = _row(client, google_admin, uid)
    assert row["state"] == "stuck" and [f["code"] for f in row["flags"]] == ["quiz_fails"]

    # Make every row look 5 days old: now they're inactive too.
    old = datetime.now(timezone.utc) - timedelta(days=5)
    with SessionLocal() as db:
        for q in db.query(QuizAttempt).filter_by(user_id=uid):
            q.created_at = old
        db.commit()
    codes = [f["code"] for f in _row(client, google_admin, uid)["flags"]]
    assert codes[0] == "inactive"

    _, idle = _signup(client, "Idle")
    with SessionLocal() as db:
        db.get(User, idle).created_at = old
        db.commit()
    row = _row(client, google_admin, idle)
    assert row["state"] == "stuck" and row["flags"][0]["code"] == "not_started"
    body = client.get(LEARNERS, headers=google_admin).json()
    assert body["learners"][0]["state"] == "stuck"  # stuck learners sort first


def test_extras_hook_merges_into_rows(client, google_admin, monkeypatch):
    from app import cohort

    _, uid = _signup(client, "Extra")
    monkeypatch.setitem(cohort.LEARNER_EXTRAS, "grades", lambda db, ids: {uid: {"P1": {"score": 8, "max": 10}}})
    assert _row(client, google_admin, uid)["grades"]["P1"]["score"] == 8


def test_voice_scorecards_show_on_rows(client, google_admin):
    from app.models_voice import VoiceScorecard

    _, uid = _signup(client, "Voicey")
    with SessionLocal() as db:
        db.add(VoiceScorecard(call_id=f"cohort-{uid}", user_id=uid, week_id="week-01", score=3, total=5, complete=True,
                              questions=[], weak_topics=["Status codes"], transcript=[]))
        db.commit()
    voice = _row(client, google_admin, uid)["voice"]
    assert voice["calls"] == 1 and voice["latest"]["score"] == 3 and voice["weak_topics"] == ["Status codes"]
    assert "grades" in _row(client, google_admin, uid)  # registered by grading.py
