"""M14.10 — Diff two dossier payloads, return a structured changelog.

The frontend already knows how to list versions (root_id star topology).
This module compares two `lens_payload` dicts (typically v1 vs vN) and
produces a section-by-section breakdown of what's added / removed /
changed. Used by GET /api/extractions/{id}/diff/{prior_id}.

Diff strategy by section type:

- Scalar string fields (brief.summary, tldr_ladder.*, five_w_one_h.*,
  intro/closing/overture/bridges, *_intro fields):
    'changed' if both sides differ; carry both texts verbatim. UI can
    apply word-level diff client-side if it wants.

- List-of-strings (decisions_made, decisions_open, brief.tags):
    Item identity = the string itself. Set-difference both ways gives
    added + removed; no 'changed' bucket.

- List-of-objects (action_items, five_whys, assumptions, inversion,
  better_questions, what_to_revisit, glossary, mindmap.branches,
  domain.*.points, systems.*, timeline.phases, numbers_extract.facts,
  user_stories, negative_space.items):
    Each kind has a 'natural key' — e.g. action_items keyed on
    (owner+action), assumptions on assumption text, glossary on term.
    Same key both sides + different content → 'changed'. Only on one
    side → 'added' / 'removed'.

The output shape is JSON-stable so the frontend renderer is dumb:

  {
    "sections": [
      {
        "key": "brief",
        "label": "Brief",
        "kind": "scalar_block",
        "changes": [{"path": "brief.summary", "before": "...", "after": "..."}],
      },
      {
        "key": "action_items",
        "label": "Action Items",
        "kind": "list_objects",
        "added": [...], "removed": [...], "changed": [{"before": ..., "after": ...}],
      },
      ...
    ]
  }
"""

from __future__ import annotations

from typing import Any


def _scalar_block(label: str, key: str, before_root: dict, after_root: dict, paths: list[str]) -> dict | None:
    """Walk a list of dotted paths and report any that differ. Returns None if
    nothing changed in this section so the frontend can skip rendering."""
    changes = []
    for p in paths:
        b = _walk(before_root, p)
        a = _walk(after_root, p)
        if b != a:
            changes.append({"path": p, "before": b, "after": a})
    if not changes:
        return None
    return {"key": key, "label": label, "kind": "scalar_block", "changes": changes}


def _walk(root: dict | None, dotted: str) -> Any:
    """Best-effort walk; missing segments resolve to None rather than raise."""
    if root is None:
        return None
    cur: Any = root
    for seg in dotted.split("."):
        if isinstance(cur, dict):
            cur = cur.get(seg)
        elif isinstance(cur, list):
            try:
                idx = int(seg)
            except ValueError:
                return None
            if idx < 0 or idx >= len(cur):
                return None
            cur = cur[idx]
        else:
            return None
    return cur


def _diff_string_list(label: str, key: str, before: list[str] | None, after: list[str] | None) -> dict | None:
    bset = set(before or [])
    aset = set(after or [])
    added = sorted(aset - bset)
    removed = sorted(bset - aset)
    if not added and not removed:
        return None
    return {"key": key, "label": label, "kind": "list_strings", "added": added, "removed": removed}


def _diff_object_list(
    label: str,
    key: str,
    before: list[dict] | None,
    after: list[dict] | None,
    keyfn,
) -> dict | None:
    """Compare two object-lists by a natural key. `keyfn(obj)` is the identity."""
    bmap = {keyfn(o): o for o in (before or [])}
    amap = {keyfn(o): o for o in (after or [])}
    added = [amap[k] for k in amap if k not in bmap]
    removed = [bmap[k] for k in bmap if k not in amap]
    changed = [{"before": bmap[k], "after": amap[k]} for k in bmap if k in amap and bmap[k] != amap[k]]
    if not added and not removed and not changed:
        return None
    return {
        "key": key, "label": label, "kind": "list_objects",
        "added": added, "removed": removed, "changed": changed,
    }


