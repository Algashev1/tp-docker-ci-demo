"""Трекер спринт-ревью и бэклог-рефайнментов для команд курса."""
import hashlib
import os
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from app.validation import validate_password

DATABASE_URL = os.environ["DATABASE_URL"]
SESSION_DAYS = 30

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teams (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    project    TEXT NOT NULL DEFAULT '',
    members    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meetings (
    id         SERIAL PRIMARY KEY,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('review', 'refinement')),
    starts_at  TIMESTAMPTZ NOT NULL,
    sprint     INTEGER,
    status     TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notes (
    id         SERIAL PRIMARY KEY,
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meetings_starts_at ON meetings (starts_at);
CREATE INDEX IF NOT EXISTS notes_meeting ON notes (meeting_id);
"""


def db():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


@asynccontextmanager
async def lifespan(_app):
    with db() as conn:
        conn.execute(SCHEMA)
    yield


app = FastAPI(title="Трекер ревью и рефайнментов", lifespan=lifespan)


# ---------- пароль и сессии ----------

def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return f"{salt}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    salt, _ = stored.split("$", 1)
    return secrets.compare_digest(hash_password(password, salt), stored)


def stored_hash(conn):
    row = conn.execute("SELECT value FROM settings WHERE key = 'admin_password'").fetchone()
    return row["value"] if row else None


def start_session(conn, response: Response):
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (token) VALUES (%s)", (token,))
    response.set_cookie("session", token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax")


def is_authenticated(conn, request: Request) -> bool:
    token = request.cookies.get("session")
    if not token:
        return False
    row = conn.execute(
        "SELECT 1 FROM sessions WHERE token = %s AND created_at > now() - %s::interval",
        (token, f"{SESSION_DAYS} days"),
    ).fetchone()
    return row is not None


def require_auth(request: Request):
    with db() as conn:
        if not is_authenticated(conn, request):
            raise HTTPException(401, "Нужно войти")


class PasswordIn(BaseModel):
    password: str


@app.get("/health")
def health():
    with db() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/auth/status")
def auth_status(request: Request):
    with db() as conn:
        return {"configured": stored_hash(conn) is not None, "authenticated": is_authenticated(conn, request)}


@app.post("/api/auth/setup")
def auth_setup(body: PasswordIn, response: Response):
    if not validate_password(body.password):
        raise HTTPException(400, "Пароль должен быть от 8 до 64 символов")
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO settings (key, value) VALUES ('admin_password', %s) ON CONFLICT DO NOTHING",
            (hash_password(body.password),),
        )
        if cur.rowcount == 0:
            raise HTTPException(409, "Пароль уже задан")
        start_session(conn, response)
    return {"ok": True}


@app.post("/api/auth/login")
def auth_login(body: PasswordIn, response: Response):
    with db() as conn:
        stored = stored_hash(conn)
        if not stored or not check_password(body.password, stored):
            time.sleep(1)  # замедляем подбор пароля
            raise HTTPException(401, "Неверный пароль")
        start_session(conn, response)
    return {"ok": True}


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE token = %s", (request.cookies.get("session", ""),))
    response.delete_cookie("session")
    return {"ok": True}


# ---------- команды ----------

class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    project: str = Field(default="", max_length=200)
    members: str = Field(default="", max_length=2000)


TEAM_SELECT = """
SELECT t.*,
  (SELECT min(starts_at) FROM meetings m WHERE m.team_id = t.id AND m.kind = 'review'
     AND m.status = 'planned' AND m.starts_at >= now() - interval '2 hours') AS next_review,
  (SELECT min(starts_at) FROM meetings m WHERE m.team_id = t.id AND m.kind = 'refinement'
     AND m.status = 'planned' AND m.starts_at >= now() - interval '2 hours') AS next_refinement,
  (SELECT count(*) FROM meetings m WHERE m.team_id = t.id AND m.status = 'done') AS done_count,
  (SELECT n.text FROM notes n JOIN meetings m ON m.id = n.meeting_id
     WHERE m.team_id = t.id ORDER BY n.created_at DESC LIMIT 1) AS last_note
FROM teams t
"""


@app.get("/api/teams")
def list_teams():
    with db() as conn:
        return conn.execute(TEAM_SELECT + " ORDER BY t.name").fetchall()


@app.post("/api/teams", dependencies=[Depends(require_auth)], status_code=201)
def create_team(team: TeamIn):
    with db() as conn:
        return conn.execute(
            "INSERT INTO teams (name, project, members) VALUES (%s, %s, %s) RETURNING *",
            (team.name.strip(), team.project.strip(), team.members.strip()),
        ).fetchone()


@app.get("/api/teams/{team_id}")
def get_team(team_id: int):
    with db() as conn:
        team = conn.execute(TEAM_SELECT + " WHERE t.id = %s", (team_id,)).fetchone()
        if not team:
            raise HTTPException(404, "Команда не найдена")
        return team


@app.put("/api/teams/{team_id}", dependencies=[Depends(require_auth)])
def update_team(team_id: int, team: TeamIn):
    with db() as conn:
        row = conn.execute(
            "UPDATE teams SET name = %s, project = %s, members = %s WHERE id = %s RETURNING *",
            (team.name.strip(), team.project.strip(), team.members.strip(), team_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Команда не найдена")
        return row


@app.delete("/api/teams/{team_id}", dependencies=[Depends(require_auth)], status_code=204)
def delete_team(team_id: int):
    with db() as conn:
        conn.execute("DELETE FROM teams WHERE id = %s", (team_id,))


# ---------- встречи ----------

Kind = Literal["review", "refinement"]
Status = Literal["planned", "done", "cancelled"]


class MeetingIn(BaseModel):
    team_id: int
    kind: Kind
    starts_at: datetime
    sprint: Optional[int] = Field(default=None, ge=0, le=100)
    status: Status = "planned"
    repeat_weeks: int = Field(default=0, ge=0, le=8)
    repeat_count: int = Field(default=1, ge=1, le=20)


class MeetingUpdate(BaseModel):
    kind: Kind
    starts_at: datetime
    sprint: Optional[int] = Field(default=None, ge=0, le=100)
    status: Status


MEETING_SELECT = """
SELECT m.*, t.name AS team_name,
  (SELECT count(*) FROM notes n WHERE n.meeting_id = m.id) AS notes_count
FROM meetings m JOIN teams t ON t.id = m.team_id
"""


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@app.get("/api/meetings")
def list_meetings(team_id: Optional[int] = None, date_from: Optional[datetime] = None,
                  date_to: Optional[datetime] = None):
    where, params = [], []
    if team_id is not None:
        where.append("m.team_id = %s")
        params.append(team_id)
    if date_from is not None:
        where.append("m.starts_at >= %s")
        params.append(aware(date_from))
    if date_to is not None:
        where.append("m.starts_at < %s")
        params.append(aware(date_to))
    sql = MEETING_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY m.starts_at"
    with db() as conn:
        return conn.execute(sql, params).fetchall()


@app.post("/api/meetings", dependencies=[Depends(require_auth)], status_code=201)
def create_meetings(m: MeetingIn):
    created = []
    with db() as conn:
        if not conn.execute("SELECT 1 FROM teams WHERE id = %s", (m.team_id,)).fetchone():
            raise HTTPException(404, "Команда не найдена")
        count = m.repeat_count if m.repeat_weeks else 1
        for i in range(count):
            starts = aware(m.starts_at) + timedelta(weeks=m.repeat_weeks * i)
            sprint = m.sprint + i if m.sprint is not None else None
            created.append(conn.execute(
                "INSERT INTO meetings (team_id, kind, starts_at, sprint, status) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (m.team_id, m.kind, starts, sprint, m.status),
            ).fetchone()["id"])
    return {"created": created}


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: int):
    with db() as conn:
        meeting = conn.execute(MEETING_SELECT + " WHERE m.id = %s", (meeting_id,)).fetchone()
        if not meeting:
            raise HTTPException(404, "Встреча не найдена")
        meeting["notes"] = conn.execute(
            "SELECT * FROM notes WHERE meeting_id = %s ORDER BY created_at", (meeting_id,)
        ).fetchall()
        return meeting


@app.put("/api/meetings/{meeting_id}", dependencies=[Depends(require_auth)])
def update_meeting(meeting_id: int, m: MeetingUpdate):
    with db() as conn:
        row = conn.execute(
            "UPDATE meetings SET kind = %s, starts_at = %s, sprint = %s, status = %s WHERE id = %s RETURNING *",
            (m.kind, aware(m.starts_at), m.sprint, m.status, meeting_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Встреча не найдена")
        return row


@app.delete("/api/meetings/{meeting_id}", dependencies=[Depends(require_auth)], status_code=204)
def delete_meeting(meeting_id: int):
    with db() as conn:
        conn.execute("DELETE FROM meetings WHERE id = %s", (meeting_id,))


# ---------- комментарии по итогам встреч ----------

class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@app.post("/api/meetings/{meeting_id}/notes", dependencies=[Depends(require_auth)], status_code=201)
def add_note(meeting_id: int, note: NoteIn):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM meetings WHERE id = %s", (meeting_id,)).fetchone():
            raise HTTPException(404, "Встреча не найдена")
        return conn.execute(
            "INSERT INTO notes (meeting_id, text) VALUES (%s, %s) RETURNING *",
            (meeting_id, note.text.strip()),
        ).fetchone()


@app.delete("/api/notes/{note_id}", dependencies=[Depends(require_auth)], status_code=204)
def delete_note(note_id: int):
    with db() as conn:
        conn.execute("DELETE FROM notes WHERE id = %s", (note_id,))
