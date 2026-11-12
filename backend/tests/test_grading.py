import importlib.util
import json
import sys
import uuid
from pathlib import Path

import pytest

from app import grading
from app.config import get_settings
from app.security import create_token

ROOT = Path(__file__).resolve().parents[2]
P1_SUB = "/api/fde/weeks/week-01/projects/P1/submission"


def _load_runner():
    spec = importlib.util.spec_from_file_location("run_checks", ROOT / "grader" / "run_checks.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["run_checks"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def admin_headers(client, monkeypatch):
    email = f"boss-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setattr(get_settings(), "admin_emails", {email})
    r = client.post("/api/fde/auth/signup", json={"email": email, "name": "Admin", "password": "correct horse"})
    return {"Authorization": f"Bearer {create_token(r.json()['user']['id'], via='google')}"}


@pytest.fixture
def grader_on(monkeypatch):
    monkeypatch.setenv("GRADER_GITHUB_TOKEN", "test-gh-token")
    monkeypatch.setenv("GRADER_CALLBACK_KEY", "test-callback-key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    sent = []

    class Resp:
        status_code = 204

    def fake_post(url, **kw):
        sent.append((url, kw["json"]))
        return Resp()

    monkeypatch.setattr(grading.httpx, "post", fake_post)
    return sent


def test_rubric_points_and_check_ids_match_the_runner():
    pass_mark, projects = grading.load_grading()
    assert pass_mark == 70
    runner = _load_runner()
    for pid, p in projects.items():
        assert p.checks_max + p.rubric_max == 100
        assert [c.id for c in p.checks] == runner.CHECK_IDS[pid]


def test_score_skips_checks_that_dont_apply_and_caps_the_review():
    p = grading.load_grading()[1]["P1"]
    checks = [{"id": c.id, "status": "pass"} for c in p.checks]
    assert grading.compute_score(p, checks, None)["total"] == 100
    checks[8]["status"] = "skip"  # no tests in the repo: the other checks scale up
    assert grading.compute_score(p, checks, None)["total"] == 100
    review = {"criteria": [{"id": r.id, "score": 999} for r in p.rubric]}
    assert grading.compute_score(p, checks, review)["total"] == 100
    half = {"criteria": [{"id": r.id, "score": r.points // 2} for r in p.rubric]}
    assert grading.compute_score(p, [{"id": "clone", "status": "pass"}], half)["total"] == 5 + sum(r.points // 2 for r in p.rubric)


def test_saving_a_repo_link_without_setup_marks_not_configured(client, auth, monkeypatch):
    monkeypatch.delenv("GRADER_GITHUB_TOKEN", raising=False)
    headers, _ = auth
    r = client.put(f"{P1_SUB}/repo_url", json={"value": "https://github.com/someone/call-log"}, headers=headers)
    assert r.status_code == 200
    run = client.get("/api/fde/grading/week-01/P1", headers=headers).json()["run"]
    assert run["status"] == "not_configured" and run["score"] is None


def test_full_flow_dispatch_report_score(client, auth, admin_headers, grader_on, monkeypatch):
    headers, user = auth
    client.put(f"{P1_SUB}/api_url", json={"value": "https://call-log.example.com"}, headers=headers)
    client.put(f"{P1_SUB}/curl", json={"value": "curl -X POST ..."}, headers=headers)
    client.put(f"{P1_SUB}/repo_url", json={"value": "https://github.com/someone/call-log"}, headers=headers)
    assert len(grader_on) == 1
    url, payload = grader_on[0]
    assert url.endswith("/actions/workflows/grade-submission.yml/dispatches")
    inputs = payload["inputs"]
    assert inputs["project"] == "P1" and json.loads(inputs["links"]) == {"api_url": "https://call-log.example.com"}
    assert "curl" not in inputs["links"]

    run = client.get("/api/fde/grading/week-01/P1", headers=headers).json()["run"]
    assert run["status"] == "running"

    # Saving the same link again doesn't start a second run while one is in flight.
    client.put(f"{P1_SUB}/repo_url", json={"value": "https://github.com/someone/call-log"}, headers=headers)
    assert len(grader_on) == 1

    p = grading.load_grading()[1]["P1"]
    result = {"checks": [{"id": c.id, "status": "pass", "detail": "ok"} for c in p.checks]
              + [{"id": "made_up", "status": "pass"}],
              "files": [{"path": "README.md", "text": "hello"}], "repo": {"url": inputs["repo_url"]}, "logs": []}
    body = {"run_id": int(inputs["run_id"]), "token": inputs["run_token"], "result": result,
            "run_url": "https://github.com/x/y/actions/runs/1"}
    assert client.post("/api/fde/grader/report", json=body, headers={"X-Grader-Key": "wrong"}).status_code == 401
    assert client.post("/api/fde/grader/report", json={**body, "token": "nope"},
                       headers={"X-Grader-Key": "test-callback-key"}).status_code == 404

    seen = {}

    def fake_claude(p, prompt, model):
        seen["prompt"] = prompt
        return {"criteria": [{"id": r.id, "score": r.points - 2, "comment": "Good."} for r in p.rubric],
                "summary": "Solid.", "strengths": ["Works"], "improvements": ["Add tests"]}

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-real")
    monkeypatch.setattr(grading, "call_claude", fake_claude)
    r = client.post("/api/fde/grader/report", json=body, headers={"X-Grader-Key": "test-callback-key"})
    assert r.status_code == 200

    run = client.get("/api/fde/grading/week-01/P1", headers=headers).json()["run"]
    assert run["status"] == "done"
    assert run["score"] == 100 - 2 * len(p.rubric) and run["passed"] is True
    assert {c["id"] for c in run["checks"]} == {c.id for c in p.checks}
    assert run["review"]["criteria"][0]["max"] == p.rubric[0].points
    assert "<repo_files>" in seen["prompt"] and "curl -X POST" in seen["prompt"]

    # A repeat report is ignored.
    assert client.post("/api/fde/grader/report", json=body, headers={"X-Grader-Key": "test-callback-key"}).json()["status"] == "done"

    # God mode sees it; ordinary learners don't.
    assert client.get("/api/fde/admin/grading", headers=headers).status_code == 404
    board = client.get("/api/fde/admin/grading", headers=admin_headers).json()
    mine = next(s for s in board["submissions"] if s["user_id"] == user["id"])
    assert mine["score"] == run["score"] and board["setup"]["github"] is True
    detail = client.get(f"/api/fde/admin/grading/runs/{run['id']}", headers=admin_headers).json()
    assert detail["run_url"].endswith("/runs/1") and "files" not in (detail.get("repo") or {})

    # Regrade starts a fresh run.
    r = client.post(f"/api/fde/admin/grading/runs/{run['id']}/regrade", headers=admin_headers)
    assert r.status_code == 202 and r.json()["run"]["id"] != run["id"] and len(grader_on) == 2

    from app.db import SessionLocal
    with SessionLocal() as db:
        g = grading.grades_for(db, [user["id"]])
    assert g[user["id"]]["P1"]["status"] == "pending"


def test_learner_cooldown(client, auth, grader_on):
    headers, _ = auth
    client.put(f"{P1_SUB}/repo_url", json={"value": "https://github.com/someone/p1"}, headers=headers)
    run = client.get("/api/fde/grading/week-01/P1", headers=headers).json()["run"]
    from app.db import SessionLocal
    from app.models_grading import GradingRun
    with SessionLocal() as db:
        db.get(GradingRun, run["id"]).status = "done"
        db.commit()
    assert client.post("/api/fde/grading/week-01/P1", headers=headers).status_code == 429


def test_runner_static_checks_and_secret_scan(tmp_path):
    runner = _load_runner()
    repo = tmp_path / "repo"
    (repo / "api").mkdir(parents=True)
    (repo / "web").mkdir()
    (repo / "README.md").write_text("# Call log\n\n" + "This app stores calls. " * 10 + "\n\nRun: pip install -r requirements.txt then uvicorn main:app\n")
    (repo / "api" / "main.py").write_text(
        'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/calls")\ndef a(): return []\n@app.post("/calls")\ndef b(): return {}\n')
    (repo / "api" / "schema.sql").write_text("CREATE TABLE IF NOT EXISTS calls (id serial primary key);\n")
    (repo / "web" / "package.json").write_text('{"dependencies": {"react": "^18"}}')
    (repo / "api" / "db.py").write_text('URL = "postgresql://neondb_owner:' + "Xy7sEcretPass" + '@ep-cool.neon.tech/neondb"\n')
    out = tmp_path / "result.json"
    runner.main(["--project", "P1", "--repo", "local", "--local-dir", str(repo), "--sandbox", "none",
                 "--out", str(out), "--links", "{}"])
    res = json.loads(out.read_text())
    st = {c["id"]: c for c in res["checks"]}
    assert [c["id"] for c in res["checks"]].count("clone") == 1
    assert set(st) == set(runner.CHECK_IDS["P1"])
    assert st["readme"]["status"] == "pass"
    assert st["backend_routes"]["status"] == "pass" and st["calls_table"]["status"] == "pass"
    assert st["frontend_react"]["status"] == "pass"
    assert st["no_secrets"]["status"] == "fail" and "api/db.py" in st["no_secrets"]["detail"]
    assert "Xy7sEcretPass" not in out.read_text()  # never copied into the result
    assert st["live_api"]["status"] == "fail" and st["tests"]["status"] == "skip"


def test_runner_rejects_non_github_links(tmp_path):
    runner = _load_runner()
    out = tmp_path / "r.json"
    runner.main(["--project", "P2", "--repo", "https://evil.example.com/x", "--out", str(out)])
    res = json.loads(out.read_text())
    assert res["checks"][0] == {"id": "clone", "status": "fail", "detail": res["checks"][0]["detail"]}
    assert all(c["status"] in ("fail", "skip") for c in res["checks"])


def test_cohort_view_shows_grades(client, admin_headers):
    from app.cohort import LEARNER_EXTRAS
    assert LEARNER_EXTRAS["grades"] is grading.grades_for
    r = client.get("/api/fde/admin/learners", headers=admin_headers)
    assert r.status_code == 200
