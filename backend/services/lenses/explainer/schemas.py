"""M14.18 — Document Explainer schemas.

Two-deliverable output:
  1. plain_english: structured breakdown of what the document actually says,
     organized by sections appropriate to the doc type
  2. management_pitch: 7-block jargon-free explanation a non-technical
     audience can follow in a meeting

Plus metadata + flagged_issues for ambiguities/conflicts/missing info.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# Doc types — narrower than the pipeline router's set; just enough to tell
# the renderer which heading style to use.
ExplainerDocType = Literal[
    "rules_policy", "report_research", "contract_agreement",
    "technical_spec", "financial_budget", "other",
]


class ExplainerSection(BaseModel):
    """One section within the plain-english breakdown.
    `body` is markdown — supports headings, lists, tables, code, links.
    `source_quotes` are verbatim snippets from the original document
    that back up the section's claims; the frontend renders them as a
    "Sources" disclosure under the card so the user can verify the
    explanation against the document."""
    model_config = ConfigDict(extra="forbid")
    heading: str = Field(description="Short section title, e.g. 'Who it applies to'")
    body: str = Field(description="Markdown content; tables for comparative data, numbered lists for steps, bullets for independent items")
    source_quotes: list[str] = Field(
        default_factory=list,
        description="2-4 verbatim quotes from the original document that support the body. Each ≤200 chars. Quote exactly as written, including casing and punctuation; do not paraphrase. Empty list only when the section is purely synthesis (rare).",
    )


class PlainEnglishExplanation(BaseModel):
    """The structured breakdown of what the document says."""
    model_config = ConfigDict(extra="forbid")
    doc_type: ExplainerDocType = Field(
        description="Which doc-type pattern was used. Drives section headings.",
    )
    sections: list[ExplainerSection] = Field(
        description="Headings vary by doc_type — see prompt. 4-8 sections typical.",
    )


class ManagementPitch(BaseModel):
    """7-block explanation for a non-technical audience.

    Tone is conversational. Numbers are real examples from the document
    (not abstract). No 'as per section X' / 'refer to Annexure Y' — the
    pitch states things directly.
    """
    model_config = ConfigDict(extra="forbid")
    one_line_summary: str = Field(
        description="One sentence: what this document is and why it matters.",
    )
    big_picture: str = Field(
        description="2-3 sentences: what problem does this address, what decision/situation does it describe, what change does it introduce?",
    )
    key_drivers: list[str] = Field(
        description="2-3 questions or statements naming the variables that determine outcomes. Plain-language; a non-expert grasps each immediately.",
    )
    practical_example: str = Field(
        description="A worked example with real numbers/names from the document. Show, don't tell. Avoid abstract descriptions.",
    )
    key_risks_or_safeguards: list[str] = Field(
        description="2-3 things management most needs to know to avoid problems or make good decisions. Each 2-3 sentences.",
    )
    whats_new: list[str] = Field(
        default_factory=list,
        description="Bullet points — what changed, what stayed the same. Empty list if document isn't a revision/update/comparison.",
    )
    closer: str = Field(
        description="One memorable sentence that captures the spirit or importance of the document.",
    )


class ExplainerMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    source_filename: str | None = None
    word_count: int = 0


LegendKind = Literal["process", "data", "external", "decision", "storage"]


class LegendItem(BaseModel):
    """One entry in the diagram legend, paired with a node class
    that nodes in the Mermaid source can reference via `:::`."""
    model_config = ConfigDict(extra="forbid")
    kind: LegendKind = Field(description="Semantic type. The frontend maps this to a colored swatch and applies the matching classDef in the diagram.")
    label: str = Field(description="Short human-readable description, e.g. 'Module / processing step' or 'External system'.")


class ExplainerDiagram(BaseModel):
    """Optional Mermaid diagram when the document describes a process,
    pipeline, or set of interacting components.

    `source` is raw Mermaid syntax (flowchart / sequenceDiagram / stateDiagram
    / etc.) — the frontend renders it via mermaid.js with a brand-themed
    palette. `caption` is a short one-line label shown above the diagram.
    `legend` is optional; when present, the frontend renders colored
    swatches and the prompt instructs Claude to apply the matching
    classDef (`process`, `data`, `external`, `decision`, `storage`) to
    nodes via Mermaid's `:::class` syntax so node colors line up with
    the legend.
    """
    model_config = ConfigDict(extra="forbid")
    caption: str = Field(description="Short one-line caption shown above the diagram.")
    source: str = Field(description="Raw Mermaid source. Must start with a valid diagram type keyword (flowchart, sequenceDiagram, stateDiagram, etc.). Apply node classes via `:::process` / `:::data` / `:::external` / `:::decision` / `:::storage` when emitting a legend.")
    legend: list[LegendItem] = Field(
        default_factory=list,
        description="Optional legend items. Empty list if a single visual style is enough.",
    )


KeyFactKind = Literal["number", "money", "date", "deadline", "name", "duration", "percentage", "other"]


class KeyFact(BaseModel):
    """One scannable fact pulled from the document. Renders as a
    chip/card in the Key Facts panel above the plain-English
    explanation. The point is "30-second scan" — every fact stands
    alone with enough context that the user understands it without
    reading the body."""
    model_config = ConfigDict(extra="forbid")
    kind: KeyFactKind = Field(description="Semantic type — drives the icon and color in the chip.")
    label: str = Field(description="Short label, ≤6 words, e.g. 'Daily hotel limit, Grade 3'.")
    value: str = Field(description="The fact itself, exact from the document. e.g. '₹3,000', '15 March 2026', 'Acme Corp Pvt Ltd'.")
    context: str = Field(
        default="",
        description="One short sentence (≤140 chars) of surrounding context — when/where/to whom this applies. Empty if the label+value are self-explanatory.",
    )


class GlossaryTerm(BaseModel):
    """One term defined for the user. Includes acronyms, role names,
    domain-specific jargon, and any term the document uses that a
    layperson wouldn't know. The frontend renders these as a
    definition list."""
    model_config = ConfigDict(extra="forbid")
    term: str = Field(description="The term as it appears in the document, e.g. 'GRN', 'Three-Way Matching', 'GSTR-3B'.")
    definition: str = Field(description="Plain-language definition, ≤200 chars. Avoid using other jargon to define jargon.")
    expansion: str = Field(
        default="",
        description="Acronym expansion if applicable, e.g. 'Goods Receipt Note'. Empty for non-acronyms.",
    )


RecommendationPriority = Literal["high", "medium", "low"]
RecommendationKind = Literal["action", "watch_out", "opportunity", "compliance", "decision"]


class Recommendation(BaseModel):
    """One forward-looking, actionable item derived from the document.
    Different from management_pitch (which explains) — recommendations
    say what to DO. Each has a priority, a kind that drives the icon
    and color, a short action-oriented title, the rationale, and a
    concrete next step the user can take."""
    model_config = ConfigDict(extra="forbid")
    priority: RecommendationPriority = Field(description="`high` for must-act-soon items (deadlines, compliance, risks); `medium` for should-do; `low` for nice-to-have.")
    kind: RecommendationKind = Field(description="`action` = generic do-this; `watch_out` = a risk/pitfall to avoid; `opportunity` = a benefit to capture; `compliance` = regulatory/policy obligation; `decision` = a choice the reader needs to make.")
    title: str = Field(description="Short, action-oriented, ≤90 chars. Start with a verb when possible (Set, Schedule, Review, Confirm, Negotiate).")
    rationale: str = Field(description="1-2 sentences explaining WHY this matters, grounded in the document's content. Reference the specific clause, number, or finding that drives the recommendation.")
    suggested_action: str = Field(description="One concrete next step, ≤200 chars. Specific enough that the user knows what to do tomorrow.")


class ExplainerOutput(BaseModel):
    """Full explainer payload — what gets stored in lens_payload.

    M14.18.fix — removed flagged_issues. Earlier versions surfaced
    ambiguities and missing-info as a static "Gaps & questions" callout
    above the explanation; the chat panel now handles those queries on
    demand, so we drop the static block entirely.
    """
    model_config = ConfigDict(extra="forbid")
    metadata: ExplainerMetadata
    plain_english: PlainEnglishExplanation
    management_pitch: ManagementPitch
    diagram: ExplainerDiagram | None = Field(
        default=None,
        description="Optional Mermaid flow/sequence/state diagram. Populated when the document describes a process, pipeline, or interacting components; null otherwise.",
    )
    key_facts: list[KeyFact] = Field(
        default_factory=list,
        description="6-12 scannable facts (numbers, dates, names, money) for the 30-second scan. Empty list only for documents with no concrete facts.",
    )
    glossary: list[GlossaryTerm] = Field(
        default_factory=list,
        description="Domain terms, acronyms, and jargon used in the document with plain-language definitions. Empty list when the document uses no specialized terminology.",
    )
    recommendations: list[Recommendation] = Field(
        default_factory=list,
        description="3-7 forward-looking recommendations derived from the document — what to DO, watch out for, decide, or capture. Empty list only when the document genuinely doesn't imply any action (rare).",
    )
