"""CRUD routes for stored extractions + per-gap state (M2.2 + M3.2 isolation)."""

from __future__ import annotations

import logging
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import func, or_
from sqlmodel import Session, select

from auth.deps import CurrentUser, current_user
from db.models import Extraction, GapState, Project
from db.session import get_session
from models import (
    DossierEditPatch,
    DossierRegenRequest,
    ExtractionImport,
    ExtractionPatch,
    ExtractionRecord,
    ExtractionRegenRequest,
    ExtractionRerunRequest,
    ExtractionSummary,
    ExtractionVersion,
    GapStatePatch,
    GapStateRead,
)
from services.byok import resolve_user_byok
from services.extractions import (
    call_claude,
    delete_extraction,
    extraction_to_record,
    extraction_to_summary,
    gap_state_to_read,
    list_versions,
    persist_extraction,
    record_usage,
    resolved_source_paths,
    root_id_for,
)
from services.few_shot import resolve_enabled_examples
from services.limits import enforce_limits
from services.prompts import resolve_prompt_suffix
from services.regen import regen_section
from services.scope import apply_scope, in_scope

log = logging.getLogger("storyforge.extractions")
router = APIRouter(prefix="/api/extractions", tags=["extractions"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(current_user)]

# Markdown/RST aren't in the platform mimetypes db on every host. Register
# explicitly so /source returns a stable content-type the browser can render.
mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("text/markdown", ".markdown")
mimetypes.add_type("text/x-rst", ".rst")


def _owned_extraction(session: Session, extraction_id: str, user: CurrentUser) -> Extraction:
    """Fetch an extraction, asserting it's in the caller's current scope.

    Returns 404 on miss-or-foreign (whether foreign-user in personal context
    or foreign-org in workspace context) — no existence leak across scopes.
    """
    row = session.get(Extraction, extraction_id)
    if not in_scope(row, user):
        raise HTTPException(status_code=404, detail="Extraction not found")
    return row


# ---------------- list ----------------


@router.get("", response_model=list[ExtractionSummary])
def list_extractions(
    session: SessionDep,
    user: UserDep,
    q: str | None = Query(default=None, description="Substring match on filename or brief.summary (case-insensitive)"),
    project_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[ExtractionSummary]:
    """List extractions, newest first. Lightweight rows for the Documents view.

    Search is case-insensitive substring across filename + the brief's summary
    (extracted via SQLite's `json_extract`). Tag search is intentionally left
    out — JSON-array LIKE in SQLite is fiddly; we'll add proper tag indexing
    if it shows up in usage.
    """
    stmt = apply_scope(select(Extraction), Extraction, user)
    if project_id:
        stmt = stmt.where(Extraction.project_id == project_id)
    if q:
        needle = f"%{q.strip().lower()}%"
        summary_expr = func.json_extract(Extraction.brief, "$.summary")
        stmt = stmt.where(
            or_(
                func.lower(Extraction.filename).like(needle),
                func.lower(summary_expr).like(needle),
            )
        )
    stmt = stmt.order_by(Extraction.created_at.desc()).offset(offset).limit(limit)
    rows = session.exec(stmt).all()
    return [extraction_to_summary(r) for r in rows]


# ---------------- detail ----------------


@router.get("/{extraction_id}", response_model=ExtractionRecord)
def get_extraction(extraction_id: str, session: SessionDep, user: UserDep) -> ExtractionRecord:
    # M4.5.3.b — pass session + user_id so the response carries
    # `unread_comment_count` for this caller.
    return extraction_to_record(
        _owned_extraction(session, extraction_id, user),
        session=session,
        user_id=user.user_id,
    )


# ---------------- mark seen (M4.5.3.b) ----------------


@router.post("/{extraction_id}/seen", status_code=204)
def mark_seen(extraction_id: str, session: SessionDep, user: UserDep) -> None:
    """Mark this extraction as read by the calling user. Upserts the
    ExtractionView row with last_seen_at = now so subsequent fetches see
    `unread_comment_count: 0` until a new comment lands."""
    from services.extractions import mark_extraction_seen
    row = _owned_extraction(session, extraction_id, user)
    mark_extraction_seen(session, row.id, user.user_id)
    return None


# ---------------- patch ----------------


@router.patch("/{extraction_id}", response_model=ExtractionRecord)
def patch_extraction(
    extraction_id: str, patch: ExtractionPatch, session: SessionDep, user: UserDep
) -> ExtractionRecord:
    row = _owned_extraction(session, extraction_id, user)

    if patch.filename is not None:
        name = patch.filename.strip()
        if not name:
            raise HTTPException(status_code=400, detail="filename cannot be empty")
        row.filename = name

    if patch.project_id is not None:
        # Empty string clears the link; non-empty must match a project in
        # the caller's current scope (M3.3 — same workspace).
        if patch.project_id == "":
            row.project_id = None
        else:
            proj = session.get(Project, patch.project_id)
            if not in_scope(proj, user):
                raise HTTPException(status_code=400, detail="Unknown project_id")
            row.project_id = patch.project_id

    # M4.1 — artifact edits. Each present field is a full replacement; the
    # Pydantic types on ExtractionPatch already validated the shape, so we
    # just need to dump back to plain dict/list for JSON-column storage.
    if patch.brief is not None:
        row.brief = patch.brief.model_dump()
    if patch.actors is not None:
        row.actors = patch.actors
    if patch.stories is not None:
        row.stories = [s.model_dump() for s in patch.stories]
    if patch.nfrs is not None:
        row.nfrs = [n.model_dump() for n in patch.nfrs]
    if patch.gaps is not None:
        row.gaps = [g.model_dump() for g in patch.gaps]

    session.add(row)
    session.commit()
    session.refresh(row)
    return extraction_to_record(row)


# ---------------- M14.7 — dossier edit-in-place ----------------


_REVISION_CAP = 50


def _walk_dossier_path(payload: dict, path: str):
    """Walk a dotted path through `payload`, returning (parent, last_key).

    Raises HTTPException(400) if the path doesn't resolve. Numeric segments
    are interpreted as list indices; everything else is dict keys. We split
    only on '.' — the schema doesn't use dotted keys so this is unambiguous.
    """
    parts = path.split(".")
    if not parts or parts == [""]:
        raise HTTPException(status_code=400, detail="path cannot be empty")
    cur = payload
    for seg in parts[:-1]:
        if isinstance(cur, list):
            try:
                idx = int(seg)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"path expects index, got {seg!r}")
            if idx < 0 or idx >= len(cur):
                raise HTTPException(status_code=400, detail=f"index out of range: {seg}")
            cur = cur[idx]
        elif isinstance(cur, dict):
            if seg not in cur:
                raise HTTPException(status_code=400, detail=f"unknown segment: {seg}")
            cur = cur[seg]
        else:
            raise HTTPException(status_code=400, detail=f"cannot descend into scalar at {seg}")
    last = parts[-1]
    if isinstance(cur, list):
        try:
            idx = int(last)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"path expects index, got {last!r}")
        if idx < 0 or idx >= len(cur):
            raise HTTPException(status_code=400, detail=f"index out of range: {last}")
        return cur, idx
    if isinstance(cur, dict):
        if last not in cur:
            raise HTTPException(status_code=400, detail=f"unknown segment: {last}")
        return cur, last
    raise HTTPException(status_code=400, detail="terminal path is not addressable")


