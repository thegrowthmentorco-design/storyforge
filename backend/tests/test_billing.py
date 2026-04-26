"""Lemon Squeezy billing tests (M3.6).

Covers:
  - Variant resolution (forward + reverse)
  - Webhook signature verification (rejects bad sig, accepts good)
  - Subscription lifecycle: created -> updated -> cancelled -> expired
  - Missing user_id in webhook payload is a 200 noop (LSQ won't retry)

We do NOT make real LSQ API calls in this suite — `test_billing.py` does
not exercise the create_checkout_url / customer_portal_url paths because
those hit the live Resend & LSQ servers. Those are covered by manual
smoke runs that we intentionally don't put in CI (would require real
LSQ creds in GH secrets, plus they'd cost API quota on every push).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlmodel import Session

from db.models import UserSettings
from db.session import engine
from services import lsq
from tests.conftest import USER_A


WEBHOOK_SECRET = os.environ["LSQ_WEBHOOK_SECRET"].encode("utf-8")


def _sign(payload: dict) -> tuple[bytes, str]:
    raw = json.dumps(payload).encode("utf-8")
    sig = hmac.new(WEBHOOK_SECRET, raw, hashlib.sha256).hexdigest()
    return raw, sig


@pytest.fixture(autouse=True)
def _reset_a_settings():
    with Session(engine) as s:
        s.execute(text("DELETE FROM user_settings WHERE user_id = :uid"), {"uid": USER_A.user_id})
        s.commit()
    yield


# ---- variant resolution (no network) -------------------------------------


def test_variant_for_starter_monthly():
    t = lsq.variant_for("starter", "monthly")
    assert t is not None
    assert t.variant_id == "1000001"  # from conftest test env
    assert t.plan_id == "starter"
    assert t.interval == "monthly"


def test_variant_for_pro_annual():
    t = lsq.variant_for("pro", "annual")
    assert t is not None
    assert t.variant_id == "1000004"
    assert t.plan_id == "pro"


def test_variant_for_unknown_tier_returns_none():
    assert lsq.variant_for("platinum", "monthly") is None
    assert lsq.variant_for("starter", "weekly") is None


def test_variant_to_plan_reverse_lookup():
    assert lsq.variant_to_plan("1000001") == "starter"
    assert lsq.variant_to_plan("1000004") == "pro"
    assert lsq.variant_to_plan("1000005") == "team"
    assert lsq.variant_to_plan("9999999") is None


# ---- webhook signature -----------------------------------------------------


def test_webhook_rejects_bad_signature(client):
    r = client.post(
        "/api/webhooks/lemonsqueezy",
        content=b'{"meta":{"event_name":"test"}}',
        headers={"X-Signature": "deadbeef"},
    )
    assert r.status_code == 401


def test_webhook_accepts_signed_but_missing_user_id(client):
    """Webhook with valid sig but no user_id -> noop 200 so LSQ doesn't retry."""
    raw, sig = _sign({"meta": {"event_name": "subscription_created", "custom_data": {}}, "data": {}})
    r = client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})
    assert r.status_code == 200
    assert r.json().get("noop") == "missing_user_id"


# ---- subscription lifecycle -----------------------------------------------


def _sub_payload(event: str, *, variant_id: int, status: str = "active", **extras) -> dict:
    """Build a fake LSQ webhook payload for USER_A."""
    attrs = {
        "customer_id": "cust_pytest",
        "variant_id": variant_id,
        "renews_at": "2026-12-01T00:00:00Z",
        "status": status,
    }
    attrs.update(extras)
    return {
        "meta": {"event_name": event, "custom_data": {"user_id": USER_A.user_id}},
        "data": {"id": "sub_pytest", "type": "subscriptions", "attributes": attrs},
    }


def test_subscription_created_flips_plan(client):
    raw, sig = _sign(_sub_payload("subscription_created", variant_id=1000001))  # starter monthly
    r = client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})
    assert r.status_code == 200
    with Session(engine) as s:
        row = s.get(UserSettings, USER_A.user_id)
        assert row.plan == "starter"
        assert row.lsq_subscription_id == "sub_pytest"
        assert row.lsq_customer_id == "cust_pytest"
        assert row.plan_renews_at is not None


def test_subscription_updated_upgrades_tier(client):
    # Start at starter
    raw, sig = _sign(_sub_payload("subscription_created", variant_id=1000001))
    client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})

    # Then receive an update with a Pro variant_id
    raw, sig = _sign(_sub_payload("subscription_updated", variant_id=1000003))  # pro monthly
    r = client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})
    assert r.status_code == 200
    with Session(engine) as s:
        assert s.get(UserSettings, USER_A.user_id).plan == "pro"


def test_subscription_cancelled_keeps_plan_until_renewal(client):
    raw, sig = _sign(_sub_payload("subscription_created", variant_id=1000003))  # pro
    client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})

    raw, sig = _sign(_sub_payload(
        "subscription_cancelled",
        variant_id=1000003,
        status="cancelled",
        ends_at="2026-12-01T00:00:00Z",
    ))
    r = client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})
    assert r.status_code == 200
    with Session(engine) as s:
        row = s.get(UserSettings, USER_A.user_id)
        assert row.plan == "pro"  # access continues until renews_at
        assert row.plan_canceled_at is not None


def test_subscription_expired_clears_plan(client):
    raw, sig = _sign(_sub_payload("subscription_created", variant_id=1000003))
    client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})

    raw, sig = _sign(_sub_payload("subscription_expired", variant_id=1000003, status="expired"))
    r = client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})
    assert r.status_code == 200
    with Session(engine) as s:
        row = s.get(UserSettings, USER_A.user_id)
        assert row.plan == "expired"
        assert row.lsq_subscription_id is None  # cleared on expiry


def test_unknown_event_is_noop(client):
    """Unhandled event types should still return 200 so LSQ doesn't retry."""
    raw, sig = _sign({
        "meta": {"event_name": "license_key_created", "custom_data": {"user_id": USER_A.user_id}},
        "data": {},
    })
    r = client.post("/api/webhooks/lemonsqueezy", content=raw, headers={"X-Signature": sig})
    assert r.status_code == 200
