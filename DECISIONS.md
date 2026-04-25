# StoryForge — Product Decisions (D1–D5)

> Locked **2026-04-25**. Source of truth for M3.5 (free-tier limits), M3.6 (Stripe SKUs), and any future product/pricing question. Override by adding a new dated entry below; don't silently re-edit the originals.

---

## D1 — Target user

**Individual contributors who write or review requirements docs.** Job titles: PM, Business Analyst, Tech Lead, Architect. Buyer is usually the IC themselves (solo / personal credit card) or one champion rolling it to 3–10 teammates (small team subscription, per-seat pricing).

Not targeting:
- Enterprise procurement / SSO / SOC 2 buyers (slow sales cycle, different product shape)
- ChatPRD's "PM writing PRDs from scratch" use case — adjacent but distinct workflow

**Why this user:** the core extraction job (messy BRD/notes → structured stories + gaps) only saves time for someone who has to *consume* requirements docs. PMs and BAs hit this multiple times a week. Tech leads less often but at higher value per use.

---

## D2 — Wedge / positioning

**"ChatPRD for *extraction*, at half the price."**

ChatPRD helps PMs author PRDs from scratch. StoryForge takes existing messy artifacts and turns them into structured user stories + gap analysis. Adjacent space, narrower job, lower price point.

Pitch one-liner: *"Drop a 30-page BRD, get clean user stories + acceptance criteria + a punch list of ambiguities — in 30 seconds, for $20/month."*

---

## D3 — BYOK vs managed key

**Managed key only.** No BYOK option in the UI.

