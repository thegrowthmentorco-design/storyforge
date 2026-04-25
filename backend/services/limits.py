"""Pre-extract limit enforcement (M3.5.4).

Single entry point `enforce_limits(session, user, raw_text, model)` runs
inside `/api/extract` and `/api/extractions/{id}/rerun` BEFORE the Claude
call so we never burn tokens on a doomed request.

Three gates, in order, each raising HTTPException with a structured
`paywall: True` payload that the frontend's PaywallModal consumes:

  1. Trial expiry      → 403 with reason='trial_expired'
  2. Model not allowed → 403 with reason='model_not_allowed'
  3. Doc too large     → 413 with reason='doc_too_large'
  4. Monthly cap hit   → 429 with reason='monthly_limit'

The paywall payload shape is documented in DECISIONS.md → "Implementation
notes for M3.5". Frontend api.js extracts it onto `err.paywall` so callers
can inspect without parsing strings.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from auth.deps import CurrentUser
from db.models import UsageLog, UserSettings
from services.plans import PLANS, get_plan
from services.scope import apply_scope


def _month_start_utc(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _aware(dt: datetime | None) -> datetime | None:
    """Coerce a naive datetime to UTC-aware. Both SQLite (no tz support)
    and our Postgres `TIMESTAMP WITHOUT TIME ZONE` columns return naive
    datetimes; we always *write* UTC, so adding `tzinfo=UTC` on read is
    correct. Returning None pass-through so callers can chain safely."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _trial_period_start(settings: UserSettings | None, now: datetime) -> datetime:
    """For trial users, count usage from the start of their trial window
    (trial_ends_at - 14 days). Falls back to user_settings.created_at if
    trial_ends_at is somehow null (defensive)."""
    if settings and settings.trial_ends_at:
        from datetime import timedelta
        return _aware(settings.trial_ends_at) - timedelta(days=14)
    if settings and settings.created_at:
        return _aware(settings.created_at)
    return now  # never matches anything → 0 usage counted, safe default


def _paywall(
    *,
    status: int,
    reason: str,
    plan_id: str,
    upgrade_to: str | None,
    message: str,
    extra: dict[str, Any] | None = None,
) -> HTTPException:
    """Build a structured paywall response. FastAPI serialises `detail` as-is
    when it's a dict, producing `{"detail": {...}}` — frontend reads `.paywall`."""
    payload: dict[str, Any] = {
        "paywall": True,
        "reason": reason,
        "current_plan": plan_id,
        "upgrade_to": upgrade_to,
        "message": message,
    }
    if extra:
        payload.update(extra)
    return HTTPException(status_code=status, detail=payload)


def enforce_limits(
    session: Session,
    user: CurrentUser,
    *,
    raw_text: str,
    model: str | None,
) -> None:
    """Raise HTTPException with paywall payload if the request violates
    the user's plan. No-op when everything's within limits."""
    now = datetime.now(timezone.utc)

    settings = session.get(UserSettings, user.user_id)
    plan_id = (settings.plan if settings else None) or "trial"

    # ---- 1. Trial expiry ----
    if plan_id == "trial" and settings and settings.trial_ends_at and _aware(settings.trial_ends_at) < now:
        # Mark expired so subsequent calls don't keep checking the timestamp.
        settings.plan = "expired"
        session.add(settings)
        session.commit()
        plan_id = "expired"

    plan = get_plan(plan_id)

    if plan_id == "expired":
        raise _paywall(
            status=403,
            reason="trial_expired",
            plan_id=plan_id,
            upgrade_to="starter",
            message="Your trial has ended. Upgrade to Starter ($20/mo) to keep extracting.",
        )

    # ---- 2. Model whitelist ----
    if model and model not in plan.allowed_models:
        raise _paywall(
            status=403,
            reason="model_not_allowed",
            plan_id=plan_id,
            upgrade_to=plan.upgrade_to,
            message=(
                f"{model} isn't available on the {plan.name} plan. "
                f"Upgrade to {get_plan(plan.upgrade_to).name} to unlock it."
                if plan.upgrade_to
                else f"{model} isn't available on the {plan.name} plan."
            ),
            extra={"requested_model": model, "allowed_models": list(plan.allowed_models)},
        )

    # ---- 3. Doc size ----
    char_count = len(raw_text or "")
    if char_count > plan.max_input_chars:
        # Char→token estimate: char_count / 4. Display the page count for
        # a more human-meaningful number (1 page ≈ 2 000 chars / 500 tokens).
        approx_pages = char_count // 2000
        cap_pages = plan.max_input_chars // 2000
        raise _paywall(
            status=413,
            reason="doc_too_large",
            plan_id=plan_id,
            upgrade_to=plan.upgrade_to,
            message=(
                f"This document is ~{approx_pages} pages. The {plan.name} plan caps inputs at ~{cap_pages} pages. "
                f"Upgrade to {get_plan(plan.upgrade_to).name} for a larger limit."
                if plan.upgrade_to
                else f"This document is ~{approx_pages} pages. {plan.name} caps inputs at ~{cap_pages} pages."
            ),
            extra={
                "doc_chars": char_count,
                "doc_pages_estimate": approx_pages,
                "max_chars": plan.max_input_chars,
                "max_pages_estimate": cap_pages,
            },
        )

    # ---- 4. Monthly cap (or trial-period total) ----
    if plan_id == "trial":
        period_start = _trial_period_start(settings, now)
    else:
        period_start = _month_start_utc(now)

    used_count = session.exec(
        apply_scope(
            select(func.count(UsageLog.id)).where(UsageLog.ts >= period_start),
            UsageLog,
            user,
        )
    ).one()
    used = int(used_count or 0)

    if used >= plan.extractions_per_period:
        raise _paywall(
            status=429,
            reason="monthly_limit",
            plan_id=plan_id,
            upgrade_to=plan.upgrade_to,
            message=(
                f"You've used all {plan.extractions_per_period} extractions for {plan.period_label}. "
                f"Upgrade to {get_plan(plan.upgrade_to).name} for {get_plan(plan.upgrade_to).extractions_per_period}/mo."
                if plan.upgrade_to
                else f"You've used all {plan.extractions_per_period} extractions for {plan.period_label}."
            ),
            extra={
                "current_usage": used,
                "limit": plan.extractions_per_period,
                "period": plan.period_label,
            },
        )
