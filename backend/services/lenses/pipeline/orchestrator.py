"""M14.17 — Pipeline orchestrator.

Composes the full multi-agent pipeline:

  Router (classifies + picks specialists)
    → Extractor (always)
    → selected specialists (parallel)
    → Synthesizer (combines)
    → Critic (reviews; up to 2 revisions)

Returns one PipelineResult that gets persisted to lens_payload.

Concurrency: specialist calls run in parallel via concurrent.futures.
The orchestrator does NOT stream events — Pipeline lens uses the
non-streaming /api/extract path (ExtractionPipeline calls take longer
than a single-call dossier; streaming partial results across multiple
agents is M14.17.future-work).
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import anthropic

from services.cost import TokenUsage
from services.lenses.pipeline import agents
from services.lenses.pipeline.schemas import (
    CriticOutput,
    ExtractorOutput,
    PipelineResult,
    RouterOutput,
    SynthesizerOutput,
)

log = logging.getLogger(__name__)

MAX_REVISIONS = 2  # critic-driven synthesizer reruns


def run_pipeline(
    *,
    filename: str,
    raw_text: str,
    user_query: str | None = None,
    api_key: str | None,
    model: str | None,
) -> tuple[PipelineResult, TokenUsage]:
    """Run the full pipeline. Returns (result, aggregated_usage).

    `model` is the single model used for every agent. The spec recommends
    haiku for router/critic and opus for specialists/synthesizer; for v1
    we keep it simple and use one model. Per-agent model selection is
    M14.17.future-work.

    Mock mode (api_key None): every agent returns its mock; result is
    persisted so the user can see the UI flow without burning tokens.
    """
    # Mock-mode short-circuit so the orchestrator works end-to-end without
    # a key (matches the dossier/stories lens behavior).
    if not api_key:
        log.info("pipeline: mock mode (no api_key)")
        return PipelineResult(
            router=agents.mock_router(),
            extractor=agents.mock_extractor(filename, raw_text),
            specialists={},
            synthesizer=agents.mock_synthesizer(),
            critic=None,
            revision_count=0,
        ), TokenUsage(input_tokens=0, output_tokens=0)

    from extract import resolve_model
    eff_model = resolve_model(model)
    client = anthropic.Anthropic(api_key=api_key)

    # TokenUsage is a frozen dataclass — accumulate by replacing the
    # reference rather than mutating fields.
    total_usage = TokenUsage(input_tokens=0, output_tokens=0)

    def _accumulate(u: TokenUsage):
        nonlocal total_usage
        total_usage = TokenUsage(
            input_tokens=total_usage.input_tokens + u.input_tokens,
            output_tokens=total_usage.output_tokens + u.output_tokens,
            cache_creation_input_tokens=total_usage.cache_creation_input_tokens + u.cache_creation_input_tokens,
            cache_read_input_tokens=total_usage.cache_read_input_tokens + u.cache_read_input_tokens,
        )

    # ---- 1. Router ------------------------------------------------------
    log.info("pipeline: routing...")
    router_out, u = agents.run_router(
        filename=filename, raw_text=raw_text, user_query=user_query,
        client=client, model=eff_model,
    )
    _accumulate(u)
    log.info(
        "pipeline: routed doc_type=%s intent=%s depth=%s specialists=%s",
        router_out.doc_type, router_out.user_intent, router_out.depth,
        router_out.selected_specialists,
    )

    # ---- 2. Extractor (always) -----------------------------------------
    log.info("pipeline: extracting facts...")
    extractor_out, u = agents.run_extractor(
        filename=filename, raw_text=raw_text,
        client=client, model=eff_model,
    )
    _accumulate(u)
    log.info(
        "pipeline: extracted %d people, %d orgs, %d dates, %d numbers",
        len(extractor_out.people), len(extractor_out.organizations),
        len(extractor_out.dates), len(extractor_out.numbers),
    )

    # ---- 3. Specialists (parallel) -------------------------------------
    specialist_outputs: dict[str, dict] = {}
    if router_out.selected_specialists:
        log.info("pipeline: running %d specialists in parallel", len(router_out.selected_specialists))
        with ThreadPoolExecutor(max_workers=4) as pool:
            future_to_key = {
                pool.submit(
                    agents.run_specialist,
                    key=key, filename=filename, raw_text=raw_text,
                    extractor_output=extractor_out,
                    client=client, model=eff_model,
                    depth=router_out.depth,
                ): key
                for key in router_out.selected_specialists
            }
            for future in as_completed(future_to_key):
                key = future_to_key[future]
                try:
                    output, u = future.result()
                    specialist_outputs[key] = output.model_dump(mode="json")
                    _accumulate(u)
                    log.info("pipeline: specialist %s done", key)
                except Exception as e:  # noqa: BLE001
                    log.warning("pipeline: specialist %s failed: %s", key, e)
                    # Non-fatal — synthesizer just won't see this one.

    # ---- 4. Synthesizer (with optional critic revision loop) -----------
    log.info("pipeline: synthesizing...")
    synth_out, u = agents.run_synthesizer(
        doc_type=router_out.doc_type, user_intent=router_out.user_intent,
        extractor_output=extractor_out, specialist_outputs=specialist_outputs,
        critic_issues=None, client=client, model=eff_model,
    )
    _accumulate(u)

    # ---- 5. Critic (up to MAX_REVISIONS reruns) ------------------------
    critic_out: CriticOutput | None = None
    revision_count = 0
    source_word_count = len(raw_text.split())
    while revision_count <= MAX_REVISIONS:
        log.info("pipeline: critic pass %d", revision_count)
        critic_out, u = agents.run_critic(
            doc_type=router_out.doc_type, user_intent=router_out.user_intent,
            depth=router_out.depth,
            synthesizer_output=synth_out,
            source_word_count=source_word_count,
            client=client, model=eff_model,
        )
        _accumulate(u)
        if critic_out.verdict == "pass" or revision_count >= MAX_REVISIONS:
            break
        # Re-run synthesizer with critic feedback.
        revision_count += 1
        log.info(
            "pipeline: critic flagged %d issues; revising (pass %d)",
            len(critic_out.issues), revision_count,
        )
        synth_out, u = agents.run_synthesizer(
            doc_type=router_out.doc_type, user_intent=router_out.user_intent,
            extractor_output=extractor_out, specialist_outputs=specialist_outputs,
            critic_issues=[i.model_dump(mode="json") for i in critic_out.issues],
            client=client, model=eff_model,
        )
        _accumulate(u)

    log.info(
        "pipeline: done. Total tokens in=%d out=%d, revisions=%d, critic=%s",
        total_usage.input_tokens, total_usage.output_tokens,
        revision_count, critic_out.verdict if critic_out else "n/a",
    )

    return PipelineResult(
        router=router_out,
        extractor=extractor_out,
        specialists=specialist_outputs,
        synthesizer=synth_out,
        critic=critic_out,
        revision_count=revision_count,
    ), total_usage
