"""Create the local AI-Cam PostgreSQL database and schema (idempotent).

Creating a database requires a PostgreSQL superuser. The script asks for that
password interactively (or accepts --password / PGPASSWORD), then creates the
``aicam`` database owned by the app user and applies sql/aicam_schema.sql.

Usage:
    .\\.venv\\Scripts\\python.exe scripts\\init_aicam_db.py
    .\\.venv\\Scripts\\python.exe scripts\\init_aicam_db.py --admin-dsn "postgresql://postgres@localhost:5432/postgres"
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DEFAULT_AICAM_DSN  # noqa: E402

SCHEMA_FILE = Path(__file__).resolve().parent.parent / "sql" / "aicam_schema.sql"


def _connect(dsn: str, password: str | None):
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT, make_dsn

    if password:
        dsn = make_dsn(dsn, password=password)
    conn = psycopg2.connect(dsn, connect_timeout=10)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    return conn


def _admin_password(admin_dsn: str, explicit: str | None) -> str | None:
    if explicit:
        return explicit
    if os.environ.get("PGPASSWORD"):
        return None  # psycopg2/libpq will pick it up
    if "password=" in admin_dsn:
        return None
    return getpass.getpass("PostgreSQL superuser password: ")


def _database_exists(conn, name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
        return cur.fetchone() is not None


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the AI-Cam database and schema")
    parser.add_argument("--admin-dsn", default="postgresql://postgres@localhost:5432/postgres",
                        help="superuser connection to the 'postgres' maintenance database")
    parser.add_argument("--password", default=None, help="superuser password (else prompt)")
    parser.add_argument("--database", default="aicam")
    parser.add_argument("--owner", default="monitoring")
    parser.add_argument("--app-dsn", default=os.environ.get("AICAM_DATABASE_URL", DEFAULT_AICAM_DSN),
                        help="connection string the app will use (must include the app user's password)")
    args = parser.parse_args()

    import psycopg2
    from psycopg2 import sql

    if not SCHEMA_FILE.exists():
        print(f"ERROR: schema file not found: {SCHEMA_FILE}")
        return 2

    pwd = _admin_password(args.admin_dsn, args.password)
    print(f"Connecting to {args.admin_dsn} ...")
    try:
        admin = _connect(args.admin_dsn, pwd)
    except Exception as exc:
        print(f"ERROR: could not connect as superuser: {exc}")
        return 2

    try:
        with admin.cursor() as cur:
            if _database_exists(admin, args.database):
                print(f"Database '{args.database}' already exists; leaving it in place.")
            else:
                cur.execute(
                    sql.SQL("CREATE DATABASE {} OWNER {}").format(
                        sql.Identifier(args.database), sql.Identifier(args.owner)
                    )
                )
                print(f"Created database '{args.database}' owned by '{args.owner}'.")
            cur.execute(
                sql.SQL("GRANT ALL PRIVILEGES ON DATABASE {} TO {}").format(
                    sql.Identifier(args.database), sql.Identifier(args.owner)
                )
            )
    finally:
        admin.close()

    print(f"Applying schema via app connection ({args.app_dsn}) ...")
    try:
        app_conn = _connect(args.app_dsn, None)
    except Exception as exc:
        print(f"ERROR: could not connect as app user: {exc}")
        return 2

    try:
        schema_sql = SCHEMA_FILE.read_text(encoding="utf-8")
        with app_conn.cursor() as cur:
            cur.execute(schema_sql)
        print("Schema applied: events, streams, alembic_version, indexes.")
    finally:
        app_conn.close()

    print("\nDone. Set backend/.env AICAM_DATABASE_URL to:")
    print(f"  AICAM_DATABASE_URL=\"{args.app_dsn}\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