@router.patch("/{extraction_id}/dossier", response_model=ExtractionRecord)
def patch_dossier(
    extraction_id: str, patch: DossierEditPatch, session: SessionDep, user: UserDep
) -> ExtractionRecord:
    """Edit one node in a dossier's lens_payload (M14.7).

    Walks the dotted `path`, swaps the value, appends a revision entry.
    Only valid for rows with lens='dossier' and a non-null lens_payload.
    """
    row = _owned_extraction(session, extraction_id, user)
    if row.lens != "dossier" or row.lens_payload is None:
        raise HTTPException(status_code=400, detail="extraction has no editable dossier payload")

    # Deep-copy so we don't mutate the SQLModel attribute in place — JSON
    # columns won't always detect in-place dict mutation as dirty.
    import copy
    payload = copy.deepcopy(row.lens_payload)

    parent, key = _walk_dossier_path(payload, patch.path)
    before = copy.deepcopy(parent[key])
    parent[key] = patch.value

    revisions = list(row.dossier_revisions or [])
    revisions.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "user_id": user.user_id,
        "path": patch.path,
        "before": before,
        "after": patch.value,
    })
    if len(revisions) > _REVISION_CAP:
        revisions = revisions[-_REVISION_CAP:]

    row.lens_payload = payload
    row.dossier_revisions = revisions
    session.add(row)
    session.commit()
    session.refresh(row)
    return extraction_to_record(row)


