"""Streaming dossier extraction (M14.1.c).

Mirror of `services.streaming.stream_extraction` for the dossier lens.
Same SSE event shape (start / usage / complete / error) so the frontend
doesn't need to know about the new lens — `extractStream({lens:'dossier'})`
on the client just works.

Pattern: tool-use streaming via Anthropic's `messages.stream()`, with the
DocumentDossier Pydantic schema serialized as the tool's `input_schema`.
The model writes JSON token-by-token; we forward `usage` events for the
LoadingState progress card; at the end, parse the tool_use block into
DocumentDossier.

Like the stories streamer: NO `thinking` parameter (Anthropic rejects
`thinking + tool_choice={"type":"tool"}`), reasoning lift is small
because output is already schema-constrained.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Iterator

import anthropic
from pydantic import ValidationError

from services.cost import TokenUsage
from services.lenses.dossier import DocumentDossier, DOSSIER_SYSTEM, _mock

log = logging.getLogger("storyforge.stream.dossier")

MAX_OUTPUT_TOKENS = 16000  # dossier needs more than stories — schema is bigger


def stream_dossier_extraction(
    *,
    filename: str,
    raw_text: str,
    api_key: str | None,
    model: str | None,
    prompt_suffix: str | None = None,
) -> Iterator[dict]:
    """Yield streaming events for a dossier extraction.

    Sync generator — runs in FastAPI's threadpool. Errors emit as `error`
    events; happy path is `usage` × N → `complete`.
    """
    # ----- mock mode --------------------------------------------------------
    if not api_key:
        result = _mock(filename, raw_text)
        # Fake a few usage ticks so the LoadingState progress card animates.
        # Thresholds match the dossier's likely token shape (front-loaded
        # bridges + smaller sections, then heavier interrogate / act sections).
        for tokens in (300, 1500, 4500, 8500, 12000):
            time.sleep(0.2)
            yield {"type": "usage", "input": 0, "output": tokens, "max": MAX_OUTPUT_TOKENS}
        yield {
            "type": "complete",
            "result": result,
            "usage": None,
            "model_used": "mock",
            "lens": "dossier",
        }
        return

    # ----- live --------------------------------------------------------------
    from extract import resolve_model
    eff_model = resolve_model(model)
    client = anthropic.Anthropic(api_key=api_key)
    schema = DocumentDossier.model_json_schema()
    tool = {
        "name": "emit_dossier",
        "description": "Emit the structured DocumentDossier for this source document.",
        "input_schema": schema,
    }

    user_msg = (
        f"Source document: {filename}\n\n"
        f"---BEGIN SOURCE---\n{raw_text}\n---END SOURCE---\n\n"
        "Call emit_dossier with the full DocumentDossier now."
    )

    system_text = DOSSIER_SYSTEM
    if prompt_suffix:
        system_text = system_text + f"\n\nAdditional house-style instructions: {prompt_suffix}"

    try:
        with client.messages.stream(
            model=eff_model,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=[{
                "type": "text",
                "text": system_text,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user_msg}],
            tools=[tool],
            tool_choice={"type": "tool", "name": "emit_dossier"},
        ) as stream:
            last_output = -1
            for event in stream:
                etype = getattr(event, "type", None)
                if etype == "message_delta":
                    u = getattr(event, "usage", None)
                    if u is not None:
                        out = getattr(u, "output_tokens", 0) or 0
                        if out != last_output:
                            last_output = out
                            yield {
                                "type": "usage",
                                "input": getattr(u, "input_tokens", 0) or 0,
                                "output": out,
                                "max": MAX_OUTPUT_TOKENS,
                            }
            final_message = stream.get_final_message()
    except anthropic.AuthenticationError:
        log.warning("anthropic auth failed during dossier stream")
        yield {"type": "error", "status": 401,
               "detail": "Invalid Anthropic API key. Update the key in Settings."}
        return
    except anthropic.RateLimitError as e:
        retry_after = e.response.headers.get("retry-after", "60") if e.response else "60"
        yield {"type": "error", "status": 429,
               "detail": f"Anthropic rate limit hit. Retry after ~{retry_after}s."}
        return
    except anthropic.BadRequestError as e:
        yield {"type": "error", "status": 400,
               "detail": f"Claude rejected the request: {e.message}"}
        return
    except anthropic.APIConnectionError:
        log.exception("anthropic connection error during dossier stream")
        yield {"type": "error", "status": 503,
               "detail": "Could not reach Anthropic API. Check your network."}
        return
    except anthropic.APIStatusError as e:
        log.exception("anthropic API error during dossier stream")
        yield {"type": "error", "status": 502,
               "detail": f"Anthropic API error ({e.status_code}): {e.message}"}
        return
    except Exception as e:
        log.exception("dossier stream failed")
        yield {"type": "error", "status": 500,
               "detail": f"Dossier extraction failed: {e}"}
        return

    tool_block = next(
        (b for b in final_message.content if getattr(b, "type", None) == "tool_use"),
        None,
    )
    if tool_block is None:
        yield {"type": "error", "status": 502,
               "detail": "Model returned no tool use. Try rerunning."}
        return

    try:
        dossier = DocumentDossier(**tool_block.input)
    except ValidationError as e:
        yield {"type": "error", "status": 502,
               "detail": f"Model returned invalid dossier: {e.errors()[:2]}"}
        return

    raw_usage = final_message.usage
    usage = TokenUsage(
        input_tokens=getattr(raw_usage, "input_tokens", 0) or 0,
        output_tokens=getattr(raw_usage, "output_tokens", 0) or 0,
        cache_creation_input_tokens=getattr(raw_usage, "cache_creation_input_tokens", 0) or 0,
        cache_read_input_tokens=getattr(raw_usage, "cache_read_input_tokens", 0) or 0,
    )

    yield {
        "type": "complete",
        "result": dossier,
        "usage": usage,
        "model_used": eff_model,
        "lens": "dossier",
    }