def diff_dossiers(before: dict | None, after: dict | None) -> dict:
    """Return a stable diff between two dossier `lens_payload` dicts."""
    before = before or {}
    after = after or {}
    sections: list[dict] = []

    # ---- Narrative bookends ----
    sec = _scalar_block(
        "Narrative bookends", "narrative", before, after,
        ["overture", "closing", "orient_intro", "structure_intro", "interrogate_intro", "act_intro"],
    )
    if sec:
        sections.append(sec)

    # ---- Brief ----
    sec = _scalar_block("Brief", "brief", before, after, ["brief.summary"])
    if sec:
        sections.append(sec)
    sec = _diff_string_list("Brief tags", "brief_tags", _walk(before, "brief.tags"), _walk(after, "brief.tags"))
    if sec:
        sections.append(sec)

    # ---- TLDR Ladder ----
    sec = _scalar_block(
        "TLDR Ladder", "tldr_ladder", before, after,
        ["tldr_ladder.one_line", "tldr_ladder.one_paragraph", "tldr_ladder.one_page"],
    )
    if sec:
        sections.append(sec)

    # ---- 5W1H ----
    sec = _scalar_block(
        "5W1H", "five_w_one_h", before, after,
        ["five_w_one_h.who", "five_w_one_h.what", "five_w_one_h.when",
         "five_w_one_h.where", "five_w_one_h.why", "five_w_one_h.how"],
    )
    if sec:
        sections.append(sec)

    # ---- Glossary ----
    sec = _diff_object_list(
        "Glossary", "glossary",
        _walk(before, "glossary"), _walk(after, "glossary"),
        keyfn=lambda t: (t.get("term") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- 5 Whys ----
    sec = _diff_object_list(
        "5 Whys", "five_whys",
        _walk(before, "five_whys"), _walk(after, "five_whys"),
        keyfn=lambda s: (s.get("question") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- Assumptions ----
    sec = _diff_object_list(
        "Assumptions Audit", "assumptions",
        _walk(before, "assumptions"), _walk(after, "assumptions"),
        keyfn=lambda a: (a.get("assumption") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- Inversion ----
    sec = _diff_object_list(
        "Inversion", "inversion",
        _walk(before, "inversion"), _walk(after, "inversion"),
        keyfn=lambda f: (f.get("scenario") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- Better Questions ----
    sec = _diff_object_list(
        "Better Questions", "better_questions",
        _walk(before, "better_questions"), _walk(after, "better_questions"),
        keyfn=lambda q: (q.get("question") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- Action Items ----
    sec = _diff_object_list(
        "Action Items", "action_items",
        _walk(before, "action_items"), _walk(after, "action_items"),
        keyfn=lambda a: ((a.get("owner") or "") + "|" + (a.get("action") or "")).strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- Decisions ----
    sec = _diff_string_list(
        "Decisions made", "decisions_made",
        _walk(before, "decisions_made"), _walk(after, "decisions_made"),
    )
    if sec:
        sections.append(sec)
    sec = _diff_string_list(
        "Decisions open", "decisions_open",
        _walk(before, "decisions_open"), _walk(after, "decisions_open"),
    )
    if sec:
        sections.append(sec)

    # ---- What to Revisit ----
    sec = _diff_object_list(
        "What to Revisit", "what_to_revisit",
        _walk(before, "what_to_revisit"), _walk(after, "what_to_revisit"),
        keyfn=lambda r: (r.get("item") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- M14.3 sections (numbers / timeline / negative space) ----
    sec = _diff_object_list(
        "Numbers Extract", "numbers_extract",
        _walk(before, "numbers_extract.facts"), _walk(after, "numbers_extract.facts"),
        keyfn=lambda f: ((f.get("category") or "") + "|" + (f.get("label") or "")).strip().lower(),
    )
    if sec:
        sections.append(sec)
    sec = _diff_object_list(
        "Timeline", "timeline",
        _walk(before, "timeline.phases"), _walk(after, "timeline.phases"),
        keyfn=lambda p: (p.get("label") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)
    sec = _diff_object_list(
        "Negative Space", "negative_space",
        _walk(before, "negative_space.items"), _walk(after, "negative_space.items"),
        keyfn=lambda i: (i.get("missing_item") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # ---- User Stories ----
    sec = _diff_object_list(
        "User Stories", "user_stories",
        _walk(before, "user_stories"), _walk(after, "user_stories"),
        keyfn=lambda s: (s.get("id") or "").strip().lower(),
    )
    if sec:
        sections.append(sec)

    # Aggregate counts so the top-of-page badge can read at a glance.
    n_changed = sum(1 for s in sections)
    n_added = sum(len(s.get("added") or []) for s in sections)
    n_removed = sum(len(s.get("removed") or []) for s in sections)
    n_modified = sum(len(s.get("changed") or []) for s in sections) + sum(
        len(s.get("changes") or []) for s in sections
    )

    return {
        "sections": sections,
        "summary": {
            "sections_changed": n_changed,
            "items_added": n_added,
            "items_removed": n_removed,
            "items_modified": n_modified,
        },
    }
