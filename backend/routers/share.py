"""Share-link routes (M4.6).

Two surfaces, deliberately separated:

  Owner-side (`/api/extractions/{eid}/share`)
    Requires Clerk auth + ownership of the extraction. Lets the owner
    create / rotate / revoke a share token. Mounted with the standard
    `_protected_deps` chain in main.py.

  Public-side (`/api/share/{token}`)
    No auth at all. Anyone with the token can read the extraction. Mounted
    WITHOUT the welcome_check / current_user dependencies. Returns the same
    `ExtractionRecord` shape the authed routes return — the read-only studio
    on the frontend re-uses our existing components in their non-editable
    fallback mode (set up in M4.1) so we don't ship two artifact renderers.

Token format: `secrets.token_urlsafe(16)` ≈ 22 chars. Opaque, no encoded
metadata — server-side lookup is authoritative.

One active token per extraction at a time: POST rotates (revokes old +
creates new) so the owner has a single "share URL" mental model. We could
support multi-token + per-recipient labels later if anyone asks.

Comments are NOT exposed via the share — the read-only view passes empty
comments in. Logic lives on the frontend; the API would happily serve them,
but defaulting to "no comments visible to viewers" is the safer ship.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth.deps import CurrentUser, current_user
from db.models import Extraction, ExtractionShare
from db.session import get_session
from models import ExtractionRecord, ExtractionShareRead
from services.extractions import extraction_to_record
from services.scope import in_scope

log = logging.getLogger("storyforge.share")

# Two routers — one mounted protected, one public — keeps the auth posture
# crystal clear. main.py applies _protected_deps to `owner_router` and
# nothing to `public_router`.
owner_router = APIRouter(tags=["share"])
public_router = APIRouter(tags=["share-public"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(current_user)]


def _owned_extraction(session: Session, extraction_id: str, user: CurrentUser) -> Extraction:
    row = session.get(Extraction, extraction_id)
    if not in_scope(row, user):
        raise HTTPException(status_code=404, detail="Extraction not found")
    return row


def _active_share_for(session: Session, extraction_id: str) -> ExtractionShare | None:
    """Return the latest non-revoked, non-expired share for an extraction,
    or None. We rotate on POST, so in practice there's at most one — but
    the query handles legacy rows too."""
    now = datetime.now(timezone.utc)
    rows = session.exec(
        select(ExtractionShare)
        .where(ExtractionShare.extraction_id == extraction_id)
        .where(ExtractionShare.revoked_at.is_(None))  # type: ignore[union-attr]
        .order_by(ExtractionShare.created_at.desc())
    ).all()
    for r in rows:
        if r.expires_at is None or r.expires_at > now:
            return r
    return None


def _to_read(s: ExtractionShare) -> ExtractionShareRead:
    return ExtractionShareRead(
        token=s.token,
        extraction_id=s.extraction_id,
        created_at=s.created_at,
        expires_at=s.expires_at,
        revoked_at=s.revoked_at,
    )


# ---- Owner-side ------------------------------------------------------------


@owner_router.get("/api/extractions/{extraction_id}/share", response_model=ExtractionShareRead | None)
def get_active_share(extraction_id: str, session: SessionDep, user: UserDep):
    """Return the active token for this extraction, or null if none exists."""
    _owned_extraction(session, extraction_id, user)
    row = _active_share_for(session, extraction_id)
    return _to_read(row) if row else None


@owner_router.post("/api/extractions/{extraction_id}/share", response_model=ExtractionShareRead, status_code=201)
def create_or_rotate_share(extraction_id: str, session: SessionDep, user: UserDep):
    """Mint a fresh token. If one was already active, revoke it first
    (single-active-token model). Returns the new record."""
    _owned_extraction(session, extraction_id, user)
    now = datetime.now(timezone.utc)

    # Revoke any pre-existing active tokens. Soft-revoke (not delete) so a
    # bookmarked old URL fails closed with "revoked" rather than 404.
    existing = session.exec(
        select(ExtractionShare)
        .where(ExtractionShare.extraction_id == extraction_id)
        .where(ExtractionShare.revoked_at.is_(None))  # type: ignore[union-attr]
    ).all()
    for r in existing:
        r.revoked_at = now
        session.add(r)

    new_row = ExtractionShare(
        token=secrets.token_urlsafe(16),
        extraction_id=extraction_id,
        created_by_user_id=user.user_id,
        created_at=now,
    )
    session.add(new_row)
    session.commit()
    session.refresh(new_row)
    return _to_read(new_row)


@owner_router.delete("/api/extractions/{extraction_id}/share", status_code=204)
def revoke_share(extraction_id: str, session: SessionDep, user: UserDep) -> None:
    """Revoke ALL active tokens for this extraction. Idempotent — no-op
    when no tokens exist."""
    _owned_extraction(session, extraction_id, user)
    now = datetime.now(timezone.utc)
    existing = session.exec(
        select(ExtractionShare)
        .where(ExtractionShare.extraction_id == extraction_id)
        .where(ExtractionShare.revoked_at.is_(None))  # type: ignore[union-attr]
    ).all()
    for r in existing:
        r.revoked_at = now
        session.add(r)
    session.commit()


# ---- Public-side -----------------------------------------------------------


@public_router.get("/api/share/{token}", response_model=ExtractionRecord)
def read_shared(token: str, session: SessionDep) -> ExtractionRecord:
    """No-auth read of the shared extraction. 404 covers all failure modes
    (unknown token, revoked, expired, parent extraction deleted) — same
    user-facing answer so we don't leak which case it is."""
    share = session.get(ExtractionShare, token)
    if share is None or share.revoked_at is not None:
        raise HTTPException(status_code=404, detail="Share link not found or revoked")
    if share.expires_at is not None and share.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="Share link not found or revoked")

    extraction = session.get(Extraction, share.extraction_id)
    if extraction is None:
        raise HTTPException(status_code=404, detail="Share link not found or revoked")
    return extraction_to_record(extraction)
