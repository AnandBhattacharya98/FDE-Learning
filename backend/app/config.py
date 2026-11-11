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
            o.strip() for o in (os.getenv("CORS_ORIGINS") or "http://localhost:5173").split(",") if o.strip()
        ]
        self.content_dir = Path(os.getenv("CONTENT_DIR") or REPO_ROOT / "content")
        self.livekit_url = os.getenv("LIVEKIT_URL") or ""
        self.livekit_api_key = os.getenv("LIVEKIT_API_KEY") or ""
        self.livekit_api_secret = os.getenv("LIVEKIT_API_SECRET") or ""
        # Shared secret the voice-quiz worker sends when it reports a score.
        self.voice_worker_key = os.getenv("VOICE_WORKER_KEY") or ""

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
