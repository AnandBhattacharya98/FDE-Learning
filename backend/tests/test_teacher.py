import io
import uuid

import pytest

from app import teacher as teacher_mod
from app.config import get_settings
from app.db import SessionLocal
from app.models_grading import GradingRun
from app.security import create_token

API = "/api/fde"


def _signup(client, name="Learner", email=None):
    email = email or f"{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/signup", json={"email": email, "name": name, "password": "correct horse"})
    assert r.status_code == 201
    return r.json()["user"]["id"], email


def _google(uid):
    return {"Authorization": f"Bearer {create_token(uid, via='google')}"}


@pytest.fixture
def teacher(client, monkeypatch):
    uid, email = _signup(client, "Ms Teacher")
    monkeypatch.setattr(get_settings(), "teacher_emails", {email})
    return _google(uid)


@pytest.fixture
def learner(client):
    uid, _ = _signup(client, "Lee Learner")
    return {"Authorization": f"Bearer {create_token(uid)}"}, uid


@pytest.fixture
def admin(client, monkeypatch):
    uid, email = _signup(client, "Boss")
    monkeypatch.setattr(get_settings(), "admin_emails", {email})
    return _google(uid)


def test_only_google_teachers_get_in(client, monkeypatch, learner):
    uid, email = _signup(client, "Would-be teacher")
    monkeypatch.setattr(get_settings(), "teacher_emails", {email})
    password = {"Authorization": f"Bearer {create_token(uid)}"}
    assert client.get(f"{API}/teacher/overview", headers=password).status_code == 404
    assert "teacher" not in client.get(f"{API}/me", headers=password).json()
    assert client.get(f"{API}/teacher/overview", headers=learner[0]).status_code == 404
    assert client.get(f"{API}/teacher/overview").status_code == 401
    body = client.get(f"{API}/teacher/overview", headers=_google(uid)).json()
    assert body["me"]["name"] == "Would-be teacher" and body["weeks"][0]["modules"]
    assert client.get(f"{API}/me", headers=_google(uid)).json()["teacher"] is True


def test_admin_is_a_teacher_and_can_add_teachers(client, admin):
    assert client.get(f"{API}/teacher/overview", headers=admin).status_code == 200
    uid, email = _signup(client, "New Teacher")
    assert client.get(f"{API}/teacher/overview", headers=_google(uid)).status_code == 404
    rows = client.post(f"{API}/admin/teachers", json={"email": email.upper()}, headers=admin).json()["teachers"]
    row = next(r for r in rows if r["email"] == email)
    assert row["name"] == "New Teacher" and row["source"] == "god_mode"
    assert client.get(f"{API}/teacher/overview", headers=_google(uid)).status_code == 200
    client.delete(f"{API}/admin/teachers/{row['id']}", headers=admin)
    assert client.get(f"{API}/teacher/overview", headers=_google(uid)).status_code == 404


def test_teachers_cant_manage_teachers(client, teacher):
    assert client.get(f"{API}/admin/teachers", headers=teacher).status_code == 404


def test_upload_slides_publish_and_learner_sees_them(client, teacher, learner):
    text = b"Slide one: a webhook is an HTTP callback.\nSlide two: retries need idempotency keys."
    r = client.post(f"{API}/teacher/materials", headers=teacher,
                    data={"week_id": "week-01", "module_id": "m1", "title": "Webhooks deck", "notes": "Stress retries."},
                    files={"file": ("deck.md", io.BytesIO(text), "text/markdown")})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["kind"] == "doc" and m["has_text"] and m["text_chars"] > 20 and not m["published"]

    # Learners can't see drafts.
    assert client.get(f"{API}/weeks/week-01/class", headers=learner[0]).json()["materials"] == []
    client.patch(f"{API}/teacher/materials/{m['id']}", json={"published": True, "kind": "slides"}, headers=teacher)
    seen = client.get(f"{API}/weeks/week-01/class", headers=learner[0]).json()["materials"]
    mine = next(x for x in seen if x["id"] == m["id"])
    assert mine["kind"] == "slides" and "notes" not in mine

    # The signed link works without a token, honours Range, and rejects a bad signature.
    f = client.get(API + mine["file_url"])
    assert f.status_code == 200 and f.content == text
    part = client.get(API + mine["file_url"], headers={"Range": "bytes=0-4"})
    assert part.status_code == 206 and part.content == text[:5]
    assert client.get(API + mine["file_url"].replace("sig=", "sig=0")).status_code == 403

    assert client.delete(f"{API}/teacher/materials/{m['id']}", headers=teacher).json()["ok"]
    assert client.get(API + mine["file_url"]).status_code == 404


