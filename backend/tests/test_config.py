import pytest

from app.config import normalize_database_url
from app.db import _make_engine

NEON = "postgresql://user:pw@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
EXPECTED = NEON.replace("postgresql://", "postgresql+psycopg://")


@pytest.mark.parametrize("raw", [
    NEON,
    EXPECTED,
    f"  '{NEON}'\n",
    f'"{NEON}"',
    f"psql '{NEON}'",
    NEON[:40] + "\n" + NEON[40:],
])
def test_pasted_neon_strings_are_normalized(raw):
    assert normalize_database_url(raw) == EXPECTED


def test_blank_means_local_sqlite():
    assert normalize_database_url("") == "sqlite:///./fde.db"
    assert normalize_database_url(None) == "sqlite:///./fde.db"


def test_truncated_url_gives_clear_error_without_password():
    with pytest.raises(RuntimeError) as e:
        _make_engine("postgresql+psycopg://neondb_")
    assert "neondb_" in str(e.value)
    with pytest.raises(RuntimeError) as e:
        _make_engine("postgresql+psycopg://neondb_owner:secretpw@neondb_/x")
    assert "secretpw" not in str(e.value)


def test_full_url_builds_engine():
    _make_engine(EXPECTED)
