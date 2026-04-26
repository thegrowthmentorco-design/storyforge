"""Comment routes (M4.5).

Two surfaces:
  * `/api/extractions/{eid}/comments` — list (GET) + create (POST). The
    extraction-scoped path keeps ownership checks centralized.
  * `/api/comments/{cid}` — edit (PATCH) + delete (DELETE). The flat path
    avoids forcing the frontend to remember which extraction a comment
    belongs to when editing inline.

Scope: comments inherit `org_id` from the parent extraction (M3.3). A comment
created in org-X is visible only inside org-X; back to personal context, it
disappears (same UX as extractions/projects). Edit + delete are author-only —
even an org owner can't rewrite someone else's comment.

Author info (`author_name`, `author_email`) is denormalized at write time
via a Clerk lookup so the read path doesn't need network. Edits *don't*
re-snap author_name — keeps "edited 2 weeks ago by old name" honest.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth.deps import CurrentUser, current_user
from db.models import Comment, Extraction
from db.session import get_session
from models import CommentCreate, CommentPatch, CommentRead
from services.email import fetch_clerk_user, primary_email_of
from services.extractions import _mint_id
from services.scope import in_scope

log = logging.getLogger("storyforge.comments")

router = APIRouter(tags=["comments"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(current_user)]


def _owned_extraction(session: Session, extraction_id: str, user: CurrentUser) -> Extraction:
    """Same ownership pattern as extractions router. 404 on miss / foreign
    so we don't leak existence."""
    row = session.get(Extraction, extraction_id)
    if not in_scope(row, user):
        raise HTTPException(status_code=404, detail="Extraction not found")
    return row


def _to_read(c: Comment) -> CommentRead:
    return CommentRead(
        id=c.id,
        extraction_id=c.extraction_id,
        target_kind=c.target_kind,  # type: ignore[arg-type]
        target_key=c.target_key,
        author_user_id=c.author_user_id,
        author_name=c.author_name,
        author_email=c.author_email,
        body=c.body,
        created_at=c.created_at,
        edited_at=c.edited_at,
    )


# ---- list + create (extraction-scoped) ------------------------------------


@router.get("/api/extractions/{extraction_id}/comments", response_model=list[CommentRead])
def list_comments(extraction_id: str, session: SessionDep, user: UserDep) -> list[CommentRead]:
    """All comments on this extraction. Oldest first — frontend groups by
    `(target_kind, target_key)` to render per-artifact threads."""
    _owned_extraction(session, extraction_id, user)  # 404 if not visible
    stmt = (
        select(Comment)
        .where(Comment.extraction_id == extraction_id)
        .order_by(Comment.created_at.asc())
    )
    rows = session.exec(stmt).all()
    return [_to_read(c) for c in rows]


@router.post("/api/extractions/{extraction_id}/comments", response_model=CommentRead, status_code=201)
def create_comment(
    extraction_id: str,
    payload: CommentCreate,
    session: SessionDep,
    user: UserDep,
) -> CommentRead:
    extraction = _owned_extraction(session, extraction_id, user)

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="body cannot be empty")
    if len(body) > 4000:
        raise HTTPException(status_code=400, detail="body too long (max 4000 chars)")

    # Clerk lookup is best-effort — a transient Clerk failure shouldn't
    # prevent the comment from being saved. We just record empty author
    # name/email and the UI will fall back to the user_id suffix.
    author_name = ""
    author_email = ""
    try:
        clerk_user = fetch_clerk_user(user.user_id)
        if clerk_user:
            first = clerk_user.get("first_name") or ""
            last = clerk_user.get("last_name") or ""
            author_name = (first + " " + last).strip() or clerk_user.get("username") or ""
            author_email = primary_email_of(clerk_user) or ""
    except Exception:
        log.warning("clerk lookup failed during comment write for %s", user.user_id)

    row = Comment(
        id=_mint_id("cmt"),
        extraction_id=extraction.id,
        target_kind=payload.target_kind,
        target_key=payload.target_key,
        author_user_id=user.user_id,
        author_name=author_name,
        author_email=author_email,
        body=body,
        # Comment scope mirrors the parent extraction's scope (M3.3) — when
        # the extraction is in org-X, the comment is too; when extraction is
        # personal, the comment is personal.
        org_id=extraction.org_id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _to_read(row)


# ---- edit + delete (flat /api/comments/{cid}) -----------------------------


def _owned_comment(session: Session, comment_id: str, user: CurrentUser) -> Comment:
    """Author-only access for edit + delete. We deliberately don't allow
    an org owner to edit/delete a teammate's comment in v1 — it'd surprise
    users to see their words rewritten. Add admin override later if asked."""
    row = session.get(Comment, comment_id)
    if row is None or row.author_user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Comment not found")
    # Also enforce scope — a stale link from another org context shouldn't
    # work even if the author_user_id matches (e.g. user A wrote a comment in
    # org-X then tries to edit while in personal context).
    extraction = session.get(Extraction, row.extraction_id)
    if not in_scope(extraction, user):
        raise HTTPException(status_code=404, detail="Comment not found")
    return row


@router.patch("/api/comments/{comment_id}", response_model=CommentRead)
def patch_comment(
    comment_id: str,
    patch: CommentPatch,
    session: SessionDep,
    user: UserDep,
) -> CommentRead:
    row = _owned_comment(session, comment_id, user)
    body = patch.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="body cannot be empty")
    if len(body) > 4000:
        raise HTTPException(status_code=400, detail="body too long (max 4000 chars)")
    row.body = body
    row.edited_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _to_read(row)


@router.delete("/api/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: str, session: SessionDep, user: UserDep) -> None:
    row = _owned_comment(session, comment_id, user)
    session.delete(row)
    session.commit()