def test_video_links_embed_and_bad_uploads_are_refused(client, teacher, monkeypatch):
    r = client.post(f"{API}/teacher/materials", headers=teacher,
                    data={"week_id": "week-01", "title": "Kickoff recording", "url": "https://youtu.be/dQw4w9WgXcQ"})
    assert r.status_code == 201 and r.json()["kind"] == "video"
    assert r.json()["embed_url"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    assert client.post(f"{API}/teacher/materials", headers=teacher,
                       data={"week_id": "week-01", "title": "x"}).status_code == 422
    assert client.post(f"{API}/teacher/materials", headers=teacher, data={"week_id": "week-01", "title": "x"},
                       files={"file": ("run.exe", io.BytesIO(b"MZ"), "application/octet-stream")}).status_code == 415
    monkeypatch.setattr(get_settings(), "material_max_mb", 0)
    assert client.post(f"{API}/teacher/materials", headers=teacher, data={"week_id": "week-01", "title": "x"},
                       files={"file": ("a.txt", io.BytesIO(b"hello"), "text/plain")}).status_code == 413


def test_embed_urls():
    e = teacher_mod.embed_url
    assert e("https://www.youtube.com/watch?v=abcdefg123&t=4") == "https://www.youtube-nocookie.com/embed/abcdefg123"
    assert e("https://www.loom.com/share/0123abcd") == "https://www.loom.com/embed/0123abcd"
    assert e("https://vimeo.com/12345") == "https://player.vimeo.com/video/12345"
    assert e("https://drive.google.com/file/d/AbC-1/view?usp=sharing") == "https://drive.google.com/file/d/AbC-1/preview"
    assert e("https://example.com/video") is None


def test_pdf_and_pptx_text_extraction():
    from pptx import Presentation
    from pptx.util import Inches

    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[5])
    slide.shapes.title.text = "Latency budget"
    slide.notes_slide.notes_text_frame.text = "Keep turns under 800 ms."
    slide.shapes.add_textbox(Inches(1), Inches(2), Inches(4), Inches(1)).text_frame.text = "STT + LLM + TTS"
    buf = io.BytesIO()
    deck.save(buf)
    text = teacher_mod.extract_text("deck.pptx", "", buf.getvalue())
    assert "Latency budget" in text and "STT + LLM + TTS" in text and "800 ms" in text
    assert teacher_mod.extract_text("broken.pdf", "application/pdf", b"not a pdf") == ""


