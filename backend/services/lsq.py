"""Lemon Squeezy client + variant mapping (M3.6).

Thin wrapper over LSQ's REST API via httpx. Two reasons not to ship the
official `lemonsqueezy-py` SDK: (1) it's a thin wrapper itself, (2) keeping
network calls explicit makes our smoke tests easier to mock.

Three things this module does:
  * resolve a (tier, interval) tuple to a LSQ variant ID via env var lookup
  * build a hosted-checkout URL pre-filled with the right variant + customer
    email, with `custom_data` carrying the user_id back to us via webhook
  * call the LSQ admin API to mint a customer-portal link for self-service

Subscription lifecycle is handled in `routers/billing.py` via webhooks —
this module is request-time only.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx

log = logging.getLogger("storyforge.lsq")

LSQ_API = "https://api.lemonsqueezy.com/v1"
_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


@dataclass(frozen=True)
class CheckoutTarget:
    """Resolved tier+interval → variant ID + the plan name it'll grant."""
    variant_id: str
    plan_id: str   # 'starter' / 'pro' / 'team' — what the webhook should set
    interval: str  # 'monthly' / 'annual'


# ---------- variant resolution ----------


def variant_for(tier: str, interval: str) -> CheckoutTarget | None:
    """Map (tier, interval) → CheckoutTarget. Returns None if either is unknown.

    Env-var lookup keeps variant IDs out of source code (they're test-mode
    today, will swap to live-mode IDs at launch with no code change).
    """
    t = tier.lower().strip()
    i = interval.lower().strip()
    if t not in ("starter", "pro", "team"):
        return None
    if i not in ("monthly", "annual"):
        return None
    env_key = f"LSQ_VARIANT_{t.upper()}_{i.upper()}"
    vid = os.environ.get(env_key)
    if not vid:
        log.warning("env var %s not set; checkout for %s/%s will fail", env_key, t, i)
        return None
    return CheckoutTarget(variant_id=vid, plan_id=t, interval=i)


def variant_to_plan(variant_id: str) -> str | None:
    """Reverse lookup — webhook payloads carry variant_id; we need the plan
    name to write into `user_settings.plan`. Returns None for unknown variants
    (e.g., a stale/test variant deleted from LSQ but still in flight)."""
    for tier in ("starter", "pro", "team"):
        for interval in ("monthly", "annual"):
            if os.environ.get(f"LSQ_VARIANT_{tier.upper()}_{interval.upper()}") == str(variant_id):
                return tier
    return None


# ---------- API calls ----------


def _headers() -> dict:
    # `.strip()` is defensive — copy-pasting a long JWT into a dashboard
    # textarea (Render's UI in particular) often picks up a trailing
    # newline. httpx then refuses the `Authorization: Bearer ...\n` header
    # with `LocalProtocolError: Illegal header value`.
    api_key = (os.environ.get("LSQ_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("LSQ_API_KEY not set in backend/.env")
    return {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
    }


def create_checkout_url(
    *,
    target: CheckoutTarget,
    user_id: str,
    user_email: str | None,
    user_name: str | None = None,
) -> str:
    """Mint a hosted-checkout URL pre-filled with the user's email.

    `custom_data` carries our `user_id` through the LSQ checkout → webhook
    pipeline. Webhook handler reads it back to know which user_settings row
    to update. WITHOUT this we'd have to match on email, which is fragile.
    """
    store_id = os.environ.get("LSQ_STORE_ID")
    if not store_id:
        raise RuntimeError("LSQ_STORE_ID not set in backend/.env")

    # LSQ rejects an empty `email` string with 422 — omit the field entirely
    # if we couldn't resolve one from Clerk, and the user fills it in at checkout.
    checkout_data: dict = {
        # Custom data is opaque to LSQ; comes back in webhook payloads under
        # `meta.custom_data`. We use it to map the resulting subscription back
        # to *our* user without relying on email matching.
        "custom": {
            "user_id": user_id,
            "plan_id": target.plan_id,
            "interval": target.interval,
        },
    }
    if user_email:
        checkout_data["email"] = user_email
    if user_name:
        checkout_data["name"] = user_name

    body = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_data": checkout_data,
                # Embed checkout in our app via an iframe? Not yet — just
                # redirect to LSQ's hosted page (simpler, no extra CSP work).
                "product_options": {
                    "redirect_url": _success_url(),
                },
            },
            "relationships": {
                "store": {"data": {"type": "stores", "id": str(store_id)}},
                "variant": {"data": {"type": "variants", "id": str(target.variant_id)}},
            },
        }
    }
    with httpx.Client(timeout=_TIMEOUT) as c:
        r = c.post(f"{LSQ_API}/checkouts", headers=_headers(), content=json.dumps(body))
    if r.status_code not in (200, 201):
        log.warning("LSQ create_checkout %d: %s", r.status_code, r.text[:400])
        raise RuntimeError(f"LSQ checkout failed: {r.status_code}")
    return r.json()["data"]["attributes"]["url"]


def customer_portal_url(customer_id: str) -> str:
    """Self-service portal — manage card, cancel, view invoices.

    LSQ exposes the URL on the customer resource itself; one GET, no extra
    POST needed. URL contains a long-lived signed token, so it's safe to
    hand directly to the user.
    """
    with httpx.Client(timeout=_TIMEOUT) as c:
        r = c.get(f"{LSQ_API}/customers/{customer_id}", headers=_headers())
    if r.status_code != 200:
        log.warning("LSQ get_customer %d: %s", r.status_code, r.text[:400])
        raise RuntimeError(f"LSQ portal lookup failed: {r.status_code}")
    urls = r.json()["data"]["attributes"].get("urls") or {}
    portal = urls.get("customer_portal")
    if not portal:
        raise RuntimeError("LSQ customer record missing customer_portal URL")
    return portal


def _success_url() -> str:
    """Where LSQ sends the user after checkout completes.

    Frontend handles the post-checkout state (refreshes plan, shows a toast).
    Defaults to the deployed Render URL but can be overridden via env for dev.
    """
    base = os.environ.get("APP_BASE_URL") or "https://storyforge-f7zu.onrender.com"
    return f"{base}/account?checkout=success"
