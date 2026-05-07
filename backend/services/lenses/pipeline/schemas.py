"""M14.17 — Pydantic schemas for the multi-agent document understanding
pipeline. One schema per agent matching the JSON contracts in the spec.

The pipeline composes these into a final `PipelineResult` that gets
persisted to lens_payload. Frontend dispatches on the synthesizer's
template choice.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ============================================================================
# Common types
# ============================================================================

DocType = Literal[
    # Router v2 (M14.17.fix) — added process_design + status_report;
    # dropped email_thread / report / manual (rolled into "other") to
    # match the mandatory-specialists table.
    "agenda", "meeting_minutes", "contract", "policy", "process_design",
    "research_paper", "proposal", "financial_report", "technical_spec",
    "status_report", "other",
]
UserIntent = Literal["understand", "act", "decide", "learn", "communicate"]
Depth = Literal["thin", "moderate", "deep"]
SpecialistKey = Literal[
    "action_extractor", "risk_analyzer", "argument_mapper",
    "obligation_mapper", "glossary_builder", "numerical_analyzer",
    "timeline_builder",
]
Priority = Literal["high", "medium", "low"]
Severity = Literal["high", "medium", "low"]


# ============================================================================
# 1. Router
# ============================================================================

class RouterOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    doc_type: DocType
    doc_type_confidence: float = Field(ge=0.0, le=1.0)
    user_intent: UserIntent
    user_intent_confidence: float = Field(ge=0.0, le=1.0)
    depth: Depth
    selected_specialists: list[SpecialistKey]
    rationale: str


# ============================================================================
# 2. Extractor (always runs)
# ============================================================================

class ExtractorSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    heading: str
    span: str  # verbatim quote, max 200 chars


class ExtractorPerson(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    role: str | None = None
    mentions: int


class ExtractorOrg(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    mentions: int


class ExtractorPlace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    context: str


class ExtractorDate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: str  # ISO or as-written
    context: str


class ExtractorNumber(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: str
    unit: str | None = None
    context: str


class StructureSignals(BaseModel):
    model_config = ConfigDict(extra="forbid")
    has_table_of_contents: bool
    has_numbered_sections: bool
    has_tables: bool
    approximate_word_count: int


class ExtractorOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    sections: list[ExtractorSection]
    people: list[ExtractorPerson]
    organizations: list[ExtractorOrg]
    places: list[ExtractorPlace]
    dates: list[ExtractorDate]
    numbers: list[ExtractorNumber]
    key_terms: list[str]
    structure_signals: StructureSignals


# ============================================================================
# 3. Action Extractor
# ============================================================================

class ExplicitAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    owner: str
    deadline: str
    source_span: str
    priority: Priority


class ImpliedAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    owner: str
    deadline: str
    rationale: str
    priority: Priority


class DecisionMade(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: str
    source_span: str


class DecisionPending(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str
    blocker: str


class ActionExtractorOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actions_explicit: list[ExplicitAction]
    actions_implied: list[ImpliedAction]
    decisions_made: list[DecisionMade]
    decisions_pending: list[DecisionPending]


# ============================================================================
# 4. Risk Analyzer
# ============================================================================

RiskCategory = Literal[
    "single_point_of_failure", "role_conflict", "timing_conflict",
    "missing_prerequisite", "external_dependency", "ambiguity",
    "constraint_violation",
]


class Risk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    what_breaks: str
    trigger: str
    impact: Severity
    likelihood: Severity
    evidence: str
    category: RiskCategory


class RiskAnalyzerOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    risks: list[Risk]


# ============================================================================
# 5. Argument Mapper
# ============================================================================

EvidenceType = Literal["data", "citation", "anecdote", "logical", "appeal_to_authority"]
EvidenceQuality = Literal["strong", "moderate", "weak", "absent"]


class ArgumentEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: EvidenceType
    summary: str
    source_span: str


class ArgumentClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: str
    evidence: list[ArgumentEvidence]
    evidence_quality: EvidenceQuality
    source_span: str


class UnsupportedClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: str
    why_unsupported: str


class LogicalGap(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gap: str
    between: list[str]


class ArgumentMapperOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    thesis: str | None = None
    claims: list[ArgumentClaim]
    unsupported_claims: list[UnsupportedClaim]
    logical_gaps: list[LogicalGap]


# ============================================================================
# 6. Obligation Mapper
# ============================================================================

class Party(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    role: str


class Obligation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    obligor: str
    obligee: str
    obligation: str
    trigger: str
    deadline: str
    consequence_of_breach: str
    source_span: str


class ExitClause(BaseModel):
    model_config = ConfigDict(extra="forbid")
    party: str
    trigger: str
    notice_period: str
    source_span: str


class RedFlag(BaseModel):
    model_config = ConfigDict(extra="forbid")
    flag: str
    why: str
    source_span: str


class ObligationMapperOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parties: list[Party]
    obligations: list[Obligation]
    exit_clauses: list[ExitClause]
    red_flags: list[RedFlag]


# ============================================================================
# 7. Glossary Builder
# ============================================================================

class GlossaryTerm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    term: str
    definition: str
    domain: str
    first_use_span: str


class GlossaryBuilderOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    terms: list[GlossaryTerm]


# ============================================================================
# 8. Numerical Analyzer
# ============================================================================

class HeadlineNumber(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    value: str
    unit: str
    source_span: str


class DerivedMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    value: str
    calculation: str
    inputs: list[str]


class NumericalAnomaly(BaseModel):
    model_config = ConfigDict(extra="forbid")
    what: str
    why_unusual: str
    source_span: str


TrendDirection = Literal["up", "down", "flat", "volatile"]


class Trend(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric: str
    direction: TrendDirection
    evidence: str


class NumericalAnalyzerOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    headline_numbers: list[HeadlineNumber]
    derived_metrics: list[DerivedMetric]
    anomalies: list[NumericalAnomaly]
    trends: list[Trend]


# ============================================================================
# 9. Timeline Builder
# ============================================================================

class TimelineEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    start: str
    end: str | None = None
    depends_on: list[str]
    source_span: str


class TightTransition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_: str = Field(alias="from")
    to: str
    gap: str
    concern: str

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class UnscheduledGap(BaseModel):
    model_config = ConfigDict(extra="forbid")
    between: list[str]
    duration: str
    note: str


class TimelineBuilderOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[TimelineEvent]
    tight_transitions: list[TightTransition]
    unscheduled_gaps: list[UnscheduledGap]


# ============================================================================
# 10. Synthesizer
# ============================================================================

# Synthesizer output is template-shaped — different templates produce
# different fields. We model it loosely as a dict with a `template` tag
# rather than enforcing one schema per template (would be 5+ models with
# heavy overlap; the frontend dispatches on `template` already).

class SynthesizerOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template: str  # e.g. "agenda_act", "contract_decide", "default"
    sections: dict[str, Any]  # template-specific fields go here


# ============================================================================
# 11. Critic
# ============================================================================

CriticIssueType = Literal[
    "repetition", "buried_lede", "depth_mismatch", "padding", "missing_citation",
]
CriticVerdict = Literal["pass", "needs_revision"]


class CriticIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: CriticIssueType
    where: str
    fix: str


class CriticOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: CriticVerdict
    issues: list[CriticIssue]
    overall_quality: int = Field(ge=1, le=5)


# ============================================================================
# Final pipeline result — what we persist to lens_payload
# ============================================================================

class PipelineResult(BaseModel):
    """The full pipeline output. Stored in extraction.lens_payload.

    The synthesizer output is the user-facing bit; everything else is
    kept for transparency / diff / regen.
    """
    model_config = ConfigDict(extra="forbid")
    router: RouterOutput
    extractor: ExtractorOutput
    specialists: dict[str, dict]  # specialist_key → that specialist's JSON output
    synthesizer: SynthesizerOutput
    critic: CriticOutput | None = None
    revision_count: int = 0
