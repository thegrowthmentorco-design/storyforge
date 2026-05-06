"""M14.17 — Streaming wrapper for the multi-agent pipeline.

The pipeline is multi-stage but each agent call is itself blocking. We
emit `stage` events as each stage completes so the frontend shows live
progress, plus the standard usage/complete/error events. Architecture:

  - Run the orchestrator in a background thread.
  - Orchestrator pushes stage events to a thread-safe queue.
  - This generator yields from the queue as events arrive.
  - Final `complete` event carries the full PipelineResult.

This avoids refactoring the orchestrator into a generator while still
giving the frontend real progress signals.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from collections.abc import Iterator
from typing import Any

import anthropic

from services.cost import TokenUsage
from services.lenses.pipeline import agents
from services.lenses.pipeline.schemas import PipelineResult

log = logging.getLogger("storyforge.stream.pipeline")


def stream_pipeline_extraction(
    *,
    filename: str,
    raw_text: str,
    user_query: str | None = None,
    api_key: str | None,
    model: str | None,
    **_ignored_kwargs,  # accept prompt_suffix etc. for sig compat with other lens streamers
) -> Iterator[dict]:
    """Yield streaming events for a pipeline extraction.

    Event shape mirrors stream_dossier_extraction:
      {type: 'stage', name: str, detail: dict}  — pipeline-specific
      {type: 'usage', input, output, max}       — token heartbeat
      {type: 'complete', result, usage, model_used, lens}
      {type: 'error', status, detail}
    """
    # ----- mock mode --------------------------------------------------------
    if not api_key:
        result = PipelineResult(
            router=agents.mock_router(),
            extractor=agents.mock_extractor(filename, raw_text),
            specialists={},
            synthesizer=agents.mock_synthesizer(),
            critic=None,
            revision_count=0,
        )
        # Fake stage ticks so the loading card animates in dev.
        for stage in ("router", "extractor", "specialists", "synthesizer", "critic"):
            time.sleep(0.15)
            yield {"type": "stage", "name": stage, "detail": {"mock": True}}
            yield {"type": "usage", "input": 0, "output": 100, "max": 16000}
        yield {
            "type": "complete",
            "result": result,
            "usage": None,
            "model_used": "mock",
            "lens": "pipeline",
        }
        return

    # ----- live --------------------------------------------------------------
    # Run the pipeline in a background thread; communicate via queue.
    from extract import resolve_model
    eff_model = resolve_model(model)

    events: queue.Queue = queue.Queue()
    SENTINEL = object()
    container: dict[str, Any] = {"result": None, "usage": None, "error": None}

    def worker():
        try:
            result, usage = _run_pipeline_with_progress(
                filename=filename, raw_text=raw_text, user_query=user_query,
                api_key=api_key, model=eff_model,
                push=lambda ev: events.put(ev),
            )
            container["result"] = result
            container["usage"] = usage
        except anthropic.AuthenticationError:
            container["error"] = (401, "Invalid Anthropic API key. Update the key in Settings.")
        except anthropic.RateLimitError as e:
            retry_after = e.response.headers.get("retry-after", "60") if e.response else "60"
            container["error"] = (429, f"Anthropic rate limit hit. Retry after ~{retry_after}s.")
        except anthropic.BadRequestError as e:
            container["error"] = (400, f"Claude rejected the request: {e.message}")
        except anthropic.APIConnectionError:
            log.exception("anthropic connection error during pipeline stream")
            container["error"] = (503, "Could not reach Anthropic API. Check your network.")
        except anthropic.APIStatusError as e:
            log.exception("anthropic API error during pipeline stream")
            container["error"] = (502, f"Anthropic API error ({e.status_code}): {e.message}")
        except Exception as e:  # noqa: BLE001
            log.exception("pipeline stream failed")
            container["error"] = (500, f"Pipeline extraction failed: {e}")
        finally:
            events.put(SENTINEL)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    while True:
        ev = events.get()
        if ev is SENTINEL:
            break
        yield ev

    if container["error"]:
        status, detail = container["error"]
        yield {"type": "error", "status": status, "detail": detail}
        return

    yield {
        "type": "complete",
        "result": container["result"],
        "usage": container["usage"],
        "model_used": eff_model,
        "lens": "pipeline",
    }


def _run_pipeline_with_progress(
    *, filename, raw_text, user_query, api_key, model, push,
) -> tuple[PipelineResult, TokenUsage]:
    """Mirror of orchestrator.run_pipeline that pushes a `stage` event
    after each phase. Kept here (vs a callback inside the orchestrator)
    so the orchestrator stays synchronous and easy to test."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from services.lenses.pipeline.orchestrator import MAX_REVISIONS

    client = anthropic.Anthropic(api_key=api_key)
    total = TokenUsage(input_tokens=0, output_tokens=0)

    def acc(u: TokenUsage):
        total.input_tokens += u.input_tokens
        total.output_tokens += u.output_tokens
        total.cache_creation_input_tokens += u.cache_creation_input_tokens
        total.cache_read_input_tokens += u.cache_read_input_tokens
        push({"type": "usage", "input": total.input_tokens,
              "output": total.output_tokens, "max": 16000})

    push({"type": "stage", "name": "router", "detail": {}})
    router_out, u = agents.run_router(
        filename=filename, raw_text=raw_text, user_query=user_query,
        client=client, model=model,
    )
    acc(u)
    push({"type": "stage", "name": "router", "detail": {
        "doc_type": router_out.doc_type, "user_intent": router_out.user_intent,
        "depth": router_out.depth, "specialists": router_out.selected_specialists,
        "done": True,
    }})

    push({"type": "stage", "name": "extractor", "detail": {}})
    extractor_out, u = agents.run_extractor(
        filename=filename, raw_text=raw_text,
        client=client, model=model,
    )
    acc(u)
    push({"type": "stage", "name": "extractor", "detail": {
        "people": len(extractor_out.people), "orgs": len(extractor_out.organizations),
        "dates": len(extractor_out.dates), "numbers": len(extractor_out.numbers),
        "done": True,
    }})

    specialist_outputs: dict[str, dict] = {}
    if router_out.selected_specialists:
        push({"type": "stage", "name": "specialists", "detail": {
            "running": list(router_out.selected_specialists),
        }})
        with ThreadPoolExecutor(max_workers=4) as pool:
            future_to_key = {
                pool.submit(
                    agents.run_specialist,
                    key=key, filename=filename, raw_text=raw_text,
                    extractor_output=extractor_out,
                    client=client, model=model,
                ): key
                for key in router_out.selected_specialists
            }
            for future in as_completed(future_to_key):
                key = future_to_key[future]
                try:
                    output, u = future.result()
                    specialist_outputs[key] = output.model_dump(mode="json")
                    acc(u)
                    push({"type": "stage", "name": "specialist_done", "detail": {"key": key}})
                except Exception as e:  # noqa: BLE001
                    log.warning("pipeline: specialist %s failed: %s", key, e)
                    push({"type": "stage", "name": "specialist_failed", "detail": {"key": key, "error": str(e)}})

    push({"type": "stage", "name": "synthesizer", "detail": {}})
    synth_out, u = agents.run_synthesizer(
        doc_type=router_out.doc_type, user_intent=router_out.user_intent,
        extractor_output=extractor_out, specialist_outputs=specialist_outputs,
        critic_issues=None, client=client, model=model,
    )
    acc(u)
    push({"type": "stage", "name": "synthesizer", "detail": {"template": synth_out.template, "done": True}})

    critic_out = None
    revision_count = 0
    word_count = len(raw_text.split())
    while revision_count <= MAX_REVISIONS:
        push({"type": "stage", "name": "critic", "detail": {"pass": revision_count}})
        critic_out, u = agents.run_critic(
            doc_type=router_out.doc_type, user_intent=router_out.user_intent,
            depth=router_out.depth,
            synthesizer_output=synth_out,
            source_word_count=word_count,
            client=client, model=model,
        )
        acc(u)
        push({"type": "stage", "name": "critic", "detail": {
            "verdict": critic_out.verdict, "issue_count": len(critic_out.issues),
            "pass": revision_count, "done": True,
        }})
        if critic_out.verdict == "pass" or revision_count >= MAX_REVISIONS:
            break
        revision_count += 1
        push({"type": "stage", "name": "synthesizer", "detail": {"revising": True, "pass": revision_count}})
        synth_out, u = agents.run_synthesizer(
            doc_type=router_out.doc_type, user_intent=router_out.user_intent,
            extractor_output=extractor_out, specialist_outputs=specialist_outputs,
            critic_issues=[i.model_dump(mode="json") for i in critic_out.issues],
            client=client, model=model,
        )
        acc(u)
        push({"type": "stage", "name": "synthesizer", "detail": {"revising": True, "pass": revision_count, "done": True}})

    return PipelineResult(
        router=router_out,
        extractor=extractor_out,
        specialists=specialist_outputs,
        synthesizer=synth_out,
        critic=critic_out,
        revision_count=revision_count,
    ), total
