"""Transactional email via Resend (M3.7).

One sender today (the welcome email) and one fetch helper (look up a Clerk
user by id to get their email address). Why no SDK? Resend's REST API is
two endpoints; httpx is already in our deps via FastAPI's TestClient, and
shipping a thin wrapper is faster than chasing SDK release cadence.

Env-gated: missing `RESEND_API_KEY` makes `send_welcome_email` a no-op +
warning. Lets dev run without configuring email at all.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

log = logging.getLogger("storyforge.email")

RESEND_API = "https://api.resend.com/emails"
CLERK_API = "https://api.clerk.com/v1"

# Hard timeouts so a slow third party can't pile up uvicorn workers. Welcome
# emails are fire-and-forget; if Resend is down we accept the dropped welcome.
_HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


# ---------- Clerk lookup ----------


def fetch_clerk_user(user_id: str) -> Optional[dict]:
    """Look up a Clerk user by id. Returns the raw user dict or None on miss.

    JWT claims don't carry email by default in Clerk's session token, so for
    welcome emails we need a server-side fetch with the secret key. Worth
    keeping the call site narrow — every fetch is a billed call against
    Clerk's API limits in higher tiers.
    """
    # `.strip()` because dashboard paste of long secrets often picks up a
    # trailing newline; httpx then refuses the resulting `Bearer ...\n`
    # header. Same guard added in services/lsq.py and webhook signature check.
    secret = (os.environ.get("CLERK_SECRET_KEY") or "").strip()
    if not secret:
        log.warning("CLERK_SECRET_KEY not set; cannot fetch Clerk user")
        return None
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as c:
            r = c.get(
                f"{CLERK_API}/users/{user_id}",
                headers={"Authorization": f"Bearer {secret}"},
            )
        if r.status_code == 200:
            return r.json()
        log.warning("clerk fetch_user(%s) -> %d: %s", user_id, r.status_code, r.text[:200])
    except httpx.HTTPError as e:
        log.warning("clerk fetch_user(%s) network error: %s", user_id, e)
    return None


def primary_email_of(clerk_user: dict) -> Optional[str]:
    """Resolve the user's primary email from a Clerk user dict.

    Clerk lets a user have multiple email addresses; `primary_email_address_id`
    points at the canonical one. Falls back to first-in-list if the pointer
    is missing (rare).
    """
    if not clerk_user:
        return None
    addresses = clerk_user.get("email_addresses") or []
    if not addresses:
        return None
    primary_id = clerk_user.get("primary_email_address_id")
    for a in addresses:
        if a.get("id") == primary_id:
            return a.get("email_address")
    return addresses[0].get("email_address")


# ---------- send ----------


def _from_header() -> str:
    name = os.environ.get("WELCOME_FROM_NAME") or "StoryForge"
    addr = os.environ.get("WELCOME_FROM_EMAIL") or "onboarding@resend.dev"
    return f"{name} <{addr}>"


def send_welcome_email(to_email: str, *, display_name: Optional[str] = None) -> bool:
    """Send the welcome email to `to_email`. Returns True on 2xx, False otherwise.

    Idempotency is the *caller's* job — `record_welcome_sent` in `routers/me.py`
    sets `user_settings.welcome_sent_at` first so a repeated request never
    reaches us. We only get called once per user.
    """
    api_key = (os.environ.get("RESEND_API_KEY") or "").strip()
    if not api_key:
        log.warning("RESEND_API_KEY not set; skipping welcome to %s", to_email)
        return False

    greeting = f"Hi {display_name}," if display_name else "Hi there,"
    body_html = f"""
    <p>{greeting}</p>
    <p>Welcome to StoryForge — the easiest way to turn messy BRDs, meeting notes,
    and PRDs into clean, structured user stories.</p>
    <p>To get started:</p>
    <ol>
      <li>Drop a document on the home page (PDF, .docx, .txt, or .md).</li>
      <li>Add your Anthropic API key in <strong>Settings</strong> (it's encrypted server-side).</li>
      <li>Pick a model — Sonnet is the cost-quality sweet spot.</li>
    </ol>
    <p>Questions or feedback? Just reply to this email.</p>
    <p>— The StoryForge team</p>
    """.strip()
    body_text = (
        f"{greeting}\n\n"
        "Welcome to StoryForge — the easiest way to turn messy BRDs, meeting "
        "notes, and PRDs into clean, structured user stories.\n\n"
        "To get started:\n"
        "  1. Drop a document on the home page (PDF, .docx, .txt, or .md).\n"
        "  2. Add your Anthropic API key in Settings (encrypted server-side).\n"
        "  3. Pick a model — Sonnet is the cost-quality sweet spot.\n\n"
        "Questions or feedback? Just reply to this email.\n\n"
        "— The StoryForge team\n"
    )

    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as c:
            r = c.post(
                RESEND_API,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": _from_header(),
                    "to": [to_email],
                    "subject": "Welcome to StoryForge",
                    "html": body_html,
                    "text": body_text,
                },
            )
        if r.status_code in (200, 201, 202):
            log.info("welcome email sent to %s (resend id=%s)", to_email, r.json().get("id"))
            return True
        log.warning("resend send to %s -> %d: %s", to_email, r.status_code, r.text[:300])
    except httpx.HTTPError as e:
        log.warning("resend send to %s network error: %s", to_email, e)
    return False
