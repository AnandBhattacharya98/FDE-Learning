from app.content import load_weeks

W = "/api/fde/weeks/week-01"


def test_content_loads_and_is_complete():
    w1, w2 = load_weeks()["week-01"], load_weeks()["week-02"]
    assert len(w1.concepts) + len(w2.concepts) == 16
    assert len(w1.quiz) == 18 and len(w2.quiz) == 14
    assert len(w1.voice_quiz) + len(w2.voice_quiz) == 7
    assert [p.id for p in w1.projects] == ["P1"] and [p.id for p in w2.projects] == ["P2"]


def test_week_list_and_detail_hide_answers(client):
    weeks = client.get("/api/fde/weeks").json()
    assert [w["id"] for w in weeks] == ["week-01", "week-02"]
    week = client.get(W).json()
    assert "answer" not in week["quiz"][0]
    assert "explanation" not in week["quiz"][0]
    assert client.get("/api/fde/weeks/week-99").status_code == 404


def test_signup_login_and_me(client):
    r = client.post("/api/fde/auth/signup", json={"email": "Asha@Example.com", "name": "Asha", "password": "longenough"})
    assert r.status_code == 201
    dup = client.post("/api/fde/auth/signup", json={"email": "asha@example.com", "name": "Asha", "password": "longenough"})
    assert dup.status_code == 409
    bad = client.post("/api/fde/auth/login", json={"email": "asha@example.com", "password": "wrong-password"})
    assert bad.status_code == 401
    ok = client.post("/api/fde/auth/login", json={"email": "asha@example.com", "password": "longenough"})
    token = ok.json()["token"]
    me = client.get("/api/fde/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["name"] == "Asha"
    assert client.get("/api/fde/me").status_code == 401
    assert client.get("/api/fde/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_short_password_rejected(client):
    r = client.post("/api/fde/auth/signup", json={"email": "x@example.com", "name": "X", "password": "short"})
    assert r.status_code == 422


def test_quiz_is_graded_on_server_and_best_score_kept(client, auth):
    headers, _ = auth
    week = load_weeks()["week-01"]
    all_right = {q.id: q.answer for q in week.quiz}
    one_wrong = dict(all_right, q01=(week.quiz[0].answer + 1) % 4)

    r = client.post(f"{W}/quiz", json={"answers": one_wrong}, headers=headers)
    assert r.json()["score"] == 17
    assert r.json()["results"][0]["correct"] is False
    client.post(f"{W}/quiz", json={"answers": all_right}, headers=headers)
    client.post(f"{W}/quiz", json={"answers": {}}, headers=headers)

    prog = client.get(f"{W}/progress", headers=headers).json()
    assert prog["quiz"] == {"best": {"score": 18, "total": 18}, "attempts": 3}
    assert client.post(f"{W}/quiz", json={"answers": {}}).status_code == 401


def test_progress_is_per_user(client, auth):
    headers, _ = auth
    assert client.put(f"{W}/projects/P1/steps/0", json={"done": True}, headers=headers).status_code == 200
    client.put(f"{W}/projects/P1/steps/2", json={"done": True}, headers=headers)
    client.put(f"{W}/projects/P1/steps/2", json={"done": False}, headers=headers)
    assert client.put(f"{W}/projects/P1/steps/9", json={"done": True}, headers=headers).status_code == 404
    assert client.put(f"{W}/projects/P9/steps/0", json={"done": True}, headers=headers).status_code == 404

    r = client.put(f"{W}/projects/P1/submission/repo_url", json={"value": "github.com/me/p1"}, headers=headers)
    assert r.status_code == 422
    client.put(f"{W}/projects/P1/submission/repo_url", json={"value": "https://github.com/me/p1"}, headers=headers)
    client.put(f"{W}/projects/P1/submission/repo_url", json={"value": "https://github.com/me/p1-v2"}, headers=headers)

    prog = client.get(f"{W}/progress", headers=headers).json()
    assert prog["projects"]["P1"] == {"steps_done": [0], "submission": {"repo_url": "https://github.com/me/p1-v2"}}

    other = client.post("/api/fde/auth/signup", json={"email": "other@example.com", "name": "O", "password": "longenough"}).json()
    other_prog = client.get(f"{W}/progress", headers={"Authorization": f"Bearer {other['token']}"}).json()
    assert other_prog["projects"]["P1"] == {"steps_done": [], "submission": {}}


def test_voice_quiz_token_needs_livekit_keys(client, auth):
    headers, _ = auth
    r = client.post(f"{W}/voice-quiz/token", headers=headers)
    assert r.status_code == 503


def test_voice_quiz_token_when_configured(client, auth, monkeypatch):
    from app.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "livekit_url", "wss://example.livekit.cloud")
    monkeypatch.setattr(s, "livekit_api_key", "APIexample")
    monkeypatch.setattr(s, "livekit_api_secret", "example-secret-example-secret-example")
    headers, user = auth
    r = client.post(f"{W}/voice-quiz/token", headers=headers)
    assert r.status_code == 200
    assert r.json()["room"] == f"fde-quiz-week-01-u{user['id']}"


def test_voice_result_requires_worker_key(client, auth):
    headers, user = auth
    url = "/api/fde/internal/weeks/week-01/voice-quiz/result"
    body = {"user_id": user["id"], "score": 5, "total": 7}
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, json=body, headers={"x-worker-key": "wrong"}).status_code == 401
    assert client.post(url, json=body, headers={"x-worker-key": "test-worker-key"}).status_code == 201
    prog = client.get(f"{W}/progress", headers=headers).json()
    assert prog["voice_quiz"] == {"best": {"score": 5, "total": 7}, "attempts": 1}
