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

    client.put("/api/fde/admin/assignments/w12-p1", json={"status": None, "note": ""}, headers=google)
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


def test_build_log_is_valid_and_linked_to_assignments(client, admin):
    from app.admin import load_build_log

    entries = load_build_log()
    assert len(entries) >= 10
    google, _ = admin
    body = client.get(OVERVIEW, headers=google).json()
    log = body["build_log"]
    assert log[0]["date"] >= log[-1]["date"]  # newest first
    p1 = body["assignments"][0]
    assert "site-stack" in p1["features"]
    ids = {e["id"] for e in log}
    assert all(f in ids for a in body["assignments"] for f in a["features"])


def test_build_log_rejects_unknown_assignment(tmp_path, monkeypatch):
    import json
    import shutil

    from app import admin

    for name in ("assignments.json",):
        shutil.copy(get_settings().content_dir / name, tmp_path / name)
    entry = {"id": "x", "date": "2026-11-12", "title": "x", "assignments": ["nope"], "where": ["a"],
             "how": ["b"], "demo": {"title": "c", "lines": [{"kind": "note", "text": "d"}]}}
    (tmp_path / "build-log.json").write_text(json.dumps({"entries": [entry]}))
    monkeypatch.setattr(get_settings(), "content_dir", tmp_path)
    admin.load_build_log.cache_clear()
    admin.load_assignments.cache_clear()
    try:
        with pytest.raises(ValueError, match="unknown assignments"):
            admin.load_build_log()
    finally:
        monkeypatch.undo()
        admin.load_build_log.cache_clear()
        admin.load_assignments.cache_clear()


def test_build_log_status_updates_and_newest_wins(client, admin):
    google, _ = admin
    body = client.get(OVERVIEW, headers=google).json()
    p3 = next(a for a in body["assignments"] if a["id"] == "w3-p3")
    assert p3["status"] == "doing" and p3["status_source"] == "build-log"
    assert p3["status_by"]["entry"] == "auto-status" and p3["status_by"]["note"]

    # A click now is newer than the build-log update, so it wins and keeps the note.
    client.put("/api/fde/admin/assignments/w3-p3", json={"status": "done", "note": "submitted"}, headers=google)
    p3 = next(a for a in client.get(OVERVIEW, headers=google).json()["assignments"] if a["id"] == "w3-p3")
    assert (p3["status"], p3["status_source"], p3["manual_status"]) == ("done", "manual", "done")

    # Back to automatic keeps the note, and the build log drives the status again.
    client.put("/api/fde/admin/assignments/w3-p3", json={"status": None, "note": "submitted"}, headers=google)
    p3 = next(a for a in client.get(OVERVIEW, headers=google).json()["assignments"] if a["id"] == "w3-p3")
    assert (p3["status"], p3["status_source"], p3["note"], p3["manual_status"]) == ("doing", "build-log", "submitted", None)


def test_newer_build_log_update_beats_an_older_click(client, admin, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app import admin as admin_mod

    google, _ = admin
    client.put("/api/fde/admin/assignments/w4-p4", json={"status": "todo"}, headers=google)
    log = admin_mod.load_build_log()
    entry = next(e for e in log if e.id == "auto-status")
    later = entry.model_copy(update={"status_updates": [admin_mod.StatusUpdate(
        assignment="w4-p4", status="done", note="shipped", at=datetime.now(timezone.utc) + timedelta(minutes=5))]})
    monkeypatch.setattr(admin_mod, "load_build_log", lambda: [*log, later.model_copy(update={"id": "later"})])
    p4 = next(a for a in client.get(OVERVIEW, headers=google).json()["assignments"] if a["id"] == "w4-p4")
    assert (p4["status"], p4["status_source"]) == ("done", "build-log")
