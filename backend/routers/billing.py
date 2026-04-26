"""Lemon Squeezy billing routes (M3.6).

Three endpoints:
  POST /api/me/checkout            — mint a hosted-checkout URL for the user
  GET  /api/me/portal              — get the LSQ self-service portal URL
  POST /api/webhooks/lemonsqueezy  — process subscription lifecycle events

The webhook is *unauthenticated by JWT* (LSQ doesn't carry a Clerk session)
but signature-verified via HMAC-SHA256 against `LSQ_WEBHOOK_SECRET`. Every
state transition on `user_settings.plan` flows through here — never trust
a client-side claim about which plan a user is on.

Subscription lifecycle (LSQ event names → our action):
  subscription_created   → set plan + customer_id + subscription_id + renews_at
  subscription_updated   → re-derive plan from variant_id (handles upgrades)
  subscription_cancelled → set plan_canceled_at; sub stays active till renews_at
  subscription_expired   → strip plan, customer can re-subscribe later
  subscription_resumed   → clear canceled_at; sub continues
  subscription_paused    → treat as cancelled for plan purposes
  subscription_unpaused  → treat as resumed
  *_payment_success      → no-op (just log)
  *_payment_failed       → log; could mail in future
  *_payment_recovered    → no-op
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel import Session

from auth.deps import CurrentUser, current_user
from db.models import UserSettings
from db.session import get_session
from models import CheckoutRequest, CheckoutResponse, PortalResponse
from services import lsq
from services.email import fetch_clerk_user, primary_email_of
from services.onboarding import welcome_check

log = logging.getLogger("storyforge.billing")

router = APIRouter(prefix="/api", tags=["billing"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(current_user)]


# ============================================================================
# Authed endpoints — paywall + Account page consume these
# ============================================================================


@router.post("/me/checkout", response_model=CheckoutResponse, dependencies=[Depends(welcome_check)])
def create_checkout(payload: CheckoutRequest, user: UserDep) -> CheckoutResponse:
    """Mint a Lemon Squeezy hosted-checkout URL pre-filled with the user's email.

    The frontend `window.location`s to the returned URL. After payment, LSQ
    redirects back to /account?checkout=success and fires a `subscription_created`
    webhook with the user_id we passed in `custom_data`.
    """
    target = lsq.variant_for(payload.tier, payload.interval)
    if target is None:
        raise HTTPException(status_code=400, detail=f"Unknown tier/interval: {payload.tier}/{payload.interval}")

    # Pull email from Clerk so the checkout form is pre-filled — better UX
    # than asking the user to retype it. Best-effort: if Clerk lookup fails,
    # we still mint the URL and LSQ asks for email at checkout.
    clerk_user = fetch_clerk_user(user.user_id)
    email = primary_email_of(clerk_user) if clerk_user else None
    name = (clerk_user or {}).get("first_name") if clerk_user else None

    try:
        url = lsq.create_checkout_url(
            target=target,
            user_id=user.user_id,
            user_email=email,
            user_name=name,
        )
    except Exception as e:  # noqa: BLE001 — surface root cause to the client
        # Catch broadly: httpx network errors, JSON parse errors, env-var
        # RuntimeErrors all bubble through here. The user-facing detail
        # gives us a clue from the browser without needing log access.
        log.exception("checkout failed")
        raise HTTPException(status_code=502, detail=f"Could not create checkout ({type(e).__name__}): {e}")
    return CheckoutResponse(url=url)


@router.get("/me/portal", response_model=PortalResponse, dependencies=[Depends(welcome_check)])
def get_portal(session: SessionDep, user: UserDep) -> PortalResponse:
    """Return the LSQ customer-portal URL — manage card / cancel / view invoices.

    404 if the user doesn't have a customer_id yet (i.e. has never paid).
    Frontend hides the button in that state, but defending here too.
    """
    settings = session.get(UserSettings, user.user_id)
    if settings is None or not settings.lsq_customer_id:
        raise HTTPException(status_code=404, detail="No active subscription")
    try:
        url = lsq.customer_portal_url(settings.lsq_customer_id)
    except Exception as e:  # noqa: BLE001 — surface root cause
        log.exception("portal lookup failed")
        raise HTTPException(status_code=502, detail=f"Could not load portal ({type(e).__name__}): {e}")
    return PortalResponse(url=url)


# ============================================================================
# Webhook — UN-AUTHED but HMAC-verified. Mounted at /api/webhooks/lemonsqueezy.
# ============================================================================


def _verify_signature(raw_body: bytes, signature_hex: str | None) -> bool:
    """LSQ signs every webhook with HMAC-SHA256 of the raw request body using
    the secret we configured in their dashboard. Constant-time compare prevents
    timing attacks on the signature."""
    if not signature_hex:
        return False
    secret = os.environ.get("LSQ_WEBHOOK_SECRET")
    if not secret:
        log.error("LSQ_WEBHOOK_SECRET not set — refusing all webhooks")
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_hex)


def _to_dt(s: str | None) -> datetime | None:
    """LSQ timestamps come as ISO 8601 strings. Tolerate `Z` suffix."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _user_id_from_event(payload: dict) -> str | None:
    """Pull our `user_id` out of the LSQ payload's `meta.custom_data`.

    We pass it into checkout via `attributes.checkout_data.custom`; LSQ
    surfaces it back on the webhook at `meta.custom_data.user_id`. This is
    the canonical link between an LSQ subscription and our user_settings row.
    """
    custom = (payload.get("meta") or {}).get("custom_data") or {}
    uid = custom.get("user_id")
    return uid if isinstance(uid, str) and uid else None