# ---------------- source file (M2.3.2) ----------------


def _serve_source_path(stored_path: str, display_filename: str):
    """Serve one stored source path — R2 → presigned redirect, else FileResponse.

    Extracted from /source so /sources/{idx} (M7.5.b) shares the exact same
    serving rules. `display_filename` is the name shown in the Content-
    Disposition header — for multi-doc rows we use the per-doc filename
    derived from the R2 key / disk path, not the row's combined filename.
    """
    from services import storage  # local import keeps boto3 off the path
                                  # for callers that don't use it.

    if storage.is_r2_path(stored_path):
        try:
            url = storage.presigned_get_url(stored_path)
        except Exception as e:  # noqa: BLE001
            log.warning("presigned_get_url failed for %s: %s", stored_path, e)
            raise HTTPException(status_code=404, detail="Source file is missing on disk")
        # 302 + Cache-Control:no-store so a stale URL doesn't survive past the
        # 15-min presign window in any intermediary cache.
        return RedirectResponse(url=url, status_code=302, headers={"Cache-Control": "no-store"})

    path = Path(stored_path)
    if not path.exists():
        log.warning("source_file_path missing on disk: %s", path)
        raise HTTPException(status_code=404, detail="Source file is missing on disk")
    media_type, _ = mimetypes.guess_type(display_filename)
    return FileResponse(
        path,
        media_type=media_type or "application/octet-stream",
        filename=display_filename,
    )


def _filename_from_stored_path(stored_path: str) -> str:
    """Recover the per-doc filename from a stored R2/local source path.

    R2 layout from save_upload: `r2://<bucket>/<extraction_id>/<safe_name>`.
    Local layout: `<UPLOAD_ROOT>/<extraction_id>/<safe_name>`. In both cases
    the basename is the on-disk safe filename — close enough to the original
    for the download UX (a user with two .pdfs picks them apart by name).
    """
    return Path(stored_path).name or "source"


@router.get("/{extraction_id}/source")
def get_source(extraction_id: str, session: SessionDep, user: UserDep):
    """Return the original uploaded file (or the first one for multi-doc rows).

    M3.9: when the source lives on R2 we 302-redirect to a presigned URL
    (15-minute TTL) — the browser fetches direct from Cloudflare, no proxy.
    Local-disk uploads keep using FileResponse for dev parity.

    M7.5.b: for multi-doc extractions this returns the *first* file (preserves
    the single-file URL contract for older clients). Use `/sources/{idx}`
    for explicit per-doc downloads.

    404 covers five cases (missing row, foreign owner, paste-mode extraction,
    file vanished, R2 path malformed) — same user-facing answer.
    """
    row = _owned_extraction(session, extraction_id, user)
    paths = resolved_source_paths(row)
    if not paths:
        raise HTTPException(status_code=404, detail="No source file for this extraction")
    return _serve_source_path(paths[0], row.filename)


