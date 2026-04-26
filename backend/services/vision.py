"""Image input via Claude vision (M7.4).

Accepts an uploaded image (screenshot of a mockup, whiteboard photo, design
comp with annotations, etc.) and runs it through Claude vision to produce
a prose description suitable for the existing extraction pipeline.

Architecture mirrors M7.3 OCR: two-call path, not one.
  1. `describe_image_via_claude()` here turns image → prose description
  2. The prose flows into the normal `call_claude` / `stream_extraction`
     path as `raw_text` — same code, no per-input-type branching downstream

Why two calls instead of one:
  - The downstream extraction pipeline (prompt template, tool-use schema,
    streaming, regen, BYOK key resolution, plan limits) has one known
    shape: text in, structured payload out. Splicing image input into
    every Claude call site would duplicate that complexity five times.
  - The cost difference (1 vision-describe + 1 extract vs 1 image+extract)
    is small for the use case — image inputs are rare relative to text.
  - The prose description becomes `raw_text` in the persisted extraction,
    so M5.2 click-to-source works on what Claude described (e.g. "user
    sees a login button labeled 'Sign in'") just like a normal text doc.

Public surface:
  - mime_for_ext(ext: str) -> str | None
  - describe_image_via_claude(image_bytes, mime_type, *, api_key, model)
        -> (description_text, TokenUsage)
"""

from __future__ import annotations

import base64
import logging

import anthropic
from fastapi import HTTPException

from services.cost import TokenUsage

log = logging.getLogger("storyforge.vision")

# Anthropic supports these four image media types.
_EXT_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def mime_for_ext(ext: str) -> str | None:
    """Map a file extension (lowercased, with leading dot) to an Anthropic-
    supported image media type. Returns None when the extension isn't an
    image — caller should treat that as "not an image, take the text path"."""
    return _EXT_TO_MIME.get((ext or "").lower())


# Tuned for "describe a UI mockup or annotated whiteboard photo as a
# requirements brief". Keep it close to a system-prompt — short, specific,
# bias toward thoroughness over polish since the output IS the input to
# the extraction step (more detail → better stories).
DESCRIBE_PROMPT = (
    "This image is a source artifact for product requirements (a UI mockup, "
    "whiteboard photo, design comp, or sketch). Describe what you see in "
    "thorough detail, written as a requirements brief that another analyst "
    "could read without seeing the image. Cover:\n\n"
    "- Every visible element, label, button, input field, badge, status indicator\n"
    "- Any text, including small text in toolbars, footers, or annotations\n"
    "- The flow or hierarchy implied by arrows, callouts, numbered steps, or layout\n"
    "- Any handwritten notes or annotations and what they appear to instruct\n"
    "- Implied actors (user roles depicted) and implied actions (what they do)\n\n"
    "Write in plain prose, paragraphs separated by blank lines. Don't apologise "
    "or qualify ('it appears that…'); state what you see. Don't include markdown "
    "headers — the downstream extractor adds its own structure."
)


def describe_image_via_claude(
    image_bytes: bytes,
    mime_type: str,
    *,
    api_key: str,
    model: str,
) -> tuple[str, TokenUsage]:
    """Send the image to Claude as a vision input; return (prose, usage).

    Same error-translation contract as services/ocr.ocr_pdf_via_claude —
    401 / 429 / 400 / 502 / 503 / 500. Caller surfaces them.

    No `thinking`, no tool use, no user prompt suffix (M7.1) — describing
    is a mechanical operation. Custom instructions risk the model
    interpreting the image instead of literally describing it; the
    extraction step (which DOES use the suffix) interprets the
    description.
    """
    client = anthropic.Anthropic(api_key=api_key)
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")

    try:
        response = client.messages.create(
            model=model,
            # 4K is plenty for a description of a single screenshot. Multi-
            # image input would warrant a higher cap; deferred until M7.5
            # (multi-doc) or a dedicated multi-image flow.
            max_tokens=4000,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": DESCRIBE_PROMPT},
                    ],
                }
            ],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid Anthropic API key (vision call rejected).")
    except anthropic.RateLimitError as e:
        retry_after = e.response.headers.get("retry-after", "60") if e.response else "60"
        raise HTTPException(status_code=429, detail=f"Anthropic rate limit hit during vision. Retry after ~{retry_after}s.")
    except anthropic.BadRequestError as e:
        raise HTTPException(status_code=400, detail=f"Claude rejected the image: {e.message}")
    except anthropic.APIConnectionError:
        log.exception("anthropic connection error during vision")
        raise HTTPException(status_code=503, detail="Could not reach Anthropic for vision.")
    except anthropic.APIStatusError as e:
        log.exception("anthropic API error during vision")
        raise HTTPException(status_code=502, detail=f"Anthropic vision error ({e.status_code}): {e.message}")
    except Exception as e:
        log.exception("vision call failed")
        raise HTTPException(status_code=500, detail=f"Vision call failed: {e}")

    text_parts = [
        block.text
        for block in (response.content or [])
        if getattr(block, "type", None) == "text"
    ]
    description = "\n".join(text_parts).strip()

    if not description:
        raise HTTPException(status_code=422, detail="Vision succeeded but the image produced no description.")

    raw_usage = getattr(response, "usage", None)
    usage = TokenUsage(
        input_tokens=getattr(raw_usage, "input_tokens", 0) or 0,
        output_tokens=getattr(raw_usage, "output_tokens", 0) or 0,
        cache_creation_input_tokens=getattr(raw_usage, "cache_creation_input_tokens", 0) or 0,
        cache_read_input_tokens=getattr(raw_usage, "cache_read_input_tokens", 0) or 0,
    )
    return description, usage
