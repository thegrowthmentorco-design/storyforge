"""Lens registry — maps lens name → extractor module.

Each lens is a self-contained module with a clear contract:
  - Defines its own Pydantic output schema
  - Defines its own prompt template
  - Exports an extractor function (signature varies by lens)

M14.18 — collapsed to a single lens (Document Explainer). Earlier
multi-lens experiment (stories / dossier / pipeline) was removed in
favor of a focused two-deliverable transformation. Pre-existing rows
with lens='stories' / 'dossier' / 'pipeline' remain in the DB but no
longer have a renderer; they're effectively orphaned until manually
re-extracted.
"""
from __future__ import annotations

from services.lenses import explainer

LENSES = {
    "explainer": explainer,
}

DEFAULT_LENS = "explainer"

VALID_LENSES = set(LENSES.keys())


def is_valid(lens: str | None) -> bool:
    return lens in VALID_LENSES


def normalize(lens: str | None) -> str:
    """Validate + default a lens name. Unknown values fall back to DEFAULT_LENS
    rather than 400ing — keeps the system robust to future-version-of-frontend
    sending an unknown lens (just degrades to dossier)."""
    if lens and lens in VALID_LENSES:
        return lens
    return DEFAULT_LENS