@router.get("/{extraction_id}/sources/{idx}")
def get_source_by_index(extraction_id: str, idx: int, session: SessionDep, user: UserDep):
    """Return the i-th uploaded source file (M7.5.b — multi-doc).

    Index is 0-based to match the `source_file_paths` array. The 1-based
    `source_doc` field on stories/nfrs/gaps maps to `idx = source_doc - 1`
    when source_doc > 0; the frontend handles that mapping.
    """
    row = _owned_extraction(session, extraction_id, user)
    paths = resolved_source_paths(row)
    if not paths:
        raise HTTPException(status_code=404, detail="No source file for this extraction")
    if idx < 0 or idx >= len(paths):
        raise HTTPException(status_code=404, detail="Source index out of range")
    stored = paths[idx]
    # For single-doc rows, use the row's filename (it carries the original
    # client-supplied name). For multi-doc rows, derive per-doc names from
    # the stored path so each download is recognisable.
    display = row.filename if len(paths) == 1 else _filename_from_stored_path(stored)
    return _serve_source_path(stored, display)


# ---------------- export (M6.1) ----------------


@router.get("/{extraction_id}/export.docx")
def export_docx(extraction_id: str, session: SessionDep, user: UserDep):
    """Render the extraction as a .docx file. MD/JSON/CSV are generated
    client-side (the frontend already holds the full record); DOCX needs
    python-docx + zipping, so it lives server-side."""
    from fastapi.responses import Response
    from services.exports import build_docx

    row = _owned_extraction(session, extraction_id, user)
    data = build_docx(row)
    # Strip the source-file extension so the export name reads clean
    # ("requirements.docx" not "requirements.pdf.docx").
    base = (row.filename or "extraction").rsplit(".", 1)[0]
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{base}.docx"'},
    )


# ---------------- delete ----------------


@router.delete("/{extraction_id}", status_code=204)
def delete_one(extraction_id: str, session: SessionDep, user: UserDep) -> None:
    if not delete_extraction(session, extraction_id, user=user):
        raise HTTPException(status_code=404, detail="Extraction not found")
    return None


# ---------------- versioning (M2.6) ----------------


@router.get("/{extraction_id}/versions", response_model=list[ExtractionVersion])
def get_versions(extraction_id: str, session: SessionDep, user: UserDep) -> list[ExtractionVersion]:
    """All versions in the chain this id belongs to that the user owns."""
    versions = list_versions(session, extraction_id, user=user)
    if not versions:
        raise HTTPException(status_code=404, detail="Extraction not found")
    return versions


@router.post("/{extraction_id}/rerun", response_model=ExtractionRecord, status_code=201)
def rerun_extraction(
    extraction_id: str,
    session: SessionDep,
    user: UserDep,
    _payload: ExtractionRerunRequest | None = None,
    x_anthropic_key: str | None = Header(default=None, alias="X-Anthropic-Key"),
    x_storyforge_model: str | None = Header(default=None, alias="X-Storyforge-Model"),
) -> ExtractionRecord:
    """Re-extract the same source document, creating a new linked version.

    The new row inherits filename, raw_text, and project_id from the source,
    but uses the current request's API key + model — so users can re-run with
    a different model and compare. `root_id` always points at the v1 (star
    topology), so a re-run of a re-run still rolls up to the same root.
    """
    source = _owned_extraction(session, extraction_id, user)

    # M3.4.5: stored BYOK + model fall through when header omitted.
    effective_key, stored_model = resolve_user_byok(session, user.user_id, x_anthropic_key)
    effective_model = x_storyforge_model or stored_model

    # M3.5.4: same plan gates as /api/extract — re-runs count against the
    # user's monthly quota too (re-extraction is a paid operation).
    enforce_limits(session, user, raw_text=source.raw_text, model=effective_model)

    suffix = resolve_prompt_suffix(session, user.user_id, user.org_id)  # M7.1
    examples = resolve_enabled_examples(session, user.user_id, user.org_id)  # M7.2
    result, model_used, usage = call_claude(
        filename=source.filename,
        raw_text=source.raw_text,
        api_key=effective_key,
        model=effective_model,
        prompt_suffix=suffix,
        few_shot_examples=examples,
    )

    row = persist_extraction(
        session,
        result=result,
        model_used=model_used,
        user_id=user.user_id,
        org_id=user.org_id,
        project_id=source.project_id,
        root_id=root_id_for(source),
    )
    record_usage(
        session,
        user_id=user.user_id,
        org_id=user.org_id,
        extraction_id=row.id,
        action="rerun",
        model=model_used,
        live=result.live,
        usage=usage,
    )
    return extraction_to_record(row)


