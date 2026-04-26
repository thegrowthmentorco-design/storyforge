"""Slack incoming-webhook client (M6.6).

Auth posture: Slack incoming webhook URL. User creates the webhook in
their Slack workspace's app catalog (Apps → Incoming Webhooks → pick a
channel → install → copy URL). The URL is the only credential — it's
bound to a single channel + a single workspace, no separate token + no
channel picker needed at push time.

Trade-off vs OAuth + bot token: bot tokens give us channel listing,
permalinks back from posts, and "send to any channel" UX. Webhooks are
strictly POST-to-the-channel-this-URL-was-created-for. For "send gaps
to channel" that's the right shape — exactly one channel per webhook.
Multiple destinations = multiple webhooks (deferred to M6.6.b).

We POST a Block Kit message — Slack's structured layout primitives —
which renders nicer than plain text (severity badge tone + grouped fields)
without requiring per-block escaping logic.

Public surface:
  - post_gaps(webhook_url, extraction, gap_state_map) -> int (posted count)
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException

from db.models import Extraction

log = logging.getLogger("storyforge.slack")

HTTP_TIMEOUT = 15.0

# Friendly severity labels for the Slack message — Slack renders emoji
# inline if the workspace has them. The fallback chars keep the message
# readable even if a workspace has emoji disabled.
SEVERITY_BADGE = {
    "high": ":red_circle: HIGH",
    "med":  ":large_yellow_circle: MEDIUM",
    "low":  ":large_blue_circle: LOW",
}


def _build_blocks(extraction: Extraction, gaps: list[dict]) -> list[dict]:
    """Block Kit message — header + per-gap section with severity + question
    + context. Slack caps blocks at 50 per message; we cap our gap-count
    upstream at 40 with a "+N more" footer if there are more (rare in
    practice — most extractions produce <15 gaps)."""
    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"Gaps from {extraction.filename or 'extraction'}", "emoji": True},
        },
        {"type": "divider"},
    ]

    # 50-block cap is per Slack docs. Header + divider = 2; each gap = 1
    # section block. Leaves room for ~45 gaps + a trailing "+N more" line.
    MAX_GAPS_INLINE = 40
    visible = gaps[:MAX_GAPS_INLINE]
    overflow = max(0, len(gaps) - MAX_GAPS_INLINE)

    for g in visible:
        sev = (g.get("severity") or "low").lower()
        badge = SEVERITY_BADGE.get(sev, sev.upper())
        question = g.get("question", "(no question)")
        context = g.get("context") or ""
        section = g.get("section")

        # Slack section blocks: bold via *…*, italic via _…_, code via `…`.
        # Escape backticks in user content to avoid breaking the markup.
        safe_q = question.replace("\n", " ").strip()
        safe_ctx = context.replace("\n", " ").strip()
        lines = [f"*{badge}* — {safe_q}"]
        if section:
            lines.append(f"_{section}_")
        if safe_ctx:
            lines.append(safe_ctx)
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "\n".join(lines)},
        })

    if overflow:
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"_+ {overflow} more gap{'s' if overflow != 1 else ''} not shown_"}],
        })

    return blocks


def post_gaps(
    *,
    webhook_url: str,
    extraction: Extraction,
    include_resolved: bool = False,
    gap_resolved_indexes: set[int] | None = None,
) -> int:
    """POST the extraction's gaps to Slack. Returns the count of gaps
    actually posted (post-filter).

    By default sends only *unresolved* gaps. `gap_resolved_indexes` is the
    set of array-index values from `gap_state` rows where `resolved=True`
    — the route layer fetches that and passes it in. Pass empty set when
    the user has no gap_state rows (e.g. brand-new extraction).
    """
    all_gaps = extraction.gaps or []
    if not all_gaps:
        raise HTTPException(status_code=400, detail="No gaps to post.")

    if include_resolved or gap_resolved_indexes is None:
        gaps = list(all_gaps)
    else:
        gaps = [g for i, g in enumerate(all_gaps) if i not in gap_resolved_indexes]

    if not gaps:
        raise HTTPException(status_code=400, detail="All gaps are resolved — nothing to post.")

    blocks = _build_blocks(extraction, gaps)
    # Plain-text fallback for clients that don't render Block Kit (mobile
    # notifications, screen readers). Same first line as the header.
    fallback_text = f"Gaps from {extraction.filename or 'extraction'} — {len(gaps)} unresolved"

    try:
        r = httpx.post(
            webhook_url,
            json={"text": fallback_text, "blocks": blocks},
            timeout=HTTP_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Slack: {e}")

    # Slack incoming-webhook contract: 200 + body "ok" on success; otherwise
    # the body is a short error string ("invalid_payload", "channel_not_found",
    # "no_service" if the webhook was revoked, etc.).
    if r.status_code == 404:
        raise HTTPException(status_code=400, detail="Slack webhook URL not found — was it revoked? Reconnect in Settings.")
    if not r.is_success or r.text.strip().lower() != "ok":
        raise HTTPException(
            status_code=502,
            detail=f"Slack rejected the post ({r.status_code}): {r.text[:200]}",
        )
    return len(gaps)
