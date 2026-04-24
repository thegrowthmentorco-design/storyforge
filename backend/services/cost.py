"""Per-model pricing + cost computation (M3.0).

Source-of-truth pricing table. Keep in sync with the values shipped in the
public claude-api skill — when Anthropic publishes new model pricing, update
both. Cost is recorded as integer cents (×100 of dollars) so we can SUM
across UsageLog rows without floating-point drift.

Cache-token billing is approximated: cache reads at 10% of base input rate,
cache writes at 125%. We don't track cache vs base separately for output.
"""

from __future__ import annotations

from dataclasses import dataclass

# USD per 1M tokens. Cache rates are derived (read = 0.1 * input, write = 1.25 * input).
PRICING_USD_PER_M: dict[str, tuple[float, float]] = {
    "claude-opus-4-7": (5.00, 25.00),
    "claude-opus-4-6": (5.00, 25.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
}


@dataclass(frozen=True)
class TokenUsage:
    """Per-call token counts as reported by anthropic.types.Usage."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


def compute_cost_cents(model: str, usage: TokenUsage) -> int:
    """Best-effort cost in integer cents. Returns 0 for unknown/mock models.

    Approximates cache pricing — refine when we ship cache-aware billing.
    """
    rates = PRICING_USD_PER_M.get(model)
    if rates is None:
        return 0
    in_per_tok = rates[0] / 1_000_000
    out_per_tok = rates[1] / 1_000_000
    dollars = (
        usage.input_tokens * in_per_tok
        + usage.output_tokens * out_per_tok
        + usage.cache_read_input_tokens * in_per_tok * 0.10
        + usage.cache_creation_input_tokens * in_per_tok * 1.25
    )
    return round(dollars * 100)
