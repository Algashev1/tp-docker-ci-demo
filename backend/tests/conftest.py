"""Тесты работают с отдельной базой app_test, чтобы не стирать рабочие данные."""
import os

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo

base = os.environ["DATABASE_URL"]
params = conninfo_to_dict(base)
test_db = params.get("dbname", "app") + "_test"
with psycopg.connect(base, autocommit=True) as conn:
    if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (test_db,)).fetchone():
        conn.execute(f'CREATE DATABASE "{test_db}"')
os.environ["DATABASE_URL"] = make_conninfo(base, dbname=test_db)
