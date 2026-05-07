"""M14.8 — Section-level regenerate for the dossier lens.

The full dossier extraction is one heavy ~16k-token call. When a user
thinks just one section came back weak (a TLDR that's too vague, a 5-
Whys chain that bottoms out, action items that miss owners), they
shouldn't pay to re-run the whole thing. This module exposes a registry
of regeneratable sections and a single `regen_section` entry point that
re-runs Claude against just that section's slice of DocumentDossier.

Each section is a discrete Pydantic schema, so we use messages.parse()
with response_format=<that schema> — Claude returns only the new node,
and the route layer swaps it into lens_payload[section_key].

Regen registry is intentionally narrow (Brief / TLDR Ladder / 5W1H /
5 Whys / Assumptions / Inversion / Better Questions / Action Items /
Glossary). Mindmap / Domain / Systems / Timeline are skipped because
they're tightly entangled with each other — regenerating just the
mindmap usually leaves the domain map subtly inconsistent. For those,
push users to a full dossier rerun (already exists via /api/extract).
"""

from __future__ import annotations

import logging
from typing import Any

import anthropic
from pydantic import BaseModel

from extract import resolve_model
from services.cost import TokenUsage
from services.lenses.dossier import (
    DOSSIER_SYSTEM,
    ActionItem,
    Assumption,
    Brief,
    FailureMode,
    FiveW1H,
    GlossaryTerm,
    ProbingQuestion,
    TLDRLadder,
    WhyStep,
)

log = logging.getLogger(__name__)


class _ListWrapper(BaseModel):
    """Wrapper schema for list-typed sections — Anthropic's messages.parse()
    requires a top-level object schema, not a bare list."""
    pass


class FiveWhysWrapper(_ListWrapper):
    five_whys: list[WhyStep]


class AssumptionsWrapper(_ListWrapper):
    assumptions: list[Assumption]


class InversionWrapper(_ListWrapper):
    inversion: list[FailureMode]


class BetterQuestionsWrapper(_ListWrapper):
    better_questions: list[ProbingQuestion]


class ActionItemsWrapper(_ListWrapper):
    action_items: list[ActionItem]


class GlossaryWrapper(_ListWrapper):
    glossary: list[GlossaryTerm]


# section_key -> (display_name, schema, prompt_instruction, dump_path)
# `dump_path` is where the regenerated value lands in lens_payload. For
# direct sub-models (Brief, TLDR), this is the same as section_key. For
# wrapped lists, the wrapper has a single field of the same name so we
# unwrap on the way out.
REGEN_REGISTRY: dict[str, tuple[str, type[BaseModel], str, str]] = {
    "brief": (
        "Brief",
        Brief,
        "Regenerate ONLY the Brief — a 2-3 sentence summary of what the document is about, "
        "plus 3-7 short tags.",
        "brief",
    ),
    "tldr_ladder": (
        "TLDR Ladder",
        TLDRLadder,
        "Regenerate ONLY the TLDR Ladder — three takes on the document at increasing depth: "
        "one_line (≤25 words), one_paragraph (~80 words), one_page (~300 words).",
        "tldr_ladder",
    ),
    "five_w_one_h": (
        "5W1H",
        FiveW1H,
        "Regenerate ONLY the 5W1H breakdown — short, specific answers for who / what / when / where / why / how.",
        "five_w_one_h",
    ),
    "five_whys": (
        "5 Whys",
        FiveWhysWrapper,
        "Regenerate ONLY the 5 Whys chain — exactly 5 question→answer steps where each answer "
        "feeds the next question, ending at a root cause.",
        "five_whys",
    ),
    "assumptions": (
        "Assumptions Audit",
        AssumptionsWrapper,
        "Regenerate ONLY the Assumptions Audit — 3-7 hidden premises the document rests on, "
        "each with an explicit risk_level (low/medium/high) and a one-sentence risk_explanation.",
        "assumptions",
    ),
    "inversion": (
        "Inversion",
        InversionWrapper,
        "Regenerate ONLY the Inversion list — 3-7 ways this could fail catastrophically, "
        "each with an optional likelihood label.",
        "inversion",
    ),
    "better_questions": (
        "Better Questions",
        BetterQuestionsWrapper,
        "Regenerate ONLY the Better Questions — 5-10 smart questions the document doesn't answer, "
        "each with a why_it_matters note.",
        "better_questions",
    ),
    "action_items": (
        "Action Items",
        ActionItemsWrapper,
        "Regenerate ONLY the Action Items — 3-10 concrete next steps with owner / action / when. "
        "Owner should be a role or named team where possible (not generic 'team').",
        "action_items",
    ),
    "glossary": (
        "Glossary",
        GlossaryWrapper,
        "Regenerate ONLY the Glossary — 5-15 specialist terms used in the document, each decoded "
        "in plain language. Empty list if the document has no jargon.",
        "glossary",
    ),
}


