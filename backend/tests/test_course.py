from app.content import load_weeks

API = "/api/fde"
W = f"{API}/weeks/week-01"


def test_syllabus_lists_six_weeks_with_two_open(client):
    c = client.get(f"{API}/course").json()
    assert [w["number"] for w in c["weeks"]] == [1, 2, 3, 4, 5, 6]
    assert [w["open"] for w in c["weeks"]] == [True, True, False, False, False, False]
    assert c["weeks"][0]["modules"][0]["title"] == "Start here"


def test_every_week_starts_with_overview_and_ends_with_assessment():
    for week in load_weeks().values():
        assert week.modules[0].items[0].type == "overview"
        assert [i.type for i in week.modules[-1].items] == ["quiz", "project", "voice"]


def test_manual_items_complete_and_uncomplete(client, auth):
    headers, _ = auth
    assert client.put(f"{W}/items/lesson-restaurant/complete", json={"done": True}, headers=headers).status_code == 200
    client.put(f"{W}/items/overview/complete", json={"done": True}, headers=headers)
    client.put(f"{W}/items/overview/complete", json={"done": False}, headers=headers)
    p = client.get(f"{W}/items/progress", headers=headers).json()
    assert p["items_done"] == ["lesson-restaurant"]
    assert client.put(f"{W}/items/graded-quiz/complete", json={"done": True}, headers=headers).status_code == 409
    assert client.put(f"{W}/items/nope/complete", json={"done": True}, headers=headers).status_code == 404


def test_practice_completes_on_any_try_and_graded_needs_a_pass(client, auth):
    headers, _ = auth
    week = load_weeks()["week-01"]
    practice = week.item("practice-m1")
    r = client.post(f"{W}/items/practice-m1/quiz", json={"answers": {}}, headers=headers).json()
    assert r["score"] == 0 and r["total"] == len(practice.refs)

    right = {q.id: q.answer for q in week.quiz}
    wrong = {q.id: (q.answer + 1) % len(q.options) for q in week.quiz}
    half = {qid: (right if i % 2 else wrong)[qid] for i, qid in enumerate(right)}
    r = client.post(f"{W}/items/graded-quiz/quiz", json={"answers": half}, headers=headers).json()
    assert r["passed"] is False and r["total"] == 18
    assert "graded-quiz" not in client.get(f"{W}/items/progress", headers=headers).json()["items_done"]

    r = client.post(f"{W}/items/graded-quiz/quiz", json={"answers": right}, headers=headers).json()
    assert r["passed"] is True
    p = client.get(f"{W}/items/progress", headers=headers).json()
    assert {"practice-m1", "graded-quiz"} <= set(p["items_done"])
    assert p["quiz"]["best"] == {"score": 18, "total": 18}  # practice tries don't count as graded
    assert client.post(f"{W}/items/lesson-frontend/quiz", json={"answers": {}}, headers=headers).status_code == 404


def test_project_item_completes_when_all_steps_ticked(client, auth):
    headers, _ = auth
    for i in range(4):
        client.put(f"{W}/projects/P1/steps/{i}", json={"done": True}, headers=headers)
    p = client.get(f"{W}/items/progress", headers=headers).json()
    assert "project-p1" in p["items_done"]
    totals = client.get(f"{API}/course/progress", headers=headers).json()
    assert totals["week-01"]["done"] == 1 and totals["week-01"]["total"] == 18
