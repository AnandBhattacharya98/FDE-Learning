import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///./test-fde.db"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-use-0123456789"
os.environ["VOICE_WORKER_KEY"] = "test-worker-key"
for v in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
    os.environ.pop(v, None)

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    db = Path("test-fde.db")
    db.unlink(missing_ok=True)
    from app.main import app

    with TestClient(app) as c:
        yield c
    db.unlink(missing_ok=True)


@pytest.fixture
def auth(client):
    import uuid

    r = client.post("/api/fde/auth/signup", json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Test FDE", "password": "correct horse"})
    assert r.status_code == 201
    body = r.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]
