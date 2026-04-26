"""Plan-limit + paywall enforcement tests (M3.5).

Each test trips one of the four gates in `services/limits.enforce_limits`:
  - trial_expired (403)
  - model_not_allowed (403)
  - doc_too_large (413)
  - monthly_limit (429)

Plus the happy path on a paid tier and the /api/me/plan reporting shape.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session

from db.models import UsageLog, UserSettings
from db.session import engine
from tests.conftest import USER_A


@pytest.fixture(autouse=True)
def _reset_a_settings():
    """Each test in this module starts with USER_A on a fresh trial.

    welcome_check writes plan='trial' on first authed touch — but if a
    previous test already triggered it, the row carries over with stale
    state. Wipe per-test to keep the gates deterministic.
    """
    from sqlalchemy import text
    with Session(engine) as s:
        s.execute(text("DELETE FROM usage_log WHERE user_id = :uid"), {"uid": USER_A.user_id})
        s.execute(text("DELETE FROM extraction WHERE user_id = :uid"), {"uid": USER_A.user_id})
        s.execute(text("DELETE FROM user_settings WHERE user_id = :uid"), {"uid": USER_A.user_id})
        s.commit()
    yield


def test_initial_trial_state(client, as_user):
    as_user(USER_A)
    p = client.get("/api/me/plan").json()
    assert p["plan"] == "trial"
    assert p["plan_name"] == "Trial"
    assert p["extractions_per_period"] == 10
    assert p["usage_in_period"] == 0
    assert p["allowed_models"] == ["claude-sonnet-4-6"]


def test_model_not_allowed_on_trial(client, as_user):
    """Opus is gated behind Pro+; trying it on Trial should 403."""
    as_user(USER_A)
    client.get("/api/me/plan")  # bootstrap welcome_check + trial init

    r = client.post(
        "/api/extract",
        data={"text": "small doc", "filename": "x.txt"},
        headers={"X-Storyforge-Model": "claude-opus-4-7"},
    )
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert detail["paywall"] is True
    assert detail["reason"] == "model_not_allowed"
    assert detail["upgrade_to"] == "starter"
    assert detail["requested_model"] == "claude-opus-4-7"


def test_doc_too_large_on_trial(client, as_user):
    """Trial caps at 200k chars (~50k tokens, ~25 pages)."""
    as_user(USER_A)
    client.get("/api/me/plan")

    huge = "z" * 250_000
    r = client.post("/api/extract", data={"text": huge, "filename": "huge.txt"})
    assert r.status_code == 413
    detail = r.json()["detail"]
    assert detail["paywall"] is True
    assert detail["reason"] == "doc_too_large"
    assert detail["doc_chars"] > 200_000
    assert detail["max_chars"] == 200_000
    assert detail["max_pages_estimate"] == 100  # 200k / 2000


def test_monthly_limit_when_quota_exhausted(client, as_user):
    """Inject 10 fake usage rows to fill the trial cap, then the next extract 429s."""
    as_user(USER_A)
    client.get("/api/me/plan")  # creates user_settings, sets trial_ends_at

    # Inject 10 rows of UsageLog directly — faster than running 10 extractions
    with Session(engine) as s:
        for _ in range(10):
            s.add(UsageLog(user_id=USER_A.user_id, action="extract", model="mock", live=False))
        s.commit()

    r = client.post("/api/extract", data={"text": "small", "filename": "x.txt"})
    assert r.status_code == 429
    detail = r.json()["detail"]
    assert detail["paywall"] is True
    assert detail["reason"] == "monthly_limit"
    assert detail["current_usage"] == 10
    assert detail["limit"] == 10


def test_trial_expired_flips_plan(client, as_user):
    """When trial_ends_at is in the past, the gate flips plan to 'expired'
    on the next request and 403s."""
    as_user(USER_A)
    client.get("/api/me/plan")  # bootstrap

    # Back-date trial_ends_at to yesterday
    with Session(engine) as s:
        row = s.get(UserSettings, USER_A.user_id)
        row.trial_ends_at = datetime.now(timezone.utc) - timedelta(days=1)
        s.add(row)
        s.commit()

    r = client.post("/api/extract", data={"text": "small", "filename": "x.txt"})
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert detail["paywall"] is True
    assert detail["reason"] == "trial_expired"
    assert detail["upgrade_to"] == "starter"

    # Side-effect: plan flipped to 'expired' so subsequent calls don't keep
    # paying the timestamp-comparison cost.
    with Session(engine) as s:
        assert s.get(UserSettings, USER_A.user_id).plan == "expired"


def test_happy_path_on_starter(client, as_user):
    """Manually flip user to Starter, run a small mock extraction, succeed."""
    as_user(USER_A)
    client.get("/api/me/plan")

    with Session(engine) as s:
        row = s.get(UserSettings, USER_A.user_id)
        row.plan = "starter"
        row.trial_ends_at = None
        s.add(row)
        s.commit()

    r = client.post("/api/extract", data={"text": "happy path", "filename": "ok.txt"})
    assert r.status_code == 200, r.text

    p = client.get("/api/me/plan").json()
    assert p["plan"] == "starter"
    assert p["usage_in_period"] == 1
    assert p["extractions_per_period"] == 25
