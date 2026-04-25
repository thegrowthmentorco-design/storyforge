"""Pricing tiers + per-tier limits (M3.5).

Single source of truth for what each plan includes. Locked in DECISIONS.md
on 2026-04-25 — change here only when the decisions doc is also updated.

Doc-size cap is in *characters*, not tokens, because we don't ship a Claude
tokenizer (Anthropic doesn't publish one and OpenAI's `tiktoken` is wrong
for Claude). Conservative conversion: 1 token ≈ 4 chars for English text.
50k tokens cap → 200k chars cap.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlanLimits:
    """Per-tier caps used by `services/limits.enforce_limits()`."""

    id: str                          # 'trial' / 'starter' / 'pro' / 'team' / 'expired'
    name: str                        # human-readable for the UI
    extractions_per_period: int      # /month for paid; total over trial for trial
    max_input_chars: int             # ~4 chars/token, conservative
    allowed_models: tuple[str, ...]
    upgrade_to: str | None           # next tier id; None for top tier
    price_per_seat_usd_cents: int    # 0 for trial; for display + paywall copy
    period_label: str = "this month"  # 'trial period' for trial


PLANS: dict[str, PlanLimits] = {
    "trial": PlanLimits(
        id="trial",
        name="Trial",
        extractions_per_period=10,
        max_input_chars=200_000,  # ~50k tokens, ~25 pages
        allowed_models=("claude-sonnet-4-6",),
        upgrade_to="starter",
        price_per_seat_usd_cents=0,
        period_label="trial",
    ),
    "starter": PlanLimits(
        id="starter",
        name="Starter",
        extractions_per_period=25,
        max_input_chars=200_000,
        allowed_models=("claude-sonnet-4-6",),
        upgrade_to="pro",
        price_per_seat_usd_cents=2000,  # $20.00
    ),
    "pro": PlanLimits(
        id="pro",
        name="Pro",
        extractions_per_period=100,
        max_input_chars=400_000,  # ~100k tokens, ~50 pages
        allowed_models=(
            "claude-sonnet-4-6",
            "claude-opus-4-7",
            "claude-opus-4-6",
        ),
        upgrade_to="team",
        price_per_seat_usd_cents=4900,  # $49.00
    ),
    "team": PlanLimits(
        id="team",
        name="Team",
        extractions_per_period=300,
        max_input_chars=800_000,  # ~200k tokens, ~100 pages
        allowed_models=(
            "claude-sonnet-4-6",
            "claude-opus-4-7",
            "claude-opus-4-6",
            "claude-haiku-4-5",
        ),
        upgrade_to=None,  # top tier
        price_per_seat_usd_cents=9900,  # $99.00
    ),
    # Sentinel for users whose trial expired without converting. Same shape
    # as a plan but with zero capacity — every gate fires "trial_expired".
    "expired": PlanLimits(
        id="expired",
        name="Trial expired",
        extractions_per_period=0,
        max_input_chars=0,
        allowed_models=(),
        upgrade_to="starter",
        price_per_seat_usd_cents=0,
    ),
}

DEFAULT_PLAN_ID = "trial"


def get_plan(plan_id: str | None) -> PlanLimits:
    """Resolve a plan id to its limits. NULL/unknown ids fall back to trial
    so legacy pre-M3.5 rows still work."""
    if not plan_id:
        return PLANS[DEFAULT_PLAN_ID]
    return PLANS.get(plan_id, PLANS[DEFAULT_PLAN_ID])
