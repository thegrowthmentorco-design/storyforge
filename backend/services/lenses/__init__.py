"""Lens registry — maps lens name → extractor module.

Each lens is a self-contained module with a clear contract:
  - Defines its own Pydantic output schema
  - Defines its own prompt template
  - Exports an extractor function (signature varies by lens)

The dispatcher in `services/extractions.call_claude` branches on the
`lens` parameter and routes to the right module. Adding a new lens =
add a module here + register it below + add a frontend renderer.

Available lenses:
  - 'stories' : the original BRD → user-stories extraction (default for
                back-compat with pre-M14.1 rows)
  - 'dossier' : M14.1 — 4-act narrated document understanding
"""
from __future__ import annotations

from services.lenses import dossier, pipeline, stories

LENSES = {
    "stories": stories,
    "dossier": dossier,
    "pipeline": pipeline,  # M14.17 — multi-agent router/extractor/specialists/synthesizer/critic
}

DEFAULT_LENS = "dossier"  # New uploads default to the dossier lens.

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
