"""API token mint / hash / validate (M6.7).

Tokens are opaque random strings prefixed with `sk_live_`. We never
store the plaintext — only SHA-256(plaintext) — so a leak of the
database alone can't be used to authenticate.

Public surface:
  - mint_token() -> {plaintext, prefix, last4, hash}
  - hash_token(plaintext) -> hex digest
  - find_active_by_plaintext(session, plaintext) -> ApiToken | None
  - touch(session, row) -> updates last_used_at (best-effort)
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timezone

from sqlmodel import Session

from db.models import ApiToken

log = logging.getLogger("storyforge.tokens")

TOKEN_PREFIX = "sk_live_"
# 32 bytes → 43-char base64-urlsafe (sans padding) → ~256 bits of entropy.
# Plenty for a long-lived secret; matches Stripe / GitHub PAT shape.
SECRET_BYTES = 32


def _generate_plaintext() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(SECRET_BYTES)


def hash_token(plaintext: str) -> str:
    """SHA-256 hex. Same algorithm we use everywhere — fast, no salt
    needed because the input is high-entropy random (not a password).

    We do NOT use HMAC: we don't store a secret key separately, and
    SHA-256 of a 256-bit random secret is collision/preimage-safe at
    a level orders of magnitude beyond what an attacker could brute
    force in any reasonable timeframe."""
    return hashlib.sha256((plaintext or "").encode("utf-8")).hexdigest()


def mint_token() -> dict:
    """Mint a new token. Returns {plaintext, prefix, last4, hash}.
    Caller persists `prefix`/`last4`/`hash` on the row and returns
    `plaintext` to the user exactly once."""
    plain = _generate_plaintext()
    return {
        "plaintext": plain,
        "prefix": TOKEN_PREFIX,
        # Last 4 chars of the secret part (post-prefix). Used for the
        # ``sk_live_••••XYZK`` preview in Settings.
        "last4": plain[-4:],
        "hash": hash_token(plain),
    }


def find_active_by_plaintext(session: Session, plaintext: str) -> ApiToken | None:
    """Fast lookup by SHA-256. Filters out revoked + expired in Python
    (the index is on token_hash, not on revoked_at, and we only ever
    have one matching row anyway — token_hash collisions are
    astronomically unlikely)."""
    from sqlmodel import select
    digest = hash_token(plaintext)
    row = session.exec(select(ApiToken).where(ApiToken.token_hash == digest)).first()
    if row is None:
        return None
    if row.revoked_at is not None:
        return None
    if row.expires_at is not None and row.expires_at <= datetime.now(timezone.utc):
        return None
    return row


def touch(session: Session, row: ApiToken) -> None:
    """Update last_used_at. Wrapped in try so a write failure doesn't
    fail the actual API request — last_used_at is informational only."""
    try:
        row.last_used_at = datetime.now(timezone.utc)
        session.add(row)
        session.commit()
    except Exception:
        log.exception("failed to touch api_token last_used_at")
        session.rollback()