def regeneratable_sections() -> list[str]:
    """List of section keys clients can pass to regen_section."""
    return list(REGEN_REGISTRY.keys())


def _build_user_msg(filename: str, raw_text: str, current_dossier: dict[str, Any], section_label: str, instruction: str) -> str:
    # Slim the dossier context to brief + tldr so we keep the prompt cheap;
    # Claude doesn't need the whole prior dossier to regen one section.
    context_bits = []
    if current_dossier.get("brief", {}).get("summary"):
        context_bits.append(f"Prior brief summary: {current_dossier['brief']['summary']}")
    tldr = current_dossier.get("tldr_ladder", {}) or {}
    if tldr.get("one_line"):
        context_bits.append(f"Prior TLDR (1 line): {tldr['one_line']}")
    context = "\n".join(context_bits)

    return (
        f"Source document: {filename}\n\n"
        f"---BEGIN SOURCE---\n{raw_text}\n---END SOURCE---\n\n"
        + (f"For continuity, here is part of the existing dossier:\n{context}\n\n" if context else "")
        + f"{instruction}\n\nProduce the new {section_label} now."
    )


def regen_section(
    *,
    section_key: str,
    filename: str,
    raw_text: str,
    current_dossier: dict[str, Any],
    api_key: str | None,
    model: str | None,
    prompt_suffix: str | None = None,
) -> tuple[Any, TokenUsage | None]:
    """Re-run Claude against ONE dossier section. Returns (new_value, usage).

    `new_value` is the JSON-ready replacement for lens_payload[section_key]
    (already unwrapped from the list-wrapper schemas where applicable).

    Mock mode (api_key None): returns the existing value unchanged so dev
    doesn't need a live key to exercise the UI flow.
    """
    if section_key not in REGEN_REGISTRY:
        raise ValueError(f"unknown section: {section_key}")
    label, schema, instruction, dump_path = REGEN_REGISTRY[section_key]

    if not api_key:
        # Echo back the existing slice so the call is observable in dev.
        return current_dossier.get(dump_path), None

    effective_model = resolve_model(model)
    client = anthropic.Anthropic(api_key=api_key)

    system_blocks = [{
        "type": "text",
        "text": DOSSIER_SYSTEM + (
            f"\n\nAdditional house-style instructions: {prompt_suffix}"
            if prompt_suffix else ""
        ),
        "cache_control": {"type": "ephemeral"},
    }]

    response = client.messages.parse(
        model=effective_model,
        max_tokens=4000,  # one section is a fraction of a full dossier
        system=system_blocks,
        messages=[{"role": "user", "content": _build_user_msg(
            filename, raw_text, current_dossier, label, instruction,
        )}],
        output_format=schema,
        thinking={"type": "adaptive"},
    )

    parsed = response.parsed_output
    # If the schema is a list-wrapper, unwrap to the bare list. Otherwise
    # serialize the whole sub-model. Either way, we end with JSON-ready data
    # suitable for lens_payload.
    parsed_dict = parsed.model_dump(mode="json")
    new_value = parsed_dict.get(dump_path, parsed_dict)

    usage = TokenUsage(
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        cache_creation_input_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
        cache_read_input_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
    )
    return new_value, usage
