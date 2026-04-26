"""Shared pytest fixtures for backend tests (M0.1.1).

The big trick here: env vars must be set BEFORE `from main import app` runs,
because main.py calls `load_dotenv()` and instantiates the SQLModel engine at
import time. We pin a throwaway SQLite DB + dummy keys via `_set_test_env`
which runs at module-import time (before any fixture body), then alias `app`
to a session-scoped fixture so every test shares the same engine.

`current_user_override` lets each test pin who the request comes from. Default
is USER_A; tests that need other identities call `current_user_override(USER_B)`.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# ---- env setup MUST run before importing main -----------------------------
# Use a throwaway tempdir for the SQLite file + uploads root so tests never
# touch the dev DB or live Supabase. `DATABASE_URL=""` short-circuits the
# Postgres branch in db/session.py — load_dotenv (override=False) won't
# clobber a value that's already set, so this also defeats backend/.env.
_TMPDIR = Path(tempfile.mkdtemp(prefix="storyforge_pytest_"))
os.environ["STORYFORGE_DB"] = str(_TMPDIR / "test.db")
os.environ["STORYFORGE_UPLOAD_DIR"] = str(_TMPDIR / "uploads")
os.environ["DATABASE_URL"] = ""
os.environ["ANTHROPIC_API_KEY"] = ""  # force mock mode in extract.py
# These three are required at import time but the value doesn't matter for tests
# (we either stub the things that read them or never trigger that code path).
os.environ.setdefault("CLERK_PUBLISHABLE_KEY", "pk_test_dummy")
os.environ.setdefault("STORYFORGE_MASTER_KEY", "test-master-key-only")
# LSQ — populated so services/lsq.variant_for() resolves the test variant ids.
# We don't hit LSQ from inside the test suite (we monkey-patch
# create_checkout_url where needed), but the env-var lookups need values.
os.environ.setdefault("LSQ_WEBHOOK_SECRET", "test-webhook-secret-pytest")
os.environ.setdefault("LSQ_API_KEY", "test-lsq-api-key")
os.environ.setdefault("LSQ_STORE_ID", "999999")
os.environ.setdefault("LSQ_VARIANT_STARTER_MONTHLY", "1000001")
os.environ.setdefault("LSQ_VARIANT_STARTER_ANNUAL", "1000002")
os.environ.setdefault("LSQ_VARIANT_PRO_MONTHLY", "1000003")
os.environ.setdefault("LSQ_VARIANT_PRO_ANNUAL", "1000004")
os.environ.setdefault("LSQ_VARIANT_TEAM_MONTHLY", "1000005")
os.environ.setdefault("LSQ_VARIANT_TEAM_ANNUAL", "1000006")

# Make `backend/` importable so tests can do `from auth.deps import ...`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ---------------------------------------------------------------------------

import pytest
from fastapi.testclient import TestClient

from auth.deps import CurrentUser, current_user
from main import app
from services import email as email_mod
from services import onboarding as onb_mod


# ---- stubbed identities ---------------------------------------------------

USER_A = CurrentUser(user_id="user_pytest_aaa")
USER_B = CurrentUser(user_id="user_pytest_bbb")
USER_C_IN_ORG_X = CurrentUser(user_id="user_pytest_ccc", org_id="org_pytest_xxx")
USER_D_IN_ORG_X = CurrentUser(user_id="user_pytest_ddd", org_id="org_pytest_xxx")
USER_E_IN_ORG_Y = CurrentUser(user_id="user_pytest_eee", org_id="org_pytest_yyy")
USER_A_IN_ORG_X = CurrentUser(user_id="user_pytest_aaa", org_id="org_pytest_xxx")  # A switched into X


# Mutable holder so a single dependency_override can dispatch to whichever
# identity the current test wants. Default to A; tests rebind via the
# `as_user` fixture.
_active_user: CurrentUser = USER_A


def _override_current_user() -> CurrentUser:
    return _active_user


app.dependency_overrides[current_user] = _override_current_user


# ---- fixtures -------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _ensure_schema():
    """Create the schema once per session so per-test cleanup fixtures (which
    run before any `client` fixture lifespan) can DELETE from real tables.

    Without this, modules whose autouse cleanup runs before any client-using
    test would error with "no such table: usage_log".
    """
    from db.session import init_db
    init_db()
    yield


@pytest.fixture(autouse=True)
def _stub_third_party_io(monkeypatch):
    """Block tests from accidentally hitting Clerk / Resend over the network.

    Welcome path (services/email + services/onboarding) is the most common
    accidental egress because welcome_check fires on every authed request.
    Both modules import the helpers at module load, so we have to patch in
    both places.
    """
    fake_clerk = lambda uid: {"id": uid, "first_name": "Pytest", "email_addresses": [], "primary_email_address_id": None}
    fake_send = lambda *a, **kw: True
    monkeypatch.setattr(email_mod, "fetch_clerk_user", fake_clerk)
    monkeypatch.setattr(email_mod, "send_welcome_email", fake_send)
    monkeypatch.setattr(onb_mod, "fetch_clerk_user", fake_clerk)
    monkeypatch.setattr(onb_mod, "send_welcome_email", fake_send)


@pytest.fixture
def client():
    """A TestClient bound to the FastAPI app. Use `with` form so lifespan
    fires (which runs init_db and creates the schema)."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def as_user():
    """Returns a callable that switches the current_user dependency override.

    Usage:
        def test_x(client, as_user):
            as_user(USER_B)
            ...
    """
    def _set(user: CurrentUser) -> None:
        global _active_user
        _active_user = user
    yield _set
    # Reset to A between tests so leakage is impossible.
    _set(USER_A)


@pytest.fixture
def reset_db():
    """Drop + recreate all tables. Use sparingly — most tests should design
    around per-user scoping rather than full reset. SQLite-only (we never
    point pytest at Postgres)."""
    from db.session import SQLModel, engine
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    yield
