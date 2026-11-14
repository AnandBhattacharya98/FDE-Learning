from sqlalchemy import create_engine, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    host = make_url(url).host or ""
    if "." not in host and host not in ("localhost", "db", "postgres"):
        # Shows the host only, never the password.
        raise RuntimeError(
            f"DATABASE_URL looks incomplete: the database host came out as {host!r}. "
            "Paste the whole connection string from Neon on one line, with the real password."
        )
    # Neon closes idle connections, so check each one before use.
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models, models_admin, models_coach, models_course, models_grading, models_teacher, models_voice  # noqa: F401  (registers tables)

    Base.metadata.create_all(engine)
