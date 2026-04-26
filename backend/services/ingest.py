"""One-file ingestion (M7.5).

Walks a single UploadFile through the same path the M7.3/M7.4 extract
routes do — validation, parse, vision/OCR pre-pass — and returns a
plain `(raw_text, source_name, modality)` tuple ready for the extraction
pipeline. Lets both extract routes loop over N files for multi-doc
support without duplicating the per-file logic.

`modality` reports which path was taken so the route layer can decide
whether to persist the source file (R2/disk) or skip it (image / OCR
fall back to descriptions of bytes that are heavier to round-trip than
the description itself).

Public surface:
  - ingest_file(file, *, session, user, effective_key, effective_model,
                max_bytes, supported_ext, parse_text)
        → (raw_text, source_name, modality)
        modality ∈ {"text", "image", "ocr"}

The ingestor records its own `usage_log` rows for vision + OCR pre-passes
so the cost shows up alongside `extract` in /api/me/usage (same as the
single-file path before the M7.5 refactor).
"""

from __future__ import annotations

import logging
from typing import Callable

from fastapi import HTTPException, UploadFile
from sqlmodel import Session

from auth.deps import CurrentUser
from extract import resolve_model
from services.extractions import record_usage
from services.ocr import looks_like_empty, ocr_pdf_via_claude
from services.vision import describe_image_via_claude, mime_for_ext

log = logging.getLogger("storyforge.ingest")


async def ingest_file(
    file: UploadFile,
    *,
    session: Session,
    user: CurrentUser,
    effective_key: str | None,
    effective_model: str | None,
    max_bytes: int,
    supported_ext: set[str],
    parse_text: Callable[[str, bytes], str],
) -> tuple[str, str, bytes, str]:
    """Read + validate + parse + (vision|OCR) one file. Returns
    `(raw_text, source_name, raw_bytes, modality)`. Raises HTTPException
    with the appropriate status on validation failures (415, 413, 422,
    400 image-no-key)."""
    data = await file.read()
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File '{file.filename}' over {max_bytes // (1024 * 1024)} MB limit.",
        )

    file_ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if file_ext and file_ext not in supported_ext:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type {file_ext} ('{file.filename}'). Supported: {', '.join(sorted(supported_ext))}",
        )

    source_name = file.filename or "uploaded"
    image_mime = mime_for_ext(file_ext)

    # ----- Image input (M7.4) ----------------------------------------------
    if image_mime is not None:
        if not effective_key:
            raise HTTPException(
                status_code=400,
                detail=f"Image '{source_name}' requires a Claude API key — add one in Settings.",
            )
        log.info("vision pre-pass: %s (%s)", source_name, image_mime)
        raw_text, vision_usage = describe_image_via_claude(
            data, image_mime, api_key=effective_key, model=resolve_model(effective_model),
        )
        record_usage(
            session, user_id=user.user_id, org_id=user.org_id, extraction_id=None,
            action="vision", model=resolve_model(effective_model),
            live=True, usage=vision_usage,
        )
        return raw_text, source_name, data, "image"

    # ----- Text-extractable file (pdf / docx / txt / md / rst) -------------
    try:
        raw_text = parse_text(file.filename or "uploaded", data)
    except Exception as e:
        log.exception("file parse failed for %s", source_name)
        raise HTTPException(status_code=422, detail=f"Could not parse file '{source_name}': {e}")

    # ----- OCR fallback for scanned PDFs (M7.3) ----------------------------
    if file_ext == ".pdf" and looks_like_empty(raw_text) and effective_key:
        log.info("OCR fallback: %s", source_name)
        raw_text, ocr_usage = ocr_pdf_via_claude(
            data, api_key=effective_key, model=resolve_model(effective_model),
        )
        record_usage(
            session, user_id=user.user_id, org_id=user.org_id, extraction_id=None,
            action="ocr", model=resolve_model(effective_model),
            live=True, usage=ocr_usage,
        )
        return raw_text, source_name, data, "ocr"

    return raw_text, source_name, data, "text"


def combine_raw_texts(items: list[tuple[str, str]]) -> tuple[str, str]:
    """Join multiple `(source_name, raw_text)` tuples into one combined
    `raw_text` block + a synthesized header source_name.

    Output format:
        ===== DOC 1: spec.pdf =====
        <text 1>

        ===== DOC 2: notes.docx =====
        <text 2>

    Single-doc inputs collapse to bare raw_text (no markers). Source name
    for >1 doc is "first.pdf + N more" — UI can let the user override via
    the existing `filename` form field if they want.
    """
    if len(items) == 1:
        name, text = items[0]
        return text, name
    parts: list[str] = []
    for i, (name, text) in enumerate(items, 1):
        parts.append(f"===== DOC {i}: {name} =====")
        parts.append(text)
        parts.append("")  # blank line between docs
    combined = "\n".join(parts).rstrip()
    summary_name = f"{items[0][0]} + {len(items) - 1} more"
    return combined, summary_name
