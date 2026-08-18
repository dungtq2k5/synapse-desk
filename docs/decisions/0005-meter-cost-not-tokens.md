# 0005 — Meter `estimated_cost_micros`, never raw tokens

**Status:** accepted · **Code:** `ai_generations`, `libs/common/src/configs/ai-pricing.config.ts`

## Decision

Every AI generation is ledgered in cost micros. Quota, budget caps and analytics all read cost, never token counts.

## Why

- **Cost per token varies by an order of magnitude across model tiers.** Under token budgeting, a tenant switching to a premium model consumes the same token count for several times the money — the quota stops protecting margin and starts protecting a number that no longer means anything.
- **Retrofitting is a re-derivation of history.** Adding a premium tier under token budgeting means recomputing every historical figure and redefining what the budget column meant.

## Consequences

- Model choice is safe to expose to tenants. Under token metering it would not have been — this is the single decision that made [0007](./0007-settings-layer-owns-model-names.md) additive rather than a rewrite.
- The pricing table is keyed **by** model rather than choosing one, which is why it is a legitimate second home for model names.
- `assertWithinBudget` reads Redis, never `SUM(estimated_cost_micros)`. The SQL sum is the *definition* of spend and a growing scan on the hot path. Key includes the billing cycle start, so a reset invalidates it for free.
