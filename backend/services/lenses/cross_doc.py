"""M14.12 — Cross-doc project synthesis.

Take N dossier-lens extractions belonging to one project and ask Claude
to produce a single merged DocumentDossier:

- Merged glossary (deduped, terms appearing in ≥2 docs surface first)
- Combined actor list
- Cross-doc 5W1H (whose `who` is the union of stakeholders, etc.)
- Synthesized brief that names the project not the docs
- Action items rolled up across docs (deduped on owner+verb)
- Timeline merged (preserve doc-of-origin in description)
- Decisions consolidated (made/open buckets across docs)

The result is persisted as a new Extraction row in the same project with
filename like "Synthesis · {project_name} · {N} docs". Marked
synthetically (model_used="synthesis"; raw_text is the concatenated
sources for chat-time context).
"""

from __future__ import annotations

import json
import logging

import anthropic

from extract import resolve_model
from services.cost import TokenUsage
from services.lenses.dossier import DOSSIER_SYSTEM, DocumentDossier

log = logging.getLogger(__name__)


SYNTHESIS_INSTRUCTION = """\
You are synthesizing several documents that belong to the same project
into a single merged dossier.

Each source document below has already been narrated as its own dossier.
Your job is to fuse them into ONE DocumentDossier that reads as a
project-level synthesis, not a stack of N summaries.

Synthesis rules:
- Brief: name the PROJECT, not "these N documents". Tags should reflect
  cross-cutting themes.
- Glossary: dedupe by term (case-insensitive). When the same term has
  conflicting definitions, prefer the most precise one and note the
  conflict in the definition.
- Mindmap: build one project-level mindmap; collapse redundant branches.
- Domain Map: union the points; dedupe near-duplicates.
- 5W1H / 5 Whys: produce ONE chain that holds across the whole project.
- Action Items: dedupe on (owner, verb). Keep the most specific 'when'.
- Decisions made / open: union; dedupe.
- Better Questions: 5-10 questions that span the project, not any one doc.
- Numbers Extract: union the facts (preserve doc-level distinctions if
  values conflict; e.g. "Cost: $10K [doc A] / $12K [doc B]").
- Timeline: merge phases; if two docs disagree on phase order, prefer the
  more recent doc's order.
- Negative Space: report what's missing across the WHOLE corpus.

If the source docs disagree on something material, surface that in the
relevant section's risk_explanation / why_it_matters / answer rather
than picking a side silently.
"""


def _format_source_dossiers(extractions: list) -> str:
    """Compact JSON dump of each source's lens_payload, separated by markers
    so Claude can attribute sections back to a doc when it matters."""
    blocks = []
    for i, e in enumerate(extractions, 1):
        # Slim each source: don't include the full raw_text since each
        # dossier already encodes the document. Keep filename + payload.
        payload = e.lens_payload or {}
        blocks.append(
            f"===== SOURCE DOC {i} — {e.filename} =====\n"
            + json.dumps(payload, indent=2, default=str)
        )
    return "\n\n".join(blocks)


def synthesize_project(
    *,
    project_name: str,
    extractions: list,
    api_key: str | None,
    model: str | None,
    prompt_suffix: str | None = None,
) -> tuple[DocumentDossier | None, TokenUsage | None]:
    """Run a project-level synthesis. Returns (DocumentDossier, usage).

    extractions: list of Extraction ORM rows with lens='dossier' and a
    populated lens_payload. Filtering is the caller's job.

    Mock mode (api_key None): returns None — caller should error or fall
    back rather than persist a meaningless synthesis.
    """
    if not extractions:
        raise ValueError("synthesize_project needs at least one source extraction")
    if not api_key:
        return None, None

    effective_model = resolve_model(model)
    client = anthropic.Anthropic(api_key=api_key)

    system_blocks = [{
        "type": "text",
        "text": DOSSIER_SYSTEM + "\n\n" + SYNTHESIS_INSTRUCTION + (
            f"\n\nAdditional house-style instructions: {prompt_suffix}"
            if prompt_suffix else ""
        ),
        "cache_control": {"type": "ephemeral"},
    }]

    user_msg = (
        f"Project: {project_name}\n"
        f"Number of source documents: {len(extractions)}\n\n"
        f"---BEGIN SOURCES---\n{_format_source_dossiers(extractions)}\n---END SOURCES---\n\n"
        "Produce a single merged DocumentDossier now."
    )

    response = client.messages.parse(
        model=effective_model,
        max_tokens=16000,
        system=system_blocks,
        messages=[{"role": "user", "content": user_msg}],
        output_format=DocumentDossier,
        thinking={"type": "adaptive"},
    )

    dossier = response.parsed_output
    usage = TokenUsage(
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        cache_creation_input_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
        cache_read_input_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
    )
    return dossier, usage
