"""Persona-toggle re-explanation.

Given an existing extraction's plain-English sections, re-render them
in a different voice (ELI5, CFO, new joiner, etc.) without re-doing
the document analysis. The persona call is cheaper than a full
extraction because it operates on the already-condensed sections,
not the raw document text.
"""
from __future__ import annotations

import logging
from typing import Iterator, Literal

import anthropic
from pydantic import BaseModel, ConfigDict, Field

from services.cost import TokenUsage


log = logging.getLogger("storyforge.persona")


PersonaName = Literal["eli5", "cfo", "new_joiner", "lawyer", "engineer"]


PERSONA_BRIEFS: dict[str, dict[str, str]] = {
    "eli5": {
        "label": "Explain like I'm 5",
        "instruction": (
            "Rewrite for someone with NO prior context — simple words, short "
            "sentences, no jargon. Use everyday analogies. Concrete numbers "
            "stay; vocabulary changes. Aim for a 12-year-old reading level."
        ),
    },
    "cfo": {
        "label": "For the CFO",
        "instruction": (
            "Rewrite for a CFO. Lead with financial impact, risk, and "
            "decisions to be made. Numbers and ratios up front. Skip "
            "operational details unless they affect cost or risk. Crisp, "
            "executive tone."
        ),
    },
    "new_joiner": {
        "label": "For a new joiner",
        "instruction": (
            "Rewrite for someone new to the company who has no context on "
            "internal terminology or roles. Define acronyms and roles on "
            "first use. Friendly, welcoming tone. Add 'why this matters "
            "for you' framing where natural."
        ),
    },
    "lawyer": {
        "label": "For a lawyer",
        "instruction": (
            "Rewrite for a legal reviewer. Surface obligations, "
            "liabilities, deadlines, indemnities, and termination "
            "conditions. Use precise terminology. Flag ambiguities and "
            "anywhere the language could be tightened."
        ),
    },
    "engineer": {
        "label": "For an engineer",
        "instruction": (
            "Rewrite for a software/systems engineer. Focus on data "
            "flows, integrations, edge cases, error states, and SLAs. "
            "Use technical terminology where appropriate. Skip "
            "policy/procedural framing."
        ),
    },
}


class PersonaSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    heading: str = Field(description="The section heading; can be lightly rephrased to match the persona but must cover the same topic as the original.")
    body: str = Field(description="Markdown body re-rendered for the persona. Same facts, different voice.")


class PersonaSections(BaseModel):
    """Persona-rewritten sections. Schema mirrors the explainer's
    plain_english.sections but with `extra='forbid'` so Claude doesn't
    invent extra keys."""
    model_config = ConfigDict(extra="forbid")
    sections: list[PersonaSection]


def _system_prompt(persona: str) -> str:
    brief = PERSONA_BRIEFS.get(persona)
    if not brief:
        raise ValueError(f"Unknown persona: {persona}")
    return f"""You are rewriting an existing document explanation for a specific audience.

PERSONA: {brief['label']}

{brief['instruction']}

RULES:
- Preserve every concrete fact, number, name, and date EXACTLY as in the original.
- Same number of sections, same topics, same order. Only the voice changes.
- Do not invent details. If the original is silent on something, your rewrite is silent on it too.
- Markdown is supported in the body (lists, tables, bold).
- No preamble, no "here is the rewrite" — go straight into the section content.

Return a `sections` array matching the input section count.
"""


def regenerate_persona(
    *,
    sections: list[dict],
    persona: str,
    api_key: str | None,
    model: str | None,
) -> tuple[list[dict], TokenUsage | None]:
    """Re-render sections in the given persona's voice. Returns
    (new_sections, usage). Mock when no api_key."""
    if persona not in PERSONA_BRIEFS:
        raise ValueError(f"Unknown persona: {persona}")

    if not api_key:
        # Mock — flag each section so it's obvious this isn't real output.
        mocked = [
            {"heading": s.get("heading") or "", "body": f"[mock {persona}] {s.get('body') or ''}"}
            for s in sections
        ]
        return mocked, None

    from extract import resolve_model
    eff_model = resolve_model(model)

    user_msg = "Original sections (JSON):\n" + _serialize_sections(sections) + "\n\nReturn the persona-tuned sections now."

    client = anthropic.Anthropic(api_key=api_key, timeout=180.0)
    response = client.messages.parse(
        model=eff_model,
        max_tokens=8000,
        system=_system_prompt(persona),
        messages=[{"role": "user", "content": user_msg}],
        output_format=PersonaSections,
        output_config={"effort": "low"},
        thinking={"type": "disabled"},
    )

    parsed = response.parsed_output
    out = [{"heading": s.heading, "body": s.body} for s in parsed.sections]
    usage = TokenUsage(
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
    return out, usage


def _serialize_sections(sections: list[dict]) -> str:
    import json
    trimmed = [
        {"heading": s.get("heading") or "", "body": s.get("body") or ""}
        for s in sections
    ]
    return json.dumps(trimmed, indent=2)


def stream_persona(
    *,
    sections: list[dict],
    persona: str,
    api_key: str | None,
    model: str | None,
) -> Iterator[dict]:
    """SSE-friendly wrapper. Yields:
      {type: 'stage', name: 'rewriting'}
      {type: 'complete', sections: [...], usage: TokenUsage|None}
      {type: 'error', status, detail}
    """
    yield {"type": "stage", "name": "rewriting"}
    try:
        out, usage = regenerate_persona(
            sections=sections, persona=persona, api_key=api_key, model=model,
        )
        yield {"type": "complete", "sections": out, "usage": usage}
    except anthropic.AuthenticationError:
        yield {"type": "error", "status": 401, "detail": "Invalid Anthropic API key."}
    except anthropic.RateLimitError as e:
        retry_after = e.response.headers.get("retry-after", "60") if e.response else "60"
        yield {"type": "error", "status": 429, "detail": f"Rate limit. Retry after ~{retry_after}s."}
    except anthropic.BadRequestError as e:
        yield {"type": "error", "status": 400, "detail": f"Claude rejected the request: {e.message}"}
    except anthropic.APIConnectionError:
        log.exception("anthropic connection error during persona rewrite")
        yield {"type": "error", "status": 503, "detail": "Could not reach Anthropic API."}
    except Exception as e:  # noqa: BLE001
        log.exception("persona rewrite failed")
        yield {"type": "error", "status": 500, "detail": f"Persona rewrite failed: {e}"}
