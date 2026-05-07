"""M14.18 — Streaming wrapper for the Document Explainer lens.

The explainer is a single Claude call (~30-90s). No partial output
during the run — Claude emits the structured payload at the end. We
yield a heartbeat every 20s to keep the SSE connection alive past
Render's 60s idle timeout.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator

import anthropic

from services.cost import TokenUsage
from services.lenses.explainer.extract import explain_document
from services.lenses.explainer.schemas import ExplainerOutput

log = logging.getLogger("storyforge.stream.explainer")


def stream_explainer_extraction(
    *,
    filename: str,
    raw_text: str,
    api_key: str | None,
    model: str | None,
    prompt_suffix: str | None = None,
    **_ignored,  # accept few_shot_examples etc. for sig compat
) -> Iterator[dict]:
    """Yield streaming events for an explainer extraction.

    Event shape:
      {type: 'stage', name: str, detail: dict}  — phase markers
      {type: 'usage', input, output, max}        — token heartbeat
      {type: 'complete', result, usage, model_used, lens}
      {type: 'error', status, detail}
    """
    # ----- mock mode --------------------------------------------------------
    if not api_key:
        result, _ = explain_document(filename, raw_text, api_key=None, model=None)
        for stage in ("reading", "explaining", "writing_pitch", "finishing"):
            time.sleep(0.15)
            yield {"type": "stage", "name": stage, "detail": {"mock": True}}
            yield {"type": "usage", "input": 0, "output": 100, "max": 16000}
        yield {
            "type": "complete",
            "result": result,
            "usage": None,
            "model_used": "mock",
            "lens": "explainer",
        }
        return

    # ----- live --------------------------------------------------------------
    from extract import resolve_model
    eff_model = resolve_model(model)

    yield {"type": "stage", "name": "explaining", "detail": {}}

    # Run the (blocking) explainer in a thread so we can emit heartbeats
    # to keep the SSE alive across Render's 60s idle timeout. Single
    # agent call = simple thread + queue; no parallel orchestration.
    container: dict = {"result": None, "usage": None, "error": None}
    done_event = threading.Event()

    def worker():
        try:
            result, usage = explain_document(
                filename=filename, raw_text=raw_text,
                api_key=api_key, model=eff_model,
                prompt_suffix=prompt_suffix,
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
            log.exception("anthropic connection error during explainer stream")
            container["error"] = (503, "Could not reach Anthropic API. Check your network.")
        except anthropic.APIStatusError as e:
            log.exception("anthropic API error during explainer stream")
            container["error"] = (502, f"Anthropic API error ({e.status_code}): {e.message}")
        except Exception as e:  # noqa: BLE001
            log.exception("explainer stream failed")
            container["error"] = (500, f"Document explainer failed: {e}")
        finally:
            done_event.set()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    # Heartbeat every 20s; exit when worker signals done.
    HEARTBEAT_INTERVAL_S = 20
    elapsed = 0
    while not done_event.wait(HEARTBEAT_INTERVAL_S):
        elapsed += HEARTBEAT_INTERVAL_S
        yield {"type": "stage", "name": "heartbeat", "detail": {
            "phase": "explaining", "elapsed_s": elapsed,
        }}

    if container["error"]:
        status, detail = container["error"]
        yield {"type": "error", "status": status, "detail": detail}
        return

    result: ExplainerOutput = container["result"]
    usage: TokenUsage = container["usage"]

    yield {"type": "stage", "name": "explaining", "detail": {
        "doc_type": result.plain_english.doc_type,
        "section_count": len(result.plain_english.sections),
        "done": True,
    }}
    yield {
        "type": "usage",
        "input": usage.input_tokens, "output": usage.output_tokens, "max": 16000,
    }
    yield {
        "type": "complete",
        "result": result,
        "usage": usage,
        "model_used": eff_model,
        "lens": "explainer",
    }
