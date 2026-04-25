"""First-touch onboarding (M3.7).

Fires the welcome email exactly once per real user, on whichever request
happens to be their first authenticated touch. Implemented as a FastAPI
dependency so it can be attached at the router level — every protected
endpoint contributes equally, no privileged route required.

Idempotency model: we set `user_settings.welcome_sent_at` BEFORE handing
off to the background task. If Resend is down at that moment we lose the
welcome — that's a deliberate trade-off vs. running a state machine that
could wedge into "send forever" loops on persistent failures. Manual
re-trigger is `UPDATE user_settings SET welcome_sent_at = NULL`.

Why a dep, not a webhook? See the M3.7 done-log entry — short version:
no public URL until M3.10, and a first-touch detector is functionally
equivalent for users who actually open the app. We can layer a webhook
on top once we're hosted; this code stays as the fallback.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import BackgroundTasks, Depends
from sqlmodel import Session

from auth.deps import CurrentUser, current_user
from db.models import UserSettings
from db.session import get_session
from services.email import fetch_clerk_user, primary_email_of, send_welcome_email

log = logging.getLogger("storyforge.onboarding")


def _send_welcome_for(user_id: str) -> None:
    """Background task body. Pure HTTP — no DB session needed.

    Runs after the response is sent to the client, so two slow third
    parties (Clerk + Resend) can't pile up uvicorn workers.
    """
    clerk_user = fetch_clerk_user(user_id)
    email = primary_email_of(clerk_user) if clerk_user else None
    if not email:
        log.warning("no primary email for user %s; welcome skipped", user_id)
        return
    name = (clerk_user.get("first_name") if clerk_user else None) or None
    send_welcome_email(email, display_name=name)


def welcome_check(
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
    bg: BackgroundTasks,
) -> None:
    """First-touch detector dependency. Side-effects only.

    Cheap when already welcomed: one PK lookup, no writes. When firing for
    the first time: one PK lookup + one row insert/update + one background
    task enqueue (no network in the request path).
    """
    if user.user_id == "local":
        # Synthetic legacy/dev rows aren't real Clerk users — skip the lookup.
        return
    row = session.get(UserSettings, user.user_id)
    if row is not None and row.welcome_sent_at is not None:
        return
    if row is None:
        row = UserSettings(user_id=user.user_id)
    row.welcome_sent_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    bg.add_task(_send_welcome_for, user.user_id)
