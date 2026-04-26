"""Integration connections + push routes (M6.2).

Two surfaces:
  * `/api/integrations/<kind>/connection` — CRUD on the user's saved
    creds for one integration. v1: only `kind=jira`.
  * `/api/extractions/{eid}/push/<kind>` — execute a push using the saved
    connection.

Connections are scoped per-user in v1 (`scope='user'`, `scope_id=user.user_id`).
Org-shared connections (`scope='org'`) are wired into the schema but not
yet exposed; ship in M6.2.c.

Tokens are Fernet-encrypted on write via `services.byok.encrypt_secret`
— same path the Anthropic BYOK key uses. They're never echoed back to
the client; only a `••••XYZK` preview is.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth.deps import CurrentUser, current_user
from db.models import Extraction, IntegrationConnection
from db.session import get_session
from models import (
    JiraConnectionRead,
    JiraConnectionWrite,
    JiraProject,
    PushToJiraRequest,
    PushToJiraResult,
)
from services.byok import decrypt_secret, encrypt_secret, key_preview
from services.jira import JiraClient, push_extraction
from services.scope import in_scope

log = logging.getLogger("storyforge.integrations")

router = APIRouter(tags=["integrations"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(current_user)]


def _get_connection(session: Session, user: CurrentUser, kind: str) -> IntegrationConnection | None:
    """Look up the active connection for (this user, this kind). v1 is
    user-scope only; once org-scope ships, this function will check both
    and prefer the user-scope row."""
    stmt = (
        select(IntegrationConnection)
        .where(IntegrationConnection.scope == "user")
        .where(IntegrationConnection.scope_id == user.user_id)
        .where(IntegrationConnection.kind == kind)
    )
    return session.exec(stmt).first()


def _decrypt_jira_config(row: IntegrationConnection) -> dict:
    """Pull the connection JSON, decrypt the API token in place. Returns
    `{base_url, email, api_token, default_project_key?}` ready to construct
    a JiraClient. Raises 400 if the row is malformed (defensive — a write
    that produced this shape is a bug)."""
    cfg = json.loads(row.config_json)
    enc = cfg.get("api_token_encrypted")
    token = decrypt_secret(enc) if enc else None
    if not token:
        raise HTTPException(
            status_code=400,
            detail="Saved Jira credentials are unreadable (master key may have rotated). Reconnect in Settings.",
        )
    cfg["api_token"] = token
    cfg.pop("api_token_encrypted", None)
    return cfg


def _to_jira_read(row: IntegrationConnection) -> JiraConnectionRead:
    cfg = json.loads(row.config_json)
    enc = cfg.get("api_token_encrypted")
    plain = decrypt_secret(enc) if enc else ""
    return JiraConnectionRead(
        base_url=cfg.get("base_url", ""),
        email=cfg.get("email", ""),
        api_token_preview=key_preview(plain or ""),
        default_project_key=cfg.get("default_project_key"),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ---- Jira connection -------------------------------------------------------


@router.get("/api/integrations/jira/connection", response_model=JiraConnectionRead | None)
def get_jira_connection(session: SessionDep, user: UserDep):
    row = _get_connection(session, user, "jira")
    return _to_jira_read(row) if row else None


@router.put("/api/integrations/jira/connection", response_model=JiraConnectionRead)
def put_jira_connection(payload: JiraConnectionWrite, session: SessionDep, user: UserDep):
    """Upsert. Token is encrypted before storage. Light validation on the
    base_url shape — full Jira API connectivity is verified by the Test
    button on the frontend (which calls /projects)."""
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="base_url must include http(s)://")

    cfg = {
        "base_url": base_url,
        "email": (payload.email or "").strip(),
        "api_token_encrypted": encrypt_secret((payload.api_token or "").strip()),
        "default_project_key": (payload.default_project_key or None),
    }
    now = datetime.now(timezone.utc)

    row = _get_connection(session, user, "jira")
    if row is None:
        row = IntegrationConnection(
            scope="user",
            scope_id=user.user_id,
            kind="jira",
            config_json=json.dumps(cfg),
            created_at=now,
            updated_at=now,
        )
    else:
        row.config_json = json.dumps(cfg)
        row.updated_at = now
    session.add(row)
    session.commit()
    session.refresh(row)
    return _to_jira_read(row)


@router.delete("/api/integrations/jira/connection", status_code=204)
def delete_jira_connection(session: SessionDep, user: UserDep) -> None:
    row = _get_connection(session, user, "jira")
    if row is None:
        return
    session.delete(row)
    session.commit()


# ---- Jira projects (live fetch) -------------------------------------------


@router.get("/api/integrations/jira/projects", response_model=list[JiraProject])
def list_jira_projects(session: SessionDep, user: UserDep):
    """Fetch the user's Jira projects via the saved connection. Doubles as
    a "test connection" probe — 401 → token bad, 502 → URL bad / network."""
    row = _get_connection(session, user, "jira")
    if row is None:
        raise HTTPException(status_code=400, detail="No Jira connection saved. Connect in Settings.")
    cfg = _decrypt_jira_config(row)
    client = JiraClient(base_url=cfg["base_url"], email=cfg["email"], api_token=cfg["api_token"])
    return client.list_projects()


# ---- Push -----------------------------------------------------------------


@router.post("/api/extractions/{extraction_id}/push/jira", response_model=PushToJiraResult)
def push_to_jira(
    extraction_id: str,
    payload: PushToJiraRequest,
    session: SessionDep,
    user: UserDep,
) -> PushToJiraResult:
    """Push every story in the extraction as a Jira issue. Per-story
    failures land in `failed[]` so a partial success doesn't lose the
    work that did land — the user can fix the offending stories and
    push again."""
    extraction = session.get(Extraction, extraction_id)
    if not in_scope(extraction, user):
        raise HTTPException(status_code=404, detail="Extraction not found")

    row = _get_connection(session, user, "jira")
    if row is None:
        raise HTTPException(status_code=400, detail="No Jira connection saved. Connect in Settings.")
    cfg = _decrypt_jira_config(row)
    client = JiraClient(base_url=cfg["base_url"], email=cfg["email"], api_token=cfg["api_token"])

    if not (extraction.stories or []):
        raise HTTPException(status_code=400, detail="No stories to push.")

    return push_extraction(
        client,
        extraction,
        project_key=payload.project_key,
        issue_type=payload.issue_type or "Story",
    )