# ---------------- regen one section (M4.4) ----------------


@router.post("/{extraction_id}/regen", response_model=ExtractionRecord)
def regen_extraction_section(
    extraction_id: str,
    payload: ExtractionRegenRequest,
    session: SessionDep,
    user: UserDep,
    x_anthropic_key: str | None = Header(default=None, alias="X-Anthropic-Key"),
    x_storyforge_model: str | None = Header(default=None, alias="X-Storyforge-Model"),
) -> ExtractionRecord:
    """Regenerate one section (stories / nfrs / gaps) on the same row.

    Counts as one Claude call against the user's monthly quota — same as
    rerun. The other sections + brief + actors are passed to the model as
    *stable context* so the regen respects the user's M4.1 inline edits.

    No new extraction row is created (unlike `/rerun`); the existing row's
    JSON column for the target section is replaced in place. Versioning
    semantics: regen is treated as a refinement of the same logical
    extraction, not a fork. Use `/rerun` if you want a snapshot.
    """
    row = _owned_extraction(session, extraction_id, user)

    effective_key, stored_model = resolve_user_byok(session, user.user_id, x_anthropic_key)
    effective_model = x_storyforge_model or stored_model

    # Same plan gates as /api/extract — regen is a paid Claude call.
    enforce_limits(session, user, raw_text=row.raw_text or "", model=effective_model)

    suffix = resolve_prompt_suffix(session, user.user_id, user.org_id)  # M7.1
    new_items, model_used, usage = regen_section(
        section=payload.section,
        filename=row.filename,
        raw_text=row.raw_text or "",
        brief=row.brief or {},
        actors=row.actors or [],
        stories=row.stories or [],
        nfrs=row.nfrs or [],
        gaps=row.gaps or [],
        api_key=effective_key,
        model=effective_model,
        prompt_suffix=suffix,
    )

    # Write back. Use setattr because the section name comes from a Literal
    # — the type checker is happy with str access on the SQLModel attrs.
    setattr(row, payload.section, new_items)
    session.add(row)
    session.commit()
    session.refresh(row)

    # Record the call. live=True when api_key was set; mock-mode regen is
    # a no-op return of the current data, no Claude charge.
    record_usage(
        session,
        user_id=user.user_id,
        org_id=user.org_id,
        extraction_id=row.id,
        action=f"regen_{payload.section}",
        model=model_used,
        live=usage is not None,
        usage=usage,
    )
    return extraction_to_record(row)


# ---------------- M14.8 — dossier section regen ----------------


