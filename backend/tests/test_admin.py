import uuid

import pytest

from app.config import get_settings
from app.models import User
from app.security import create_token

OVERVIEW = "/api/fde/admin/overview"


def _user(client, email):
    r = client.post("/api/fde/auth/signup", json={"email": email, "name": "Admin", "password": "correct horse"})
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def admin(client, monkeypatch):
    email = f"boss-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setattr(get_settings(), "admin_emails", {email})
    body = _user(client, email)
    google = {"Authorization": f"Bearer {create_token(body['user']['id'], via='google')}"}
    password = {"Authorization": f"Bearer {body['token']}"}
    return google, password


def test_no_token_and_ordinary_users_get_404(client, auth):
    assert client.get(OVERVIEW).status_code == 401
    headers, _ = auth
    assert client.get(OVERVIEW, headers=headers).status_code == 404
    assert "admin" not in client.get("/api/fde/me", headers=headers).json()


def test_admin_email_with_password_login_is_refused(client, admin):
    _, password = admin
    assert client.get(OVERVIEW, headers=password).status_code == 404
    assert "admin" not in client.get("/api/fde/me", headers=password).json()


def test_empty_allowlist_lets_nobody_in(client, admin, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_emails", set())
    google, _ = admin
    assert client.get(OVERVIEW, headers=google).status_code == 404


def test_google_admin_sees_assignments_and_machine(client, admin):
    google, _ = admin
    assert client.get("/api/fde/me", headers=google).json()["admin"] is True
    r = client.get(OVERVIEW, headers=google)
    assert r.status_code == 200
    body = r.json()
    ids = [a["id"] for a in body["assignments"]]
    assert ids[:2] == ["w12-p1", "w12-p2"] and len(ids) == 15
    p1 = body["assignments"][0]
    assert p1["status"] == "todo" and p1["status_source"] == "course"
    assert p1["progress"]["steps_total"] == 4
    m = body["machine"]
    assert m["database"] == "sqlite" and m["counts"]["users"] >= 1
    assert "email" not in body["admin"]


def test_course_progress_drives_status_until_set_by_hand(client, admin):
    google, _ = admin
    client.put("/api/fde/weeks/week-01/projects/P1/steps/0", json={"done": True}, headers=google)
    p1 = client.get(OVERVIEW, headers=google).json()["assignments"][0]
    assert p1["status"] == "doing" and p1["progress"]["steps_done"] == 1

    r = client.put("/api/fde/admin/assignments/w12-p1", json={"status": "done", "note": "shipped"}, headers=google)
    assert r.json() == {"status": "done", "note": "shipped"}
    p1 = client.get(OVERVIEW, headers=google).json()["assignments"][0]
    assert (p1["status"], p1["status_source"], p1["note"]) == ("done", "manual", "shipped")
    assert any(e["kind"] == "step" for e in client.get(OVERVIEW, headers=google).json()["machine"]["events"])

    client.put("/api/fde/admin/assignments/w12-p1", json={"status": None}, headers=google)
    assert client.get(OVERVIEW, headers=google).json()["assignments"][0]["status"] == "doing"


def test_status_writes_are_admin_only_and_validated(client, admin, auth):
    google, password = admin
    headers, _ = auth
    url = "/api/fde/admin/assignments/w3-p3"
    assert client.put(url, json={"status": "done"}, headers=headers).status_code == 404
    assert client.put(url, json={"status": "done"}, headers=password).status_code == 404
    assert client.put(url, json={"status": "nope"}, headers=google).status_code == 422
    assert client.put("/api/fde/admin/assignments/zzz", json={"status": "done"}, headers=google).status_code == 404


def test_admin_emails_env_is_parsed(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("ADMIN_EMAILS", " A@Example.com , 'b@example.com',, ")
    assert Settings().admin_emails == {"a@example.com", "b@example.com"}
