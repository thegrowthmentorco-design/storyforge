"""Jira REST client (M6.2).

Atlassian Cloud REST API v3, basic auth (email + API token). The token is
issued by the user at https://id.atlassian.com/manage-profile/security/api-tokens
and stored encrypted server-side via `services/byok.encrypt_secret` — same
pattern as the Anthropic BYOK key.

We use httpx (already a dep transitively) instead of the `atlassian-python-api`
SDK for the same reason we skip SDKs for Lemon Squeezy + Resend: simpler
mocks, predictable failure modes, no extra package weight.

Public surface:
  - JiraClient.list_projects() -> list[JiraProject]
  - JiraClient.create_issue(project_key, issue_type, summary, description) -> {key, url}
  - push_extraction(client, extraction, project_key, issue_type) -> PushToJiraResult

All HTTP errors translate to HTTPException at the route layer; this module
raises bare Exception with the upstream message so callers can choose how
to surface it (per-story failure vs whole-batch abort).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException

from db.models import Extraction
from models import JiraProject, PushToJiraResult, PushedIssue

log = logging.getLogger("storyforge.jira")

# Sane HTTP timeout so a slow Atlassian instance doesn't pile up uvicorn
# workers. 20s covers most real Atlassian Cloud calls (median ~500ms).
HTTP_TIMEOUT = 20.0


class JiraClient:
    def __init__(self, base_url: str, email: str, api_token: str):
        # Strip trailing slash so URL building is predictable.
        self.base_url = (base_url or "").rstrip("/")
        self.auth = (email, api_token)

    def _headers(self) -> dict:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def list_projects(self) -> list[JiraProject]:
        """Return up to 50 projects visible to the connected user. Pagination
        beyond 50 isn't a v1 concern — picker UX would need search anyway."""
        url = f"{self.base_url}/rest/api/3/project/search?maxResults=50"
        try:
            r = httpx.get(url, auth=self.auth, headers=self._headers(), timeout=HTTP_TIMEOUT)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Could not reach Jira: {e}")
        if r.status_code == 401:
            raise HTTPException(status_code=401, detail="Jira auth failed — check email + API token in Settings.")
        if not r.is_success:
            raise HTTPException(status_code=502, detail=f"Jira projects fetch failed ({r.status_code}): {r.text[:200]}")
        body = r.json()
        # `/project/search` returns {values: [...]}; older `/project` returns a bare list.
        items = body.get("values", body) if isinstance(body, dict) else body
        return [JiraProject(id=p["id"], key=p["key"], name=p["name"]) for p in items]

    def create_issue(
        self,
        *,
        project_key: str,
        issue_type: str,
        summary: str,
        description_md: str,
    ) -> dict[str, str]:
        """Create one issue. Returns {key, url}.

        Description goes in via the Atlassian Document Format (ADF) — Jira
        Cloud no longer accepts plain markdown on v3. We build the simplest
        ADF wrapper (one paragraph node) and let the markdown render as
        plain text. Lossy but works without an MD→ADF conversion library;
        criteria render as `* item` lines. M6.2.b can swap in a real
        ADF builder if formatting matters more.
        """
        url = f"{self.base_url}/rest/api/3/issue"
        payload = {
            "fields": {
                "project": {"key": project_key},
                "issuetype": {"name": issue_type},
                "summary": summary[:255],   # Jira hard cap on summary
                "description": _md_to_adf(description_md),
            }
        }
        try:
            r = httpx.post(url, auth=self.auth, headers=self._headers(), json=payload, timeout=HTTP_TIMEOUT)
        except httpx.HTTPError as e:
            raise Exception(f"Network error: {e}")
        if r.status_code == 401:
            raise Exception("Jira auth failed (token rejected)")
        if r.status_code == 403:
            raise Exception("Jira permission denied (insufficient project access)")
        if not r.is_success:
            # Try to extract Jira's structured error for a useful message.
            try:
                err = r.json()
                msg = err.get("errorMessages") or list(err.get("errors", {}).values()) or [r.text[:200]]
                raise Exception(f"Jira rejected the issue: {' / '.join(msg)}")
            except Exception:
                raise Exception(f"Jira create failed ({r.status_code}): {r.text[:200]}")
        body = r.json()
        key = body["key"]
        return {"key": key, "url": f"{self.base_url}/browse/{key}"}


def _md_to_adf(md: str) -> dict:
    """Minimal markdown → Atlassian Document Format. Lines split on
    newlines; lines starting with `- ` or `* ` become bullet items;
    everything else is a paragraph. Good enough for a story description
    with a criteria checklist. NOT a general-purpose MD parser."""
    lines = (md or "").split("\n")
    content: list[dict] = []
    bullet_buffer: list[dict] = []

    def flush_bullets():
        if not bullet_buffer:
            return
        content.append({"type": "bulletList", "content": list(bullet_buffer)})
        bullet_buffer.clear()

    for line in lines:
        stripped = line.strip()
        if stripped.startswith(("- ", "* ")):
            text = stripped[2:].strip()
            bullet_buffer.append({
                "type": "listItem",
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
            })
        elif stripped:
            flush_bullets()
            content.append({
                "type": "paragraph",
                "content": [{"type": "text", "text": stripped}],
            })
        # Blank lines: just a paragraph break — flush bullets so a new list can start.
        elif bullet_buffer:
            flush_bullets()

    flush_bullets()
    return {"version": 1, "type": "doc", "content": content or [
        # Jira rejects an empty doc; ship a no-op paragraph instead.
        {"type": "paragraph", "content": []}
    ]}


def _build_story_description(story: dict[str, Any]) -> str:
    """Markdown for one story. Renders `As a / I want / so that`, criteria
    as a bullet list, plus the source quote when present."""
    parts = []
    actor = story.get("actor", "")
    parts.append(f"As a {actor}, I want {story.get('want', '')}, so that {story.get('so_that', '')}.")
    if story.get("section"):
        parts.append(f"Source: {story['section']}")
    parts.append("")
    criteria = story.get("criteria") or []
    if criteria:
        parts.append("Acceptance criteria:")
        for c in criteria:
            parts.append(f"- {c}")
    if story.get("source_quote"):
        parts.append("")
        parts.append(f"Source quote: \"{story['source_quote']}\"")
    return "\n".join(parts)


def push_extraction(
    client: JiraClient,
    extraction: Extraction,
    *,
    project_key: str,
    issue_type: str = "Story",
) -> PushToJiraResult:
    """Push every story in the extraction as a Jira issue. Per-story
    failures are recorded in `failed[]` rather than aborting the batch —
    if 7/10 stories land cleanly and 3 hit a missing custom-field error,
    the user gets the 7 plus a per-row failure list to fix the 3.
    """
    pushed: list[PushedIssue] = []
    failed: list[dict] = []
    stories = extraction.stories or []
    for s in stories:
        try:
            summary = f"{s.get('id', '?')}: {s.get('want', '')[:200]}"
            description = _build_story_description(s)
            res = client.create_issue(
                project_key=project_key,
                issue_type=issue_type,
                summary=summary,
                description_md=description,
            )
            pushed.append(PushedIssue(
                story_id=s.get("id", ""),
                issue_key=res["key"],
                issue_url=res["url"],
            ))
        except Exception as e:
            log.warning("jira push failed for story %s: %s", s.get("id"), e)
            failed.append({"story_id": s.get("id", ""), "error": str(e)})
    return PushToJiraResult(pushed=pushed, failed=failed)
