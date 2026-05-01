"""Stories lens — wrapper around the existing extract.py extraction.

This is the legacy / default lens — a thin pass-through that lets the
new lens dispatcher (services/lenses/__init__.LENSES) treat the
existing user-stories extraction the same way as any new lens. No
behavior change vs pre-M14.1.
"""
from __future__ import annotations

from extract import extract_requirements
from models import ExtractionResult
from services.cost import TokenUsage


def extract(
    filename: str,
    raw_text: str,
    *,
    api_key: str | None,
    model: str | None,
    prompt_suffix: str | None = None,
    few_shot_examples: list | None = None,
) -> tuple[ExtractionResult, TokenUsage | None]:
    """Run the existing user-stories extraction. Pure pass-through to
    `extract_requirements` so back-compat is total."""
    return extract_requirements(
        filename, raw_text,
        api_key=api_key, model=model,
        prompt_suffix=prompt_suffix,
        few_shot_examples=few_shot_examples,
    )
