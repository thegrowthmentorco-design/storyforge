"""FastAPI auth dependency (M3.1.6 + M3.1.7).

`current_user` is the canonical dependency every protected route uses. Routes
that only need to gate on auth (don't read the user) declare it via
`dependencies=[Depends(current_user)]`. Routes that need the user_id/org_id
parametrise as `user: CurrentUser = Depends(current_user)`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from db.session import get_session

from .clerk import ClerkAuthError, verify_session_token

log = logging.getLogger("storyforge.auth.deps")


@dataclass(frozen=True)
class CurrentUser:
    """Snapshot of the verified Clerk session, normalised for our routes."""

    user_id: str
    org_id: str | None = None
    org_role: str | None = None


# M6.7 — API tokens are dispatched on prefix. `sk_*` (live, test, …)
# routes through the api_tokens service; anything else falls through to
# Clerk JWT verification. We deliberately don't try to detect "this looks
# like a JWT" — the prefix check is unambiguous and cheap.
_API_TOKEN_PREFIXES = ("sk_live_", "sk_test_")


def current_user(
    authorization: str | None = Header(default=None),
    session: Annotated[Session, Depends(get_session)] = None,  # type: ignore[assignment]
) -> CurrentUser:
    """Extract + verify either a Clerk JWT or a StoryForge API token from
    the `Authorization: Bearer …` header. Same return shape either way so
    every downstream route works transparently with both.

    Dispatch:
      Bearer sk_live_…  → API token lookup (M6.7)
      Bearer <other>    → Clerk JWT verify (M3.1)
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")

    # ----- API token path (M6.7) ------------------------------------------
    if token.startswith(_API_TOKEN_PREFIXES):
        # Local import to avoid circulars (services/api_tokens imports
        # db.models, which is fine, but keeping this lazy keeps the
        # auth module dep graph minimal).
        from services.api_tokens import find_active_by_plaintext, touch
        row = find_active_by_plaintext(session, token)
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid or revoked API token")
        # Bump last_used_at — best-effort, doesn't fail the request on error.
        touch(session, row)
        return CurrentUser(
            user_id=row.user_id,
            org_id=row.org_id,
            # API tokens don't carry org_role — Clerk-only concept. Routes
            # that need org_role (none today) would have to fall back.
            org_role=None,
        )

    # ----- Clerk JWT path (M3.1) ------------------------------------------
    try:
        claims = verify_session_token(token)
    except ClerkAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")
    return CurrentUser(
        user_id=sub,
        org_id=claims.get("org_id"),
        org_role=claims.get("org_role"),
    )
