"""Regression checks for the security review (Nov 2026)."""
import uuid

from app import api
from app.config import get_settings
from app.db import SessionLocal
from app.models import User
from test_teacher import API, learner  # noqa: F401  (fixture)


def test_password_tokens_die_when_the_password_changes(client):
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/signup", json={"email": email, "name": "Squatter", "password": "correct horse"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get(f"{API}/me", headers=h).status_code == 200
    with SessionLocal() as db:  # what a first Google sign-in by the real owner does
        u = db.get(User, r.json()["user"]["id"])
        u.password_hash = "rotated"
        db.commit()
    assert client.get(f"{API}/me", headers=h).status_code == 401


def test_login_is_throttled_after_repeated_failures(client):
    api._failed_logins.clear()
    body = {"email": "nobody@example.com", "password": "wrong-password"}
    codes = [client.post(f"{API}/auth/login", json=body).status_code for _ in range(api.LOGIN_FAILS + 1)]
    assert codes[:-1] == [401] * api.LOGIN_FAILS and codes[-1] == 429
    api._failed_logins.clear()


def test_oversized_request_is_refused_before_login(client):
    too_big = (get_settings().material_max_mb + 2) * 1024 * 1024
    r = client.post(f"{API}/teacher/materials", headers={"content-length": str(too_big)}, content=b"x")
    assert r.status_code == 413


def test_switching_links_cannot_start_runs_back_to_back(client, learner):
    from app.models_grading import GradingRun
    from sqlalchemy import func, select

    h, uid = learner
    for repo in ("https://github.com/a/one", "https://github.com/a/two", "https://github.com/a/one"):
        client.put(f"{API}/weeks/week-01/projects/P1/submission/repo_url", json={"value": repo}, headers=h)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(GradingRun).where(GradingRun.user_id == uid)) == 1
