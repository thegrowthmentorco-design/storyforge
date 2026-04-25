"""DB engine + FastAPI session dependency.

Two engines, one config:
  * `DATABASE_URL` set  → Postgres (M3.2 — currently Supabase). Use the
    `postgresql+psycopg://...` form so SQLAlchemy picks psycopg3, not the
    legacy psycopg2 default.
  * Unset              → SQLite at `STORYFORGE_DB` (default `backend/storyforge.db`).
                         Dev fallback; survives across machines if you copy the file.

Synchronous SQLModel sessions either way. Async (asyncpg / aiosqlite) is a
later optimisation if route latency starts mattering — sync handles our
"one DB write per extraction" workload comfortably.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy.engine import URL, make_url
from sqlmodel import Session, SQLModel, create_engine

# Import models so SQLModel.metadata sees them before create_all runs.
from . import models  # noqa: F401

log = logging.getLogger("storyforge.db")


def _resolve_db_url() -> URL:
    raw = os.environ.get("DATABASE_URL")
    if raw:
        # SQLAlchemy 2.x defaults `postgresql://` to psycopg2; force psycopg3.
        if raw.startswith("postgresql://"):
            raw = "postgresql+psycopg://" + raw[len("postgresql://"):]
        return make_url(raw)
    # SQLite fallback. Path is repo-local so two devs can share a `.db` file
    # without env-var coordination.
    db_path = Path(
        os.environ.get(
            "STORYFORGE_DB",
            str(Path(__file__).resolve().parent.parent / "storyforge.db"),
        )
    )
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return make_url(f"sqlite:///{db_path}")


DB_URL: URL = _resolve_db_url()
IS_SQLITE = DB_URL.get_dialect().name == "sqlite"

# SQLite needs check_same_thread=False because FastAPI runs sync routes on
# its threadpool; the engine pool may hand a connection to a different
# thread than the one that opened it. Postgres has no such constraint.
_connect_args: dict = {"check_same_thread": False} if IS_SQLITE else {}

engine = create_engine(DB_URL, echo=False, connect_args=_connect_args, pool_pre_ping=not IS_SQLITE)


def init_db() -> None:
    """Create all tables + apply tiny additive migrations. Idempotent.

    `create_all` is safe to call on every startup — it only creates *missing*
    tables. For columns added to existing tables we run a guarded ALTER (see
    `_apply_soft_migrations`) — but only on SQLite, since Postgres goes
    through Alembic (M3.2.5) when its first real schema change lands.
    """
    SQLModel.metadata.create_all(engine)
    if IS_SQLITE:
        _apply_soft_migrations()
    log.info(
        "DB ready (%s) — tables: %s",
        DB_URL.render_as_string(hide_password=True),
        sorted(SQLModel.metadata.tables.keys()),
    )


def _apply_soft_migrations() -> None:
    """SQLite-only ALTER TABLEs for columns added after the initial schema.

    Postgres skips this — it gets a clean schema from `create_all` on first
    boot, and incremental changes go through Alembic.
    """
    with engine.connect() as conn:
        ext_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(extraction)").fetchall()}
        if "root_id" not in ext_cols:
            log.info("migrating: adding extraction.root_id (M2.6)")
            conn.exec_driver_sql("ALTER TABLE extraction ADD COLUMN root_id VARCHAR")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_extraction_root_id ON extraction (root_id)")
            conn.commit()
        if "user_id" not in ext_cols:
            log.info("migrating: adding extraction.user_id (M3.2)")
            conn.exec_driver_sql("ALTER TABLE extraction ADD COLUMN user_id VARCHAR NOT NULL DEFAULT 'local'")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_extraction_user_id ON extraction (user_id)")
            conn.commit()

        proj_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(project)").fetchall()}
        if "user_id" not in proj_cols:
            log.info("migrating: adding project.user_id (M3.2)")
            conn.exec_driver_sql("ALTER TABLE project ADD COLUMN user_id VARCHAR NOT NULL DEFAULT 'local'")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_project_user_id ON project (user_id)")
            conn.commit()


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a session that auto-closes after the request."""
    with Session(engine) as session:
        yield session