We pay Anthropic, charge users a flat tier price with included extractions, and pocket the margin. This is the standard SaaS resale shape and is the only way the "credit limit + upgrade when exhausted" UX makes sense (can't run out of credits if the user is paying Anthropic directly).

**Operational implications:**
- Need an Anthropic account on a high-rate-limit tier. Anthropic API Tier 4 ($1 000/mo prepaid deposit, 4 000 RPM, 400k TPM) is appropriate once we cross ~50 paid users. Below that, Tier 3 or Tier 2 is fine.
- Anthropic outages = our outages = revenue loss but fixed costs continue. Acceptable risk at this scale.
- Code path: existing `services/byok.resolve_user_byok()` already falls through to env `ANTHROPIC_API_KEY` when no header/stored key. M3.5 will remove the header + UserSettings paths and rely on env exclusively. Settings page BYOK form goes away.

**Carve-out:** "Enterprise" tier (post-launch) may bring back BYOK as an opt-in for orgs with strict data-residency or unlimited-usage needs. Out of scope for v1.

---

## D4 — Free tier shape

**14-day Starter trial, no credit card required, capped at 10 extractions over the trial period.**

No "free forever" tier.

**Why no card?** Lower signup friction; relies on conversion from genuine value rather than dark-pattern auto-billing.

**Why 10 extractions, not the full 25?** Industry conversion rate is 5–15%; at 25 extractions/trial we'd burn $5/trial → $35–100 acquisition cost per paid user. At 10 extractions/trial we burn $2/trial → $14–40 CAC. 5 BRDs/week is still plenty to evaluate the product.

**Doc size cap during trial:** 50 000 tokens (~25 pages) — same as Starter. Bounds worst-case cost.

---

## D5 — Pricing

| Tier | Price/seat/mo | Annual (20% off) | Extractions/mo | Models | Doc size | Workspace |
|---|---|---|---|---|---|---|
| **Trial** (14d, no card) | $0 | — | 10 (total, not /mo) | Sonnet | 50k tok | Personal only |
| **Starter** | **$20** | $192/yr ($16/mo) | 25 | Sonnet only | 50k tok (~25pg) | Personal only |
| **Pro** | **$49** | $470/yr ($39/mo) | 100 | Sonnet + Opus | 100k tok (~50pg) | Personal + workspace member |
| **Team** | **$99** | $950/yr ($79/mo) | 300 | All models | 200k tok | **Workspace owner** + admin features |

**Hard caps, not overage charges.** Hitting the limit shows a paywall modal: *"Upgrade to Pro for 80 extractions/mo"* — not "$0.50 per additional extraction." Users hate surprise bills more than they hate seeing upgrade prompts.

**Why these levers?**
- *Model choice* (Sonnet vs Opus) is a 5x cost spread — gating Opus to Pro+ keeps Starter margins safe.
- *Doc size cap* bounds worst-case Anthropic spend per extraction.
- *Workspace* is the natural upsell — Team's true value is multi-user collaboration, not extraction volume.

---

## Cost-per-extraction (all-in)

Source: M3.0 UsageLog data + service price sheets, 2026-04-25.

| Cost component | Per extraction | Notes |
|---|---|---|
| **Anthropic Sonnet** (avg ~15-page BRD: 50k in / 5k out) | **$0.21** | Dominant cost. Doc-size cap per tier is the lever. |
| **R2 storage** (1 MB doc) | $0.00002 | Negligible until 10 GB / 10k docs. |
| **Postgres** (Supabase Pro $25/mo / 2 500 ext/mo) | $0.010 | Free tier 500 MB lasts ~6 months at 100 users. |
| **Render** (Starter $7/mo / 2 500 ext/mo) | $0.003 | Free tier sleeps; upgrade once paid customers arrive. |
| **Clerk** (free tier 10 000 MAU) | $0.00 | Until ~10k MAU then $25/mo. |
| **Resend** (welcome only, 1/user not 1/extraction) | ~$0.00 | Free 3 000/mo covers ~3k signups. |
| **Stripe fees** (~2.9% + $0.30 on $20 / 25 ext) | **$0.035** | Real and sneaky. |
| **Domain** ($12/yr ÷ ~30k ext/yr at scale) | $0.0004 | Pocket change. |

**Bottom line:**
- **Early stage** (<50 users, ~$60/mo fixed infra): **~$0.45/extraction** — infra dominates because amortization is bad
- **Modest scale** (100+ users): **~$0.26/extraction** — Anthropic dominates (~95%)
- **Scale** (1k+ users): **~$0.22/extraction** — fixed costs become trivial

---

## Per-tier margins at modest scale

Computed at "average user uses 50% of cap" (typical SaaS assumption — most users don't max out). Worst case shown for sanity.

| Tier | Revenue/seat | Avg usage cost | Avg margin | Worst-case cost (at limit) | Worst-case margin |
|---|---|---|---|---|---|
| Trial | $0 | $1 (5 ext used) | -$1 (CAC) | $2 (10 ext) | -$2 |
| Starter | $20 | $3 (12 ext × $0.26) | **+$17** (85%) | $7 (25 ext) | +$13 (65%) |
| Pro | $49 | $13 (50 ext × $0.26) | **+$36** (73%) | $30 (100 ext × ~$0.30, mixed Opus) | +$19 (39%) |
| Team | $99 | $39 (150 ext × $0.26) | **+$60** (61%) | $120 (300 ext × $0.40, all Opus) | -$21 (-21%) |

Team's worst-case is negative — heavy Opus users on giant docs can lose money. Mitigations baked in:
1. Doc-size cap (200k tok, ~100 pages)
2. Hard extraction cap at 300/mo
3. Default model = Sonnet; Opus is opt-in per extraction
4. Most Team users will be 30–60% of cap, well into positive margin

---

## Implementation notes for M3.5 + M3.6

**M3.5 — limit enforcement:**
- New column: `user_settings.plan` (`trial` / `starter` / `pro` / `team`); soft migration. Default `trial` for new users.
- New column: `user_settings.trial_ends_at` (timestamp; null after conversion).
- Pre-extract gate: count `usage_log` rows since first-of-month for the user, compare to tier cap. Hard 429 + JSON `{paywall: true, upgrade_to: "pro"}` if exceeded.
- Pre-extract gate (doc size): reject if `len(raw_text)` (or token estimate) > tier cap. 413 with same paywall structure.
- Pre-extract gate (model): reject if requested model not allowed by tier. 403.
- Frontend: paywall modal triggered by `paywall: true` in any extract response, shows the upgrade tier + price.

**M3.6 — Stripe scaffold:**
- Stripe products: 4 tiers × 2 billing intervals = 8 SKUs. Or 3 (Starter/Pro/Team) × 2 = 6 since Trial isn't billed. Plus annual = 6 SKUs total.
- Webhook on `customer.subscription.updated`/`deleted` updates `user_settings.plan`.
- Customer portal link from Account page replaces M3.8.2 stub.
- Trial-to-paid: when trial expires, plan reverts to a `expired` state that shows a paywall on every extract attempt. No auto-charge (no card on file).

**Schema migration approach:** still soft-ALTER for now. Bring in Alembic when we have a non-additive change (e.g. dropping the BYOK column post-cleanup).

---

## What's *not* decided yet (for future doc updates)

- Custom domain (M3.10.4) — when ready, pick `.com` or `.app` or similar
- Enterprise tier shape — BYOK opt-in, SSO, custom contracts. Defer until inbound demand.
- Marketing site / landing page — separate from the app, probably static HTML somewhere
- Referral / affiliate program — defer
- Sentry / observability cost (currently $0; might need $26/mo Sentry Team once we have load)

---

*Updated 2026-04-25 — Decisions D1–D5 locked, M3.5 + M3.6 implementation can begin.*