@router.post("/{extraction_id}/dossier/regen", response_model=ExtractionRecord)
def regen_dossier_section(
    extraction_id: str,
    payload: DossierRegenRequest,
    session: SessionDep,
    user: UserDep,
    x_anthropic_key: str | None = Header(default=None, alias="X-Anthropic-Key"),
    x_storyforge_model: str | None = Header(default=None, alias="X-Storyforge-Model"),
) -> ExtractionRecord:
    """Re-run Claude against ONE section of a dossier and swap it in place.

    Cheaper than a full /rerun (one section's worth of tokens vs all 14+).
    Counts as one Claude call against the user's quota. Updates lens_payload
    in place and appends a revision entry tagged 'regen' so the edit log
    shows where AI-rewrites happened vs human edits (M14.7).
    """
    row = _owned_extraction(session, extraction_id, user)
    if row.lens != "dossier" or row.lens_payload is None:
        raise HTTPException(status_code=400, detail="extraction is not a dossier")

    from services.lenses.regen_section import REGEN_REGISTRY, regen_section
    if payload.section not in REGEN_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"unknown section '{payload.section}'; valid: {list(REGEN_REGISTRY.keys())}",
        )

    effective_key, stored_model = resolve_user_byok(session, user.user_id, x_anthropic_key)
    effective_model = x_storyforge_model or stored_model
    enforce_limits(session, user, raw_text=row.raw_text, model=effective_model)

    suffix = resolve_prompt_suffix(session, user.user_id, user.org_id)

    new_value, usage = regen_section(
        section_key=payload.section,
        filename=row.filename,
        raw_text=row.raw_text,
        current_dossier=row.lens_payload,
        api_key=effective_key,
        model=effective_model,
        prompt_suffix=suffix,
    )

    import copy
    payload_dict = copy.deepcopy(row.lens_payload)
    _, _, _, dump_path = REGEN_REGISTRY[payload.section]
    before = copy.deepcopy(payload_dict.get(dump_path))
    payload_dict[dump_path] = new_value

    revisions = list(row.dossier_revisions or [])
    revisions.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "user_id": user.user_id,
        "path": dump_path,
        "before": before,
        "after": new_value,
        "kind": "regen",
    })
    if len(revisions) > _REVISION_CAP:
        revisions = revisions[-_REVISION_CAP:]

    row.lens_payload = payload_dict
    row.dossier_revisions = revisions
    session.add(row)
    session.commit()
    session.refresh(row)

    record_usage(
        session,
        user_id=user.user_id,
        org_id=user.org_id,
        extraction_id=row.id,
        action=f"regen_dossier_{payload.section}",
        model=effective_model or row.model_used,
        live=usage is not None,
        usage=usage,
    )
    return extraction_to_record(row)


# ---------------- import (M2.4.5 migration) ----------------


@router.post("/import", response_model=ExtractionRecord, status_code=201)
def import_extraction(
    payload: ExtractionImport, session: SessionDep, user: UserDep
) -> ExtractionRecord:
    """Insert a record verbatim from a localStorage migration push.

    Idempotent on `id`: a second push of the same id returns the existing row,
    *but only if it belongs to the current user*. Cross-user id collisions
    return 409 — practically impossible (ids carry 6 random hex chars + ms
    timestamp) but worth being explicit about.
    """
    existing = session.get(Extraction, payload.id)
    if existing is not None:
        if not in_scope(existing, user):
            raise HTTPException(status_code=409, detail="Extraction id collision")
        return extraction_to_record(existing)

    row = persist_extraction(
        session,
        result=payload.payload,
        model_used="imported",
        user_id=user.user_id,
        org_id=user.org_id,
        extraction_id=payload.id,
        created_at=payload.saved_at or datetime.now(timezone.utc),
    )
    return extraction_to_record(row)


# ---------------- gap state ----------------


@router.get("/{extraction_id}/gaps", response_model=list[GapStateRead])
def list_gap_states(extraction_id: str, session: SessionDep, user: UserDep) -> list[GapStateRead]:
    _owned_extraction(session, extraction_id, user)  # 404 if foreign
    rows = session.exec(
        select(GapState).where(GapState.extraction_id == extraction_id)
    ).all()
    return [gap_state_to_read(r) for r in rows]


@router.patch("/{extraction_id}/gaps/{gap_idx}", response_model=GapStateRead)
def patch_gap_state(
    extraction_id: str,
    gap_idx: int,
    patch: GapStatePatch,
    session: SessionDep,
    user: UserDep,
) -> GapStateRead:
    extraction = _owned_extraction(session, extraction_id, user)
    if gap_idx < 0 or gap_idx >= len(extraction.gaps or []):
        raise HTTPException(status_code=400, detail="gap_idx out of range")

    row = session.get(GapState, (extraction_id, gap_idx))
    if row is None:
        row = GapState(extraction_id=extraction_id, gap_idx=gap_idx)

    if patch.resolved is not None:
        row.resolved = patch.resolved
    if patch.ignored is not None:
        row.ignored = patch.ignored
    if patch.asked_at is not None:
        row.asked_at = patch.asked_at
    row.updated_at = datetime.now(timezone.utc)

    session.add(row)
    session.commit()
    session.refresh(row)
    return gap_state_to_read(row)
