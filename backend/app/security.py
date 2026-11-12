from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int, via: str = "password") -> str:
    """`via` records how the person signed in ("password" or "google"). God mode only
    accepts "google" tokens, because only Google proves the person owns the email."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "via": via, "iat": now, "exp": now + timedelta(hours=s.jwt_ttl_hours)}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def token_claims(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """The verified claims of the bearer token, or {} when there is none or it's invalid."""
    if creds is None:
        return {}
    try:
        return jwt.decode(creds.credentials, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return {}


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in again.")
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, get_settings().jwt_secret, algorithms=["HS256"])
        user = db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    if user is None:
        raise unauthorized
    if not get_settings().email_allowed(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, not_allowed_message())
    return user


def not_allowed_message() -> str:
    domains = sorted(get_settings().allowed_email_domains)
    return "This site is only open to " + ", ".join("@" + d for d in domains) + " accounts."
