import os

import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.validation import validate_password

app = FastAPI(title="Новостной агрегатор")
DATABASE_URL = os.environ["DATABASE_URL"]


class User(BaseModel):
    email: str
    password: str


@app.get("/health")
def health():
    with psycopg.connect(DATABASE_URL) as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/news")
def news():
    return [{"id": 1, "title": "Команда настроила CI"}]


@app.post("/api/register")
def register(user: User):
    if not validate_password(user.password):
        raise HTTPException(400, "Пароль должен быть от 8 до 64 символов")
    return {"email": user.email}
