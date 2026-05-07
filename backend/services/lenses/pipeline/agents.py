"""M14.17 — Agent runner functions for the document understanding pipeline.

One function per agent. Each takes the inputs the spec calls for and
returns its typed Pydantic output. All use Anthropic's messages.parse()
with the agent's response schema enforced.

Mock mode (api_key None): each runner returns a sensible empty/default
output so the orchestrator runs end-to-end in dev without a key.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import anthropic

from services.cost import TokenUsage
from services.lenses.pipeline.prompts import (
    ACTION_EXTRACTOR_PROMPT,
    ARGUMENT_MAPPER_PROMPT,
    CRITIC_PROMPT,
    DEPTH_CAP_RULE,
    EXTRACTOR_PROMPT,
    GLOSSARY_BUILDER_PROMPT,
    NUMERICAL_ANALYZER_PROMPT,
    OBLIGATION_MAPPER_PROMPT,
    RISK_ANALYZER_PROMPT,
    ROUTER_PROMPT,
    SYNTHESIZER_PROMPT,
    TIMELINE_BUILDER_PROMPT,
)
from services.lenses.pipeline.schemas import (
    ActionExtractorOutput,
    ArgumentMapperOutput,
    CriticOutput,
    ExtractorOutput,
    GlossaryBuilderOutput,
    NumericalAnalyzerOutput,
    ObligationMapperOutput,
    RiskAnalyzerOutput,
    RouterOutput,
    StructureSignals,
    SynthesizerOutput,
    TimelineBuilderOutput,
)

log = logging.getLogger(__name__)


# ============================================================================
# Helper — single Claude call with response_format
# ============================================================================

def _call(
    *,
    client,
    model: str,
    system: str,
    user: str,
    response_format,
    max_tokens: int = 4000,
) -> tuple[Any, TokenUsage]:
    """Run one agent call. Returns (parsed_output, usage)."""
    # Anthropic SDK 0.96+ renamed `response_format` → `output_format` on
    # messages.parse(). Keeping the kwarg name in this function's signature
    # (response_format) since callers throughout the codebase use that
    # vocabulary; only the SDK call uses output_format.
    response = client.messages.parse(
        model=model,
        max_tokens=max_tokens,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
        output_format=response_format,
        thinking={"type": "adaptive"},
    )
    usage = TokenUsage(
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        cache_creation_input_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
        cache_read_input_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
    )
    return response.parsed_output, usage


def _doc_user_msg(filename: str, raw_text: str, extra: str = "") -> str:
    suffix = f"\n\n{extra}" if extra else ""
    return (
        f"Source document: {filename}\n\n"
        f"---BEGIN SOURCE---\n{raw_text}\n---END SOURCE---{suffix}"
    )


# ============================================================================
# 1. Router
# ============================================================================

def run_router(
    *, filename: str, raw_text: str, user_query: str | None,
    client, model: str,
) -> tuple[RouterOutput, TokenUsage]:
    user_msg = _doc_user_msg(
        filename, _truncate_for_router(raw_text),
        extra=f"User query (may be empty): {user_query or ''}",
    )
    return _call(
        client=client, model=model,
        system=ROUTER_PROMPT, user=user_msg,
        response_format=RouterOutput, max_tokens=1500,
    )


def _truncate_for_router(text: str, head: int = 4000, tail: int = 1500) -> str:
    """Routers don't need the whole doc — just enough to classify shape +
    intent. For long docs, send the head + tail; for short docs, send all."""
    if len(text) <= head + tail + 200:
        return text
    return text[:head] + "\n\n[...truncated for router...]\n\n" + text[-tail:]


# ============================================================================
# 2. Extractor (always runs)
# ============================================================================

def run_extractor(
    *, filename: str, raw_text: str, client, model: str,
) -> tuple[ExtractorOutput, TokenUsage]:
    return _call(
        client=client, model=model,
        system=EXTRACTOR_PROMPT,
        user=_doc_user_msg(filename, raw_text),
        response_format=ExtractorOutput, max_tokens=6000,
    )


# ============================================================================
# 3-9. Specialists
# ============================================================================

# Each specialist takes the document + extractor output as user message.
# Pattern is identical; we DRY it via a small helper.

# M14.17.fix — uniform 16k max_tokens across specialists. Adaptive
# thinking shares the same budget as the structured output, and
# verbatim source_span / evidence fields balloon output unpredictably
# (saw truncation mid-string on multiple specialists at 4-8k caps).
# 16k is the highest we use anywhere; max_tokens is a ceiling so cost
# only grows when Claude actually emits that many tokens.
# Each specialist prompt gets DEPTH_CAP_RULE appended so the runtime
# `Depth: thin/moderate/deep` value supplied in the user message
# constrains output size (Router v2 — depth no longer affects which
# specialists run).
_SPECIALIST_REGISTRY = {
    "action_extractor": (ACTION_EXTRACTOR_PROMPT + DEPTH_CAP_RULE, ActionExtractorOutput, 16000),
    "risk_analyzer": (RISK_ANALYZER_PROMPT + DEPTH_CAP_RULE, RiskAnalyzerOutput, 16000),
    "argument_mapper": (ARGUMENT_MAPPER_PROMPT + DEPTH_CAP_RULE, ArgumentMapperOutput, 16000),
    "obligation_mapper": (OBLIGATION_MAPPER_PROMPT + DEPTH_CAP_RULE, ObligationMapperOutput, 16000),
    "glossary_builder": (GLOSSARY_BUILDER_PROMPT + DEPTH_CAP_RULE, GlossaryBuilderOutput, 16000),
    "numerical_analyzer": (NUMERICAL_ANALYZER_PROMPT + DEPTH_CAP_RULE, NumericalAnalyzerOutput, 16000),
    "timeline_builder": (TIMELINE_BUILDER_PROMPT + DEPTH_CAP_RULE, TimelineBuilderOutput, 16000),
}


def run_specialist(
    *, key: str, filename: str, raw_text: str, extractor_output: ExtractorOutput,
    client, model: str, depth: str = "moderate",
) -> tuple[Any, TokenUsage]:
    """Run one specialist. `depth` (thin/moderate/deep) is supplied to
    the prompt so DEPTH_CAP_RULE applies — controls output verbosity
    without changing which specialists run (Router v2)."""
    if key not in _SPECIALIST_REGISTRY:
        raise ValueError(f"unknown specialist: {key}")
    system, schema, max_tokens = _SPECIALIST_REGISTRY[key]
    user_msg = _doc_user_msg(
        filename, raw_text,
        extra=(
            f"Depth: {depth}\n\n"
            "Grounded facts (extractor_output):\n"
            + json.dumps(extractor_output.model_dump(mode="json"), indent=2)
        ),
    )
    return _call(
        client=client, model=model,
        system=system, user=user_msg,
        response_format=schema, max_tokens=max_tokens,
    )


# ============================================================================
# 10. Synthesizer
# ============================================================================

def run_synthesizer(
    *,
    doc_type: str,
    user_intent: str,
    extractor_output: ExtractorOutput,
    specialist_outputs: dict[str, Any],
    critic_issues: list | None = None,
    client, model: str,
) -> tuple[SynthesizerOutput, TokenUsage]:
    payload = {
        "doc_type": doc_type,
        "user_intent": user_intent,
        "extractor_output": extractor_output.model_dump(mode="json"),
        "specialist_outputs": specialist_outputs,
    }
    if critic_issues:
        payload["critic_issues"] = critic_issues
    user_msg = (
        "Inputs:\n" + json.dumps(payload, indent=2, default=str)
        + "\n\nReturn the synthesizer JSON now."
    )
    return _call(
        client=client, model=model,
        system=SYNTHESIZER_PROMPT, user=user_msg,
        response_format=SynthesizerOutput, max_tokens=8000,
    )


# ============================================================================
# 11. Critic
# ============================================================================

def run_critic(
    *,
    doc_type: str,
    user_intent: str,
    depth: str,
    synthesizer_output: SynthesizerOutput,
    source_word_count: int,
    client, model: str,
) -> tuple[CriticOutput, TokenUsage]:
    payload = {
        "doc_type": doc_type,
        "user_intent": user_intent,
        "depth": depth,
        "source_word_count": source_word_count,
        "synthesizer_output": synthesizer_output.model_dump(mode="json"),
    }
    user_msg = (
        "Inputs:\n" + json.dumps(payload, indent=2, default=str)
        + "\n\nReturn the critic JSON now."
    )
    return _call(
        client=client, model=model,
        system=CRITIC_PROMPT, user=user_msg,
        response_format=CriticOutput, max_tokens=2000,
    )


# ============================================================================
# Mock outputs — used when api_key is None so the orchestrator runs in dev.
# ============================================================================

def mock_router() -> RouterOutput:
    return RouterOutput(
        doc_type="other", doc_type_confidence=0.5,
        user_intent="understand", user_intent_confidence=0.5,
        depth="moderate",
        selected_specialists=["action_extractor"],
        rationale="Mock router — set ANTHROPIC_API_KEY for real classification.",
    )


def mock_extractor(filename: str, raw_text: str) -> ExtractorOutput:
    return ExtractorOutput(
        title=filename or "Mock document",
        sections=[],
        people=[], organizations=[], places=[], dates=[], numbers=[],
        key_terms=[],
        structure_signals=StructureSignals(
            has_table_of_contents=False, has_numbered_sections=False,
            has_tables=False, approximate_word_count=len(raw_text.split()),
        ),
    )


def mock_synthesizer() -> SynthesizerOutput:
    return SynthesizerOutput(
        template="default",
        sections={
            "summary": "Mock pipeline output. Configure your Anthropic API key in Settings to run the real pipeline.",
            "key_points": [],
            "things_to_do_or_decide": [],
            "open_questions": [],
        },
    )
