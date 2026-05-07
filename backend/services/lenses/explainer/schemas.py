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
    `body` is markdown — supports headings, lists, tables, code, links."""
    model_config = ConfigDict(extra="forbid")
    heading: str = Field(description="Short section title, e.g. 'Who it applies to'")
    body: str = Field(description="Markdown content; tables for comparative data, numbered lists for steps, bullets for independent items")


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


class ExplainerOutput(BaseModel):
    """Full explainer payload — what gets stored in lens_payload."""
    model_config = ConfigDict(extra="forbid")
    metadata: ExplainerMetadata
    plain_english: PlainEnglishExplanation
    management_pitch: ManagementPitch
    flagged_issues: list[str] = Field(
        default_factory=list,
        description="Ambiguities, conflicts between sections, or critical info missing from the source. Each is a complete sentence stating the issue. Empty list if none.",
    )
