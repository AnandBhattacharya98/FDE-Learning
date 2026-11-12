"""All settings come from environment variables (or a local .env file)."""
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parents[2]


def normalize_database_url(raw: str | None) -> str:
    """Tidy a pasted connection string so small copy-paste slips don't break start-up.

    Accepts the string exactly as Neon shows it (postgresql://...), with or without
    surrounding quotes, spaces, line breaks or a leading "psql".
    """
    url = "".join((raw or "").split())  # drop all whitespace, including line breaks
    if url.startswith("psql"):
        url = url[4:]
    url = url.strip("'\"")
    if not url:
        return "sqlite:///./fde.db"
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg://" + url[len(prefix):]
    return url


class Settings:
    def __init__(self) -> None:
        self.database_url = normalize_database_url(os.getenv("DATABASE_URL"))
        self.jwt_secret = os.getenv("JWT_SECRET") or ""
        self.jwt_ttl_hours = int(os.getenv("JWT_TTL_HOURS") or 24 * 7)
        self.cors_origins = [
            # Browsers send the origin without a trailing slash, so drop any that were pasted.
            o.strip().strip("'\"").rstrip("/")
            for o in (os.getenv("CORS_ORIGINS") or "http://localhost:5173").split(",")
            if o.strip()
        ]
        self.content_dir = Path(os.getenv("CONTENT_DIR") or REPO_ROOT / "content")
        self.livekit_url = os.getenv("LIVEKIT_URL") or ""
        self.livekit_api_key = os.getenv("LIVEKIT_API_KEY") or ""
        self.livekit_api_secret = os.getenv("LIVEKIT_API_SECRET") or ""
        # "Sign in with Google" (OAuth web client from Google Cloud Console). Blank = button hidden.
        self.google_client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
        self.google_client_secret = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
        # Where the site lives, so the API can send people back after Google sign-in.
        # Defaults to the first CORS origin.
        self.frontend_url = ((os.getenv("FRONTEND_URL") or "").strip().rstrip("/")
                             or (self.cors_origins[0] if self.cors_origins else "http://localhost:5173"))
        # Shared secret the voice-quiz worker sends when it reports a score.
        self.voice_worker_key = os.getenv("VOICE_WORKER_KEY") or ""
        # God mode: comma-separated emails allowed into the admin dashboard. They must also
        # have signed in with Google, so a password sign-up can't claim an admin's address.
        self.admin_emails = {
            e.strip().strip("'\"").lower()
            for e in (os.getenv("ADMIN_EMAILS") or "").split(",")
            if e.strip().strip("'\"")
        }

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def livekit_configured(self) -> bool:
        return bool(self.livekit_url and self.livekit_api_key and self.livekit_api_secret)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.jwt_secret:
        if s.database_url.startswith("sqlite"):
            # Local development only: a throwaway secret, so log-ins reset on restart.
            import secrets

            s.jwt_secret = secrets.token_urlsafe(48)
        else:
            raise RuntimeError("JWT_SECRET must be set when using a hosted database.")
    return s
