"""Linear GraphQL client (M6.3).

Linear is GraphQL-only — one POST endpoint at https://api.linear.app/graphql
that accepts a query/mutation in the body. Auth is a single header
`Authorization: <api_key>` (no `Bearer ` prefix — Linear's own quirk).

Personal API keys are issued at https://linear.app/settings/api and stored
encrypted server-side via `services/byok.encrypt_secret` — same pattern as
the Anthropic BYOK key + the Jira token (M6.2).

We use httpx (consistent with Jira + LSQ + Resend; simpler mocks than
the official SDKs). For two queries this is a few dozen lines vs pulling
in `gql` + its async stack.

Public surface:
  - LinearClient.list_teams() -> list[LinearTeam]
  - LinearClient.create_issue(team_id, title, description) -> {id, identifier, url}
  - push_extraction(client, extraction, team_id) -> PushToLinearResult
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException

from db.models import Extraction
from models import LinearTeam, PushedIssue, PushToLinearResult

log = logging.getLogger("storyforge.linear")

LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"
HTTP_TIMEOUT = 20.0


class LinearClient:
    def __init__(self, api_key: str):
        self.api_key = (api_key or "").strip()

    def _headers(self) -> dict:
        # Linear quirk: NO `Bearer ` prefix on the Authorization header.
        # The API rejects with 401 if you add it.
        return {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
        }

    def _gql(self, query: str, variables: dict | None = None) -> dict:
        try:
            r = httpx.post(
                LINEAR_GRAPHQL_URL,
                headers=self._headers(),
                json={"query": query, "variables": variables or {}},
                timeout=HTTP_TIMEOUT,
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Could not reach Linear: {e}")
        if r.status_code == 401:
            raise HTTPException(status_code=401, detail="Linear auth failed — re-enter the API key in Settings.")
        if not r.is_success:
            raise HTTPException(status_code=502, detail=f"Linear request failed ({r.status_code}): {r.text[:200]}")
        body = r.json()
        # GraphQL errors come back with a 200 status + an `errors` array. Surface them.
        if "errors" in body and body["errors"]:
            msg = "; ".join(e.get("message", "?") for e in body["errors"][:2])
            raise HTTPException(status_code=502, detail=f"Linear GraphQL error: {msg}")
        return body.get("data") or {}

    def list_teams(self) -> list[LinearTeam]:
        """Up to 50 teams visible to the authed user. Most workspaces have
        single-digit teams so pagination beyond 50 is a non-concern for v1."""
        query = """
        query Teams { teams(first: 50) { nodes { id key name } } }
        """
        data = self._gql(query)
        nodes = (data.get("teams") or {}).get("nodes") or []
        return [LinearTeam(id=t["id"], key=t["key"], name=t["name"]) for t in nodes]

    def create_issue(
        self,
        *,
        team_id: str,
        title: str,
        description_md: str,
    ) -> dict[str, str]:
        """Create one issue. Linear accepts markdown directly in the
        `description` field — no ADF conversion (unlike Jira). Returns
        {id, identifier, url}."""
        mutation = """
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier url }
          }
        }
        """
        # Linear's title cap is 256; trim to be safe.
        result = self._gql(mutation, {
            "input": {
                "teamId": team_id,
                "title": title[:256],
                "description": description_md,
            }
        })
        payload = result.get("issueCreate") or {}
        if not payload.get("success") or not payload.get("issue"):
            raise Exception("Linear rejected the issue (issueCreate.success=false)")
        issue = payload["issue"]
        return {
            "id": issue["id"],
            "identifier": issue["identifier"],
            "url": issue["url"],
        }


def _build_story_description(story: dict[str, Any]) -> str:
    """Markdown for one story. Same shape as the Jira version (services/jira.py
    `_build_story_description`) — kept duplicated rather than abstracted so
    each tracker can diverge if its description conventions differ later."""
    parts = []
    actor = story.get("actor", "")
    parts.append(f"As a {actor}, I want {story.get('want', '')}, so that {story.get('so_that', '')}.")
    if story.get("section"):
        parts.append(f"_Source: {story['section']}_")
    parts.append("")
    criteria = story.get("criteria") or []
    if criteria:
        parts.append("**Acceptance criteria:**")
        for c in criteria:
            parts.append(f"- {c}")
    if story.get("source_quote"):
        parts.append("")
        parts.append(f"> {story['source_quote']}")
    return "\n".join(parts)


def push_extraction(
    client: LinearClient,
    extraction: Extraction,
    *,
    team_id: str,
) -> PushToLinearResult:
    """Push every story in the extraction as a Linear issue. Per-story
    failures land in `failed[]` so a partial success keeps the work that
    landed (mirrors the Jira push_extraction contract)."""
    pushed: list[PushedIssue] = []
    failed: list[dict] = []
    for s in (extraction.stories or []):
        try:
            title = f"{s.get('id', '?')}: {s.get('want', '')[:200]}"
            description = _build_story_description(s)
            res = client.create_issue(
                team_id=team_id,
                title=title,
                description_md=description,
            )
            pushed.append(PushedIssue(
                story_id=s.get("id", ""),
                issue_key=res["identifier"],
                issue_url=res["url"],
            ))
        except Exception as e:
            log.warning("linear push failed for story %s: %s", s.get("id"), e)
            failed.append({"story_id": s.get("id", ""), "error": str(e)})
    return PushToLinearResult(pushed=pushed, failed=failed)
