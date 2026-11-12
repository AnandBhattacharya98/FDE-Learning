"""Sign in with Google", the same server-side OAuth flow sunny-side uses.

1. The site sends the browser to GET /auth/google/start.
2. We redirect to Google with a signed `state` and set a short-lived cookie holding its nonce.
3. Google sends the browser back to GET /auth/google/callback with a code.
4. We check the state, swap the code for the user's verified email and name, find or
   create the account, and send the browser to <site>/auth/callback#token=<our JWT>.

The token travels in the URL fragment, which browsers never send to a server, so it
stays out of logs. Accounts are matched on the verified email, so someone who signed
up with a password and later uses Google with the same address lands in one account.
"""
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import hmac
import httpx
import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User
from .security import create_token, hash_password

router = APIRouter()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
STATE_COOKIE = "fde_google_state"
STATE_TTL = timedelta(minutes=10)


class GoogleAuthError(Exception):
    """A sign-in problem with a message that is safe to show the person."""


def _safe_next(path: str | None) -> str:
    # Only same-site paths, never "//evil.com" or a full URL.
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    return path


def _callback_url(request: Request) -> str:
    return str(request.url_for("google_callback"))


def _to_site(path: str, **fragment: str) -> RedirectResponse:
    url = get_settings().frontend_url + path
    if fragment:
        url += "#" + urlencode(fragment)
    resp = RedirectResponse(url, status_code=302)
    resp.delete_cookie(STATE_COOKIE, path="/")
    return resp


def fetch_google_profile(code: str, redirect_uri: str) -> dict:
    """Swap the one-time code for the person's profile. Tests replace this."""
    s = get_settings()
    with httpx.Client(timeout=15) as http:
        token = http.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": s.google_client_id,
            "client_secret": s.google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }).json()
        access = token.get("access_token")
        if not access:
            # Log Google's error code only (no secrets in it) to help debug setup mistakes.
            print(f"Google token exchange failed: {token.get('error')} {token.get('error_description')}")
            raise GoogleAuthError("Google sign-in didn't finish. Please try again.")
        return http.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access}"}).json()


@router.get("/auth/providers")
def providers():
    """Which sign-in buttons the site should show."""
    return {"google": get_settings().google_configured}


@router.get("/auth/google/start")
def google_start(request: Request, next: str | None = None):
    s = get_settings()
    if not s.google_configured:
        return _to_site("/login", error="Google sign-in isn't set up yet. Please use your email and password.")
    nonce = secrets.token_urlsafe(24)
    state = jwt.encode(
        {"nonce": nonce, "next": _safe_next(next), "exp": datetime.now(timezone.utc) + STATE_TTL},
        s.jwt_secret, algorithm="HS256",
    )
    query = urlencode({
        "client_id": s.google_client_id,
        "redirect_uri": _callback_url(request),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    })
    resp = RedirectResponse(f"{GOOGLE_AUTH_URL}?{query}", status_code=302)
    resp.set_cookie(STATE_COOKIE, nonce, max_age=int(STATE_TTL.total_seconds()), httponly=True,
                    secure=request.url.scheme == "https", samesite="lax", path="/")
    return resp


@router.get("/auth/google/callback", name="google_callback")
def google_callback(request: Request, code: str | None = None, state: str | None = None,
                    error: str | None = None, db: Session = Depends(get_db)):
    if error:  # e.g. the person pressed Cancel on Google's screen
        return _to_site("/login", error="Google sign-in was cancelled.")
    try:
        claims = jwt.decode(state or "", get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return _to_site("/login", error="That sign-in link expired. Please try again.")
    cookie = request.cookies.get(STATE_COOKIE, "")
    if not code or not cookie or not hmac.compare_digest(cookie, str(claims.get("nonce", ""))):
        return _to_site("/login", error="That sign-in link expired. Please try again.")

    try:
        profile = fetch_google_profile(code, _callback_url(request))
    except GoogleAuthError as e:
        return _to_site("/login", error=str(e))
    except httpx.HTTPError:
        return _to_site("/login", error="Couldn't reach Google. Please try again.")

    email = (profile.get("email") or "").strip().lower()
    if not email or "@" not in email or profile.get("email_verified") is not True:
        return _to_site("/login", error="Google didn't share a verified email address for that account.")
    name = (profile.get("name") or email.split("@")[0]).strip()[:120]

    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        # Google-only accounts get a random password nobody knows, as in sunny-side.
        user = User(email=email, name=name, password_hash=hash_password(secrets.token_urlsafe(32)))
        db.add(user)
        db.commit()

    return _to_site("/auth/callback", token=create_token(user.id, via="google"), next=claims.get("next") or "/")