def _apply_subscription_state(
    session: Session,
    *,
    user_id: str,
    sub_attrs: dict,
    sub_id: str,
    customer_id: str,
    event_name: str,
) -> None:
    """Common write path for subscription_created / _updated / _resumed.

    Re-derives `plan` from the variant_id every time so a Pro→Team upgrade
    (which fires `subscription_updated` with a new variant_id) flips the
    user to the new plan immediately.
    """
    settings = session.get(UserSettings, user_id)
    if settings is None:
        # Edge case: user paid before welcome_check ever ran. Create the row.
        settings = UserSettings(user_id=user_id)

    variant_id = str(sub_attrs.get("variant_id") or "")
    plan_id = lsq.variant_to_plan(variant_id)
    if plan_id is None:
        log.warning("webhook %s: unknown variant_id=%s; user_id=%s — ignoring", event_name, variant_id, user_id)
        return

    settings.plan = plan_id
    settings.lsq_customer_id = str(customer_id)
    settings.lsq_subscription_id = str(sub_id)
    settings.plan_renews_at = _to_dt(sub_attrs.get("renews_at"))
    # Status determines whether cancellation is in flight. LSQ statuses:
    # active / on_trial / paused / past_due / unpaid / cancelled / expired.
    status = sub_attrs.get("status")
    if status == "cancelled":
        # Cancel-at-period-end: keep plan active until renews_at, just mark.
        settings.plan_canceled_at = _to_dt(sub_attrs.get("ends_at")) or datetime.now(timezone.utc)
    elif event_name in ("subscription_resumed", "subscription_unpaused"):
        settings.plan_canceled_at = None
    # Trial ends — once they pay, the trial window stops mattering.
    settings.trial_ends_at = None
    settings.updated_at = datetime.now(timezone.utc)
    session.add(settings)
    session.commit()
    log.info(
        "webhook %s: user_id=%s plan=%s sub_id=%s renews=%s status=%s",
        event_name, user_id, plan_id, sub_id, settings.plan_renews_at, status,
    )


def _apply_subscription_end(session: Session, *, user_id: str, event_name: str) -> None:
    """`subscription_expired` — strip the active sub. User can re-subscribe."""
    settings = session.get(UserSettings, user_id)
    if settings is None:
        return
    settings.plan = "expired"
    settings.lsq_subscription_id = None
    settings.plan_renews_at = None
    settings.plan_canceled_at = None
    settings.updated_at = datetime.now(timezone.utc)
    session.add(settings)
    session.commit()
    log.info("webhook %s: user_id=%s -> expired", event_name, user_id)


@router.post("/webhooks/lemonsqueezy")
async def lemonsqueezy_webhook(
    request: Request,
    session: SessionDep,
    x_signature: str | None = Header(default=None, alias="X-Signature"),
    x_event_name: str | None = Header(default=None, alias="X-Event-Name"),
) -> dict:
    """Process a Lemon Squeezy subscription lifecycle event.

    Returns 200 even on no-op or unknown event so LSQ doesn't retry —
    they retry on any non-2xx for up to 3 days, which would generate a
    flood of dupes if our handler 4xx'd a benign event we just don't
    care about.
    """
    raw = await request.body()
    if not _verify_signature(raw, x_signature):
        log.warning("webhook signature mismatch (event=%s)", x_event_name)
        raise HTTPException(status_code=401, detail="invalid signature")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid JSON")

    event = (payload.get("meta") or {}).get("event_name") or x_event_name or ""
    user_id = _user_id_from_event(payload)
    if not user_id:
        log.warning("webhook %s: no user_id in meta.custom_data — payment unattributed; ignoring", event)
        return {"ok": True, "noop": "missing_user_id"}

    data = payload.get("data") or {}
    sub_id = str(data.get("id") or "")
    attrs = data.get("attributes") or {}
    customer_id = str(attrs.get("customer_id") or "")

    if event in ("subscription_created", "subscription_updated", "subscription_resumed", "subscription_unpaused"):
        if not sub_id or not customer_id:
            log.warning("webhook %s missing sub_id/customer_id; ignoring", event)
            return {"ok": True, "noop": "missing_ids"}
        _apply_subscription_state(
            session,
            user_id=user_id,
            sub_attrs=attrs,
            sub_id=sub_id,
            customer_id=customer_id,
            event_name=event,
        )

    elif event in ("subscription_cancelled", "subscription_paused"):
        # Cancellation in flight — sub still active till renews_at. Same
        # write path (re-derives plan from variant which is unchanged) but
        # _apply_subscription_state notices status=cancelled and stamps
        # plan_canceled_at.
        if not sub_id or not customer_id:
            return {"ok": True, "noop": "missing_ids"}
        _apply_subscription_state(
            session,
            user_id=user_id,
            sub_attrs=attrs,
            sub_id=sub_id,
            customer_id=customer_id,
            event_name=event,
        )

    elif event == "subscription_expired":
        _apply_subscription_end(session, user_id=user_id, event_name=event)

    elif event in (
        "subscription_payment_success",
        "subscription_payment_failed",
        "subscription_payment_recovered",
        "subscription_payment_refunded",
        "order_created",
    ):
        # Logged for visibility; no plan-state change needed.
        log.info("webhook %s: user_id=%s sub_id=%s — no-op", event, user_id, sub_id)

    else:
        log.info("webhook %s: unhandled event; payload kept in logs", event)

    return {"ok": True, "event": event}