def test_generate_edit_publish_and_take_a_quiz(client, teacher, learner, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-not-real")
    seen = {}

    def fake(prompt, model):
        seen["prompt"] = prompt
        return {"title": "Webhooks check", "questions": [
            {"question": "Why use idempotency keys?", "options": ["Speed", "Safe retries", "Auth", "Logs"],
             "answer": 1, "explanation": "Retries can repeat a request.", "source": "Webhooks deck"},
            {"question": "Broken", "options": ["only one"], "answer": 0, "explanation": "", "source": ""},
            {"question": "What calls a webhook?", "options": ["The sender", "The browser"], "answer": 0,
             "explanation": "", "source": ""},
        ]}

    monkeypatch.setattr(teacher_mod, "call_quiz_model", fake)
    m = client.post(f"{API}/teacher/materials", headers=teacher,
                    data={"week_id": "week-01", "title": "Notes", "url": "https://example.com/talk",
                          "notes": "Retries need idempotency keys."}).json()
    r = client.post(f"{API}/teacher/quizzes/generate", headers=teacher,
                    json={"week_id": "week-01", "module_id": "m1", "material_ids": [m["id"]], "count": 3, "focus": "retries"})
    assert r.status_code == 202, r.text
    qid = r.json()["id"]
    assert "idempotency keys" in seen["prompt"] and "retries" in seen["prompt"] and "<lesson" in seen["prompt"]

    quiz = next(q for q in client.get(f"{API}/teacher/quizzes", headers=teacher).json()["quizzes"] if q["id"] == qid)
    assert quiz["status"] == "draft" and quiz["title"] == "Webhooks check" and quiz["count"] == 2  # bad one dropped

    # Learners don't see drafts; teacher edits then publishes.
    assert client.get(f"{API}/weeks/week-01/class", headers=learner[0]).json()["quizzes"] == []
    qs = quiz["questions"]
    qs[1]["options"] = ["The sender's server", "Your browser", "DNS"]
    bad = client.put(f"{API}/teacher/quizzes/{qid}", headers=teacher,
                     json={"title": "Webhooks", "module_id": "m1", "questions": [{**qs[0], "answer": 9}]})
    assert bad.status_code == 422
    saved = client.put(f"{API}/teacher/quizzes/{qid}", headers=teacher,
                       json={"title": "Webhooks", "module_id": "m1", "pass_percent": 50, "questions": qs}).json()
    assert saved["questions"][1]["options"][2] == "DNS"
    assert client.post(f"{API}/teacher/quizzes/{qid}/publish", json={"published": True}, headers=teacher).json()["status"] == "published"

    pub = next(q for q in client.get(f"{API}/weeks/week-01/class", headers=learner[0]).json()["quizzes"] if q["id"] == qid)
    assert "answer" not in pub["questions"][0] and pub["best"] is None
    res = client.post(f"{API}/class-quizzes/{qid}/attempt", json={"answers": {"q1": 1, "q2": 1}}, headers=learner[0]).json()
    assert res["score"] == 1 and res["total"] == 2 and res["passed"]

    results = client.get(f"{API}/teacher/quizzes/{qid}/results", headers=teacher).json()
    assert results["learners"][0]["name"] == "Lee Learner" and results["learners"][0]["best"] == 50
    assert [q["correct_percent"] for q in results["questions"]] == [100, 0]
    assert client.get(f"{API}/teacher/quizzes/{qid}/results", headers=learner[0]).status_code == 404


def test_generation_failure_and_missing_key(client, teacher, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    assert client.post(f"{API}/teacher/quizzes/generate", headers=teacher, json={"week_id": "week-01"}).status_code == 503
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-not-real")

    def boom(prompt, model):
        raise RuntimeError("The model declined to write this quiz.")

    monkeypatch.setattr(teacher_mod, "call_quiz_model", boom)
    qid = client.post(f"{API}/teacher/quizzes/generate", headers=teacher, json={"week_id": "week-01"}).json()["id"]
    quiz = next(q for q in client.get(f"{API}/teacher/quizzes", headers=teacher).json()["quizzes"] if q["id"] == qid)
    assert quiz["status"] == "failed" and "declined" in quiz["message"]
    assert client.post(f"{API}/teacher/quizzes/{qid}/publish", json={"published": True}, headers=teacher).status_code == 422
    # Nothing to read: no materials and no lessons.
    assert client.post(f"{API}/teacher/quizzes/generate", headers=teacher,
                       json={"week_id": "week-01", "use_week_lessons": False}).status_code == 422


def test_review_a_submission_override_and_feedback(client, teacher, learner, monkeypatch):
    headers, uid = learner
    client.put(f"{API}/weeks/week-01/projects/P1/submission/repo_url", json={"value": "https://github.com/someone/call-log"},
               headers=headers)
    rows = client.get(f"{API}/teacher/submissions", headers=teacher).json()["submissions"]
    row = next(r for r in rows if r["user_id"] == uid)
    assert row["repo_url"].endswith("call-log") and row["run"] is not None

    with SessionLocal() as db:  # pretend the grader finished
        run = db.get(GradingRun, row["run"]["id"])
        run.status, run.score = "done", 55
        db.commit()
    row = next(r for r in client.get(f"{API}/teacher/submissions", headers=teacher).json()["submissions"] if r["user_id"] == uid)
    assert row["state"] == "needs_review" and row["final_score"] == 55
    rid = row["run"]["id"]

    assert client.put(f"{API}/teacher/submissions/runs/{rid}/review", headers=teacher,
                      json={"decision": "override"}).status_code == 422
    assert client.put(f"{API}/teacher/submissions/runs/{rid}/review", headers=headers,
                      json={"decision": "approved"}).status_code == 404
    r = client.put(f"{API}/teacher/submissions/runs/{rid}/review", headers=teacher,
                   json={"decision": "override", "score": 82, "feedback": "The grader missed your tests folder."})
    assert r.json()["teacher_review"]["score"] == 82
    row = next(r for r in client.get(f"{API}/teacher/submissions", headers=teacher).json()["submissions"] if r["user_id"] == uid)
    assert row["state"] == "reviewed" and row["final_score"] == 82

    mine = client.get(f"{API}/grading/week-01/P1", headers=headers).json()
    assert mine["teacher_review"]["feedback"].startswith("The grader missed") and mine["teacher_review"]["teacher"] == "Ms Teacher"
    cohort = next(r for r in client.get(f"{API}/teacher/learners", headers=teacher).json()["learners"] if r["id"] == uid)
    assert cohort["grades"]["P1"]["score"] == 82 and cohort["grades"]["P1"]["status"] == "passed"

    detail = client.get(f"{API}/teacher/submissions/runs/{rid}", headers=teacher).json()
    assert detail["learner"] == "Lee Learner" and detail["teacher_review"]["decision"] == "override"
    client.delete(f"{API}/teacher/submissions/runs/{rid}/review", headers=teacher)
    assert client.get(f"{API}/grading/week-01/P1", headers=headers).json()["teacher_review"] is None


def test_repo_check(client, teacher, monkeypatch):
    class R:
        def __init__(self, code, body):
            self.status_code, self._body = code, body

        def json(self):
            return self._body

    def fake_get(path, token):
        if path.endswith("/commits?per_page=1"):
            return R(200, [{"commit": {"message": "Add API\n\nmore", "committer": {"date": "2026-11-13T10:00:00Z"},
                                       "author": {"name": "Lee"}}}])
        if path.endswith("/readme"):
            return R(404, {})
        if "missing" in path:
            return R(404, {})
        return R(200, {"full_name": "lee/app", "private": False, "default_branch": "main", "size": 120,
                       "pushed_at": "2026-11-13T10:00:00Z", "language": "Python"})

    monkeypatch.setattr(teacher_mod, "_gh_get", fake_get)
    ok = client.get(f"{API}/teacher/repo-check", params={"url": "https://github.com/lee/app"}, headers=teacher).json()
    assert ok["ok"] and ok["last_commit"]["message"] == "Add API" and "No README." in ok["warnings"]
    gone = client.get(f"{API}/teacher/repo-check", params={"url": "https://github.com/lee/missing"}, headers=teacher).json()
    assert not gone["ok"]
    assert not client.get(f"{API}/teacher/repo-check", params={"url": "https://gitlab.com/x/y"}, headers=teacher).json()["ok"]


def test_announcements(client, teacher, learner):
    r = client.post(f"{API}/teacher/announcements", headers=teacher,
                    json={"title": "Office hours moved", "body": "Thursday 4pm.", "pinned": True})
    assert r.status_code == 201
    aid = r.json()["id"]
    assert client.post(f"{API}/teacher/announcements", headers=learner[0], json={"title": "hi"}).status_code == 404
    feed = client.get(f"{API}/announcements", headers=learner[0]).json()["announcements"]
    assert feed[0]["title"] == "Office hours moved" and feed[0]["author"] == "Ms Teacher"
    client.delete(f"{API}/teacher/announcements/{aid}", headers=teacher)
    assert all(a["id"] != aid for a in client.get(f"{API}/announcements", headers=learner[0]).json()["announcements"])
