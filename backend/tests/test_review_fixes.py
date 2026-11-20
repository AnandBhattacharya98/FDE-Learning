"""Regression checks for the student/teacher logic review (Nov 2026)."""
import io

from app.content import load_weeks
from app.db import SessionLocal
from app.models_grading import GradingRun
from test_teacher import API, _signup, admin, learner, teacher  # noqa: F401  (fixtures)

W = f"{API}/weeks/week-01"


def test_failed_graded_quiz_hides_the_key(client, learner):
    h, _ = learner
    r = client.post(f"{W}/items/graded-quiz/quiz", json={"answers": {}}, headers=h).json()
    assert r["passed"] is False and r["results"] == []
    right = {q.id: q.answer for q in load_weeks()["week-01"].quiz}
    r = client.post(f"{W}/items/graded-quiz/quiz", json={"answers": right}, headers=h).json()
    assert r["passed"] is True and len(r["results"]) == r["total"]


def test_teacher_override_survives_learner_resave_and_regrade(client, teacher, learner):
    h, uid = learner
    url = "https://github.com/someone/call-log"
    save = lambda: client.put(f"{W}/projects/P1/submission/repo_url", json={"value": url}, headers=h)  # noqa: E731
    save()
    row = next(r for r in client.get(f"{API}/teacher/submissions", headers=teacher).json()["submissions"]
               if r["user_id"] == uid)
    rid = row["run"]["id"]
    with SessionLocal() as db:
        run = db.get(GradingRun, rid)
        run.status, run.score = "done", 95
        db.commit()
    client.put(f"{API}/teacher/submissions/runs/{rid}/review", headers=teacher,
               json={"decision": "override", "score": 30, "feedback": "copied"})
    save()
    mine = client.get(f"{API}/grading/week-01/P1", headers=h).json()
    assert mine["run"]["id"] == rid and mine["teacher_review"]["score"] == 30
    assert client.post(f"{API}/grading/week-01/P1", headers=h).status_code == 409


def test_unpublished_file_link_stops_working_for_learners(client, teacher, learner):
    h, _ = learner
    mid = client.post(f"{API}/teacher/materials", headers=teacher,
                      data={"week_id": "week-01", "title": "S", "published": "true"},
                      files={"file": ("s.txt", io.BytesIO(b"secret"), "text/plain")}).json()["id"]
    link = next(m for m in client.get(f"{W}/class", headers=h).json()["materials"] if m["id"] == mid)["file_url"]
    assert client.get(f"{API}{link}").status_code == 200
    client.patch(f"{API}/teacher/materials/{mid}", headers=teacher, json={"published": False})
    assert client.get(f"{API}{link}").status_code == 404
    staff = next(m for m in client.get(f"{API}/teacher/materials", headers=teacher).json()["materials"]
                 if m["id"] == mid)["file_url"]
    assert client.get(f"{API}{staff}").status_code == 200  # teachers still preview drafts


def test_staff_are_not_learners(client, teacher, admin):
    ids = {r["id"] for r in client.get(f"{API}/teacher/learners", headers=teacher).json()["learners"]}
    staff = {client.get(f"{API}/me", headers=h).json()["id"] for h in (teacher, admin)}
    assert not ids & staff


def test_material_edit_rejects_nulls_and_blank_titles(client, teacher):
    m = client.post(f"{API}/teacher/materials", headers=teacher,
                    data={"week_id": "week-01", "title": "Deck", "url": "https://example.com/x"}).json()
    for field in ("title", "published", "kind", "position"):
        assert client.patch(f"{API}/teacher/materials/{m['id']}", headers=teacher, json={field: None}).status_code == 422
    assert client.patch(f"{API}/teacher/materials/{m['id']}", headers=teacher, json={"title": "  "}).status_code == 422


def test_new_question_never_reuses_a_deleted_id(client, teacher):
    q = client.post(f"{API}/teacher/quizzes", headers=teacher, json={"week_id": "week-01", "title": "Q", "questions": [
        {"question": f"Q{i}", "options": ["a", "b"], "answer": 0} for i in range(3)]}).json()
    old = [x["id"] for x in q["questions"]]
    kept = q["questions"][:2] + [{"question": "new", "options": ["a", "b"], "answer": 0}]
    new = client.put(f"{API}/teacher/quizzes/{q['id']}", headers=teacher, json={"title": "Q", "questions": kept}).json()
    ids = [x["id"] for x in new["questions"]]
    assert ids[:2] == old[:2] and ids[2] not in old


def test_long_password_and_odd_worker_key_are_rejected_not_crashed(client):
    pw = "x" * 100
    assert client.post(f"{API}/auth/login", json={"email": "a@example.com", "password": pw}).status_code == 401
    assert client.post(f"{API}/auth/signup", json={"email": "b@example.com", "name": "B", "password": pw}).status_code == 422
    r = client.post(f"{API}/internal/weeks/week-01/voice-quiz/result", headers={"x-worker-key": b"caf\xc3\xa9"}, json={})
    assert r.status_code in (401, 422)
