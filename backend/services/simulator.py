"""What-if simulator evaluator.

The extractor produces a `simulator_schema` (form definition) at
extraction time. When the user submits values, this service asks
Claude to evaluate the rules in the original document against the
inputs and return a structured result with a top-line answer, a
step-by-step breakdown, and any caveats.

Single Claude call per submit. The document text is part of the
input — we re-send it on each evaluation rather than caching server-
side, since users may change document versions and the document is
typically <30k tokens.
"""
from __future__ import annotations

import logging
from typing import Iterator, Literal

import anthropic
from pydantic import BaseModel, ConfigDict, Field

from services.cost import TokenUsage


log = logging.getLogger("storyforge.simulator")


class BreakdownLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(description="What this line shows, e.g. 'Daily hotel limit (Grade 3, Mumbai)'.")
    value: str = Field(description="The value/contribution, e.g. '₹3,000 × 4 days = ₹12,000'.")
    source_quote: str = Field(default="", description="Optional verbatim snippet from the document that grounds this line. ≤200 chars. Empty when not applicable.")


class SimulationResult(BaseModel):
    """Structured simulator answer. The frontend renders the top-line
    answer prominently, the breakdown as a stepped list, and caveats
    as a footnote."""
    model_config = ConfigDict(extra="forbid")
    headline: str = Field(description="The top-line answer in one sentence with concrete numbers, e.g. '₹15,400 total claim allowable'.")
    summary: str = Field(description="2-3 sentences explaining the result in plain language.")
    breakdown: list[BreakdownLine] = Field(default_factory=list, description="Step-by-step calculation or rule application. 0-8 lines.")
    caveats: list[str] = Field(default_factory=list, description="Conditions, edge cases, or things the user should verify. Empty when none.")
    not_applicable: bool = Field(default=False, description="True only when the inputs fall completely outside the document's rules; in that case headline explains why and breakdown is empty.")


SYSTEM_PROMPT = """You are evaluating a what-if simulator against a rules/policy document.

The user has filled in form values. Apply the document's rules to those values and return a structured result.

RULES:
- Ground every line of the breakdown in the document. Quote the relevant clause in `source_quote` when possible (verbatim, ≤200 chars).
- Use REAL numbers from the document, not made-up ones. If the document doesn't specify the rate for a given combination, say so in `caveats` rather than inventing one.
- The headline should be the single most useful answer in one sentence with the concrete number(s).
- If the inputs fall outside the document's scope (e.g. user picked a value the rules don't cover), set `not_applicable=true` and explain in headline.
- Do not hedge unnecessarily. The user asked a specific question; answer it specifically.

Return a SimulationResult.
"""


def _build_user_message(*, doc_text: str, schema: dict, values: dict[str, str]) -> str:
    import json
    return (
        "RULES DOCUMENT:\n"
        f"---BEGIN SOURCE---\n{doc_text}\n---END SOURCE---\n\n"
        "FORM SCHEMA:\n"
        f"{json.dumps(schema, indent=2)}\n\n"
        "USER INPUTS (form values):\n"
        f"{json.dumps(values, indent=2)}\n\n"
        "Evaluate the rules document against the user's inputs and return a SimulationResult."
    )


def simulate(
    *,
    raw_text: str,
    schema: dict,
    values: dict[str, str],
    api_key: str | None,
    model: str | None,
) -> tuple[SimulationResult, TokenUsage | None]:
    """Run one evaluation. Returns (result, usage)."""
    if not api_key:
        return (
            SimulationResult(
                headline="Mock mode — no API key configured.",
                summary="Set up an Anthropic API key in Settings to evaluate the simulator against the document.",
                breakdown=[],
                caveats=["This is a placeholder response."],
                not_applicable=False,
            ),
            None,
        )

    from extract import resolve_model
    eff_model = resolve_model(model)

    client = anthropic.Anthropic(api_key=api_key, timeout=180.0)
    response = client.messages.parse(
        model=eff_model,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_message(
            doc_text=raw_text, schema=schema, values=values,
        )}],
        output_format=SimulationResult,
        output_config={"effort": "low"},
        thinking={"type": "disabled"},
    )

    parsed = response.parsed_output
    usage = TokenUsage(
        input_tokens=getattr(response.usage, "input_tokens", 0) or 0,
        output_tokens=getattr(response.usage, "output_tokens", 0) or 0,
    )
    return parsed, usage
