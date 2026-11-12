from urllib.parse import parse_qs, urlparse

import pytest

from app import google_auth
from app.config import get_settings

START = "/api/fde/auth/google/start"
CALLBACK = "/api/fde/auth/google/callback"


@pytest.fixture
def google_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "test-client-id")
    monkeypatch.setattr(s, "google_client_secret", "test-client-secret")
    monkeypatch.setattr(s, "frontend_url", "https://site.example")
    return s


def _fragment(location: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlparse(location).fragment).items()}


def _start(client, next_path="/weeks/week-01"):
    r = client.get(START, params={"next": next_path}, follow_redirects=False)
    assert r.status_code == 302
    q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
    return r, q


def test_providers_reports_google_off_by_default(client):
    assert client.get("/api/fde/auth/providers").json() == {"google": False}


def test_start_without_keys_sends_back_to_login(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "frontend_url", "https://site.example")
    r = client.get(START, follow_redirects=False)
    assert r.headers["location"].startswith("https://site.example/login#error=")


def test_start_redirects_to_google_with_state_cookie(client, google_on):
    assert client.get("/api/fde/auth/providers").json() == {"google": True}
    r, q = _start(client)
    assert r.headers["location"].startswith(google_auth.GOOGLE_AUTH_URL)
    assert q["client_id"] == "test-client-id"
    assert q["scope"] == "openid email profile"
    assert q["redirect_uri"].endswith(CALLBACK)
    assert google_auth.STATE_COOKIE in r.cookies


def _finish(client, monkeypatch, profile, next_path="/weeks/week-01"):
    _, q = _start(client, next_path)
    monkeypatch.setattr(google_auth, "fetch_google_profile", lambda code, uri: profile)
    return client.get(CALLBACK, params={"code": "abc", "state": q["state"]}, follow_redirects=False)


def test_full_sign_in_creates_account_and_returns_token(client, google_on, monkeypatch):
    r = _finish(client, monkeypatch, {"email": "New.Person@Gmail.com", "email_verified": True, "name": "New Person"})
    assert r.headers["location"].startswith("https://site.example/auth/callback#")
    frag = _fragment(r.headers["location"])
    assert frag["next"] == "/weeks/week-01"
    me = client.get("/api/fde/me", headers={"Authorization": f"Bearer {frag['token']}"}).json()
    assert me["email"] == "new.person@gmail.com" and me["name"] == "New Person"
    # The token says it came from Google, which God mode requires.
    import jwt
    assert jwt.decode(frag["token"], get_settings().jwt_secret, algorithms=["HS256"])["via"] == "google"

    # Signing in again lands in the same account.
    again = _fragment(_finish(client, monkeypatch, {"email": "new.person@gmail.com", "email_verified": True})
                      .headers["location"])
    assert client.get("/api/fde/me", headers={"Authorization": f"Bearer {again['token']}"}).json()["id"] == me["id"]


def test_google_links_to_existing_password_account(client, google_on, monkeypatch):
    made = client.post("/api/fde/auth/signup", json={"email": "both@example.com", "name": "Both", "password": "longenough"}).json()
    frag = _fragment(_finish(client, monkeypatch, {"email": "both@example.com", "email_verified": True, "name": "B"})
                     .headers["location"])
    assert client.get("/api/fde/me", headers={"Authorization": f"Bearer {frag['token']}"}).json()["id"] == made["user"]["id"]
    # The password still works too.
    assert client.post("/api/fde/auth/login", json={"email": "both@example.com", "password": "longenough"}).status_code == 200


def test_unverified_email_is_refused(client, google_on, monkeypatch):
    r = _finish(client, monkeypatch, {"email": "x@example.com", "email_verified": False})
    assert r.headers["location"].startswith("https://site.example/login#error=")


def test_bad_or_missing_state_is_refused(client, google_on, monkeypatch):
    monkeypatch.setattr(google_auth, "fetch_google_profile", lambda c, u: pytest.fail("should not call Google"))
    r = client.get(CALLBACK, params={"code": "abc", "state": "forged"}, follow_redirects=False)
    assert "/login#error=" in r.headers["location"]
    # A real state but without the matching cookie (e.g. started in another browser).
    _, q = _start(client)
    client.cookies.clear()
    r = client.get(CALLBACK, params={"code": "abc", "state": q["state"]}, follow_redirects=False)
    assert "/login#error=" in r.headers["location"]


def test_cancel_on_google_screen(client, google_on):
    r = client.get(CALLBACK, params={"error": "access_denied"}, follow_redirects=False)
    assert "/login#error=" in r.headers["location"]


@pytest.mark.parametrize("raw,expected", [
    ("/weeks/week-02", "/weeks/week-02"), (None, "/"), ("//evil.com", "/"),
    ("https://evil.com", "/"), ("/\\evil.com", "/"),
])
def test_next_is_kept_on_site(raw, expected):
    assert google_auth._safe_next(raw) == expected
