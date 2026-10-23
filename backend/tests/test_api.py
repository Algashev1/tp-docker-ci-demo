"""Интеграционные тесты API. Запускаются в CI внутри контейнера, где доступна БД."""
from fastapi.testclient import TestClient

from app.main import app, db

PASSWORD = "test-password-123"


def client():
    return TestClient(app)


def login(c):
    with db() as conn:
        conn.execute("TRUNCATE settings, sessions, teams RESTART IDENTITY CASCADE")
    assert c.post("/api/auth/setup", json={"password": PASSWORD}).status_code == 200


def test_read_is_public_write_requires_login():
    with client() as c:
        with db() as conn:
            conn.execute("TRUNCATE settings, sessions, teams RESTART IDENTITY CASCADE")
        assert c.get("/api/auth/status").json() == {"configured": False, "authenticated": False}
        assert c.get("/api/teams").status_code == 200
        assert c.get("/api/meetings").status_code == 200
        assert c.post("/api/teams", json={"name": "Команда 1"}).status_code == 401
        assert c.post("/api/meetings/1/notes", json={"text": "x"}).status_code == 401
        assert c.delete("/api/teams/1").status_code == 401


def test_guest_sees_data_but_cannot_change_it():
    with client() as teacher:
        login(teacher)
        team = teacher.post("/api/teams", json={"name": "Команда 2"}).json()
    with client() as guest:
        assert [t["name"] for t in guest.get("/api/teams").json()] == ["Команда 2"]
        assert guest.put(f"/api/teams/{team['id']}", json={"name": "Взлом"}).status_code == 401
        assert guest.get(f"/api/teams/{team['id']}").json()["name"] == "Команда 2"


def test_setup_only_once_and_login():
    with client() as c:
        login(c)
        assert c.post("/api/auth/setup", json={"password": "another-pass"}).status_code == 409
    with client() as other:
        assert other.post("/api/auth/login", json={"password": "wrong-pass"}).status_code == 401
        assert other.post("/api/auth/login", json={"password": PASSWORD}).status_code == 200
        assert other.get("/api/auth/status").json()["authenticated"] is True


def test_short_password_rejected():
    with client() as c:
        with db() as conn:
            conn.execute("TRUNCATE settings, sessions, teams RESTART IDENTITY CASCADE")
        assert c.post("/api/auth/setup", json={"password": "short"}).status_code == 400


def test_team_meetings_and_notes():
    with client() as c:
        login(c)
        team = c.post("/api/teams", json={"name": "Команда 1", "project": "Агрегатор"}).json()

        r = c.post("/api/meetings", json={
            "team_id": team["id"], "kind": "review", "starts_at": "2030-02-03T10:00:00+04:00",
            "sprint": 1, "repeat_weeks": 2, "repeat_count": 3,
        })
        assert r.status_code == 201
        ids = r.json()["created"]
        assert len(ids) == 3

        meetings = c.get(f"/api/meetings?team_id={team['id']}").json()
        assert [m["sprint"] for m in meetings] == [1, 2, 3]

        note = c.post(f"/api/meetings/{ids[0]}/notes", json={"text": "Показали MVP, PO доволен"})
        assert note.status_code == 201
        meeting = c.get(f"/api/meetings/{ids[0]}").json()
        assert meeting["notes"][0]["text"] == "Показали MVP, PO доволен"

        teams = c.get("/api/teams").json()
        assert teams[0]["last_note"] == "Показали MVP, PO доволен"
        assert teams[0]["next_review"] is not None

        assert c.delete(f"/api/teams/{team['id']}").status_code == 204
        assert c.get(f"/api/meetings/{ids[0]}").status_code == 404
