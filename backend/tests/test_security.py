"""Тесты безопасности. Показывают на лекции 7, что защита проверяется автоматически."""
from app.main import app, db, stored_hash
from fastapi.testclient import TestClient

PASSWORD = "teacher-pass-123"


def reset():
    with db() as conn:
        conn.execute("TRUNCATE settings, sessions, teams RESTART IDENTITY CASCADE")


def admin():
    c = TestClient(app)
    c.post("/api/auth/setup", json={"password": PASSWORD})
    return c


def test_sql_injection_in_name_is_stored_literally():
    """Классическая инъекция в имени команды не ломает БД: запрос параметризован."""
    reset()
    c = admin()
    evil = "Команда'); DROP TABLE teams; --"
    created = c.post("/api/teams", json={"name": evil})
    assert created.status_code == 201
    # таблица цела, имя сохранено как обычный текст, а не выполнено
    teams = c.get("/api/teams").json()
    assert any(t["name"] == evil for t in teams)


def test_password_is_not_stored_in_plaintext():
    """В БД лежит соль и хеш (pbkdf2), а не сам пароль."""
    reset()
    admin()
    with db() as conn:
        value = stored_hash(conn)
    assert value is not None
    assert PASSWORD not in value
    assert "$" in value  # формат salt$hash


def test_wrong_password_is_rejected():
    reset()
    admin()
    other = TestClient(app)
    assert other.post("/api/auth/login", json={"password": "wrong"}).status_code == 401


def test_xss_payload_is_returned_as_data_not_executed():
    """API отдаёт текст как данные JSON. За экранирование в HTML отвечает фронтенд."""
    reset()
    c = admin()
    team = c.post("/api/teams", json={"name": "T"}).json()
    c.post("/api/meetings", json={
        "team_id": team["id"], "kind": "review", "starts_at": "2030-01-01T10:00:00+04:00",
    })
    mid = c.get(f"/api/meetings?team_id={team['id']}").json()[0]["id"]
    payload = "<script>alert(1)</script>"
    c.post(f"/api/meetings/{mid}/notes", json={"text": payload})
    note = c.get(f"/api/meetings/{mid}").json()["notes"][0]
    # хранится дословно; это строка в JSON, а не исполняемый HTML
    assert note["text"] == payload
