"""M14.18 — Document Explainer extractor.

Single Claude call producing a fully-validated ExplainerOutput. Uses
messages.parse() with response schema enforced. Mock mode returns a
placeholder so dev runs without an API key.
"""

from __future__ import annotations

import logging

import anthropic

from services.cost import TokenUsage
from services.lenses.explainer.prompts import EXPLAINER_SYSTEM, build_user_message
from services.lenses.explainer.schemas import (
    ExplainerMetadata,
    ExplainerOutput,
    ExplainerSection,
    ManagementPitch,
    PlainEnglishExplanation,
)

log = logging.getLogger(__name__)

MAX_OUTPUT_TOKENS = 16000


def explain_document(
    filename: str,
    raw_text: str,
    *,
    api_key: str | None,
    model: str | None,
    prompt_suffix: str | None = None,
) -> tuple[ExplainerOutput, TokenUsage | None]:
    """Run the explainer. Returns (ExplainerOutput, usage).

    Mock mode (api_key=None): returns a small placeholder output telegraphing
    that the user needs to set an API key.
    """
    if not api_key:
        return _mock(filename, raw_text), None

    from extract import resolve_model
    eff_model = resolve_model(model)
    # M14.18.fix — explicit 4-minute client timeout so a stuck Claude
    # call surfaces an error instead of spinning forever (saw a 320s+
    # silent hang on a long PDF with adaptive thinking enabled).
    client = anthropic.Anthropic(api_key=api_key, timeout=240.0)

    system_text = EXPLAINER_SYSTEM
    if prompt_suffix:
        system_text = system_text + f"\n\nAdditional house-style instructions: {prompt_suffix}"

    # M14.18.fix — adaptive thinking + 16k output cap is overkill for
    # structured extraction. Disable thinking; the schema does the
    # constraint work. Plus output_config.effort=low encourages
    # terser, faster output.
    response = client.messages.parse(
        model=eff_model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=[{
            "type": "text",
            "text": system_text,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": build_user_message(filename, raw_text)}],
        output_format=ExplainerOutput,
        output_config={"effort": "low"},
        thinking={"type": "disabled"},
    )
    output = response.parsed_output
    raw_usage = response.usage
    usage = TokenUsage(
        input_tokens=getattr(raw_usage, "input_tokens", 0) or 0,
        output_tokens=getattr(raw_usage, "output_tokens", 0) or 0,
        cache_creation_input_tokens=getattr(raw_usage, "cache_creation_input_tokens", 0) or 0,
        cache_read_input_tokens=getattr(raw_usage, "cache_read_input_tokens", 0) or 0,
    )
    return output, usage


def _mock(filename: str, raw_text: str) -> ExplainerOutput:
    return ExplainerOutput(
        metadata=ExplainerMetadata(
            title=filename or "Mock document",
            source_filename=filename,
            word_count=len(raw_text.split()),
        ),
        plain_english=PlainEnglishExplanation(
            doc_type="other",
            sections=[
                ExplainerSection(
                    heading="Mock mode",
                    body=(
                        "This output came from the mock path because no Anthropic "
                        "API key was provided. Add a key in **Settings → API key** "
                        "and re-run to see the real Document Explainer output."
                    ),
                ),
            ],
        ),
        management_pitch=ManagementPitch(
            one_line_summary="The Document Explainer is in mock mode — set up an Anthropic API key to see real output.",
            big_picture=(
                "Without a Claude API key, the system can't actually read your document. "
                "Real output explains your document in plain language plus a management-ready pitch."
            ),
            key_drivers=[
                "Is the API key configured?",
                "Was the document uploaded successfully?",
                "Does the document have readable text?",
            ],
            practical_example=(
                "Once configured, uploading a 10-page expense policy produces a structured "
                "breakdown of who it applies to, the core rules with conditions and outcomes, "
                "and a management pitch you can drop into a leadership meeting unchanged."
            ),
            key_risks_or_safeguards=[
                "The mock output is not a real analysis. Don't share it as if it were.",
                "Without a key, every upload returns this same placeholder.",
            ],
            whats_new=[],
            closer="Set up the key, upload again, and the document gets a proper explanation.",
        ),
    )
