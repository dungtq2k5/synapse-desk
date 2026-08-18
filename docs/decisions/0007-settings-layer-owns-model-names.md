# 0007 — A model name may appear in exactly one place

**Status:** accepted · **Code:** `libs/common/src/configs/ai-settings.config.ts`, `apps/rag-service/rag_service/settings.py`, enforced by `scripts/check-model-literals.mjs`

## Decision

Every AI parameter — including the model name — is read through `settingsFor(orgId)`. No model literal in a service, a prompt builder, a test fixture, or a config read at a call site.

## Why

- **The failure is quiet and expensive.** A single model name typed into a summarizer is a tenant on the premium tier silently receiving the cheap model. Nothing errors; the answer is merely worse, for the customer paying more.
- **Retrofitting means auditing every LLM invocation across two services in two languages.** Doing it while writing the call sites costs about an hour of discipline.

## Consequences

- Adding per-tenant overrides is a **data change, not a refactor**, and no endpoint signature moves — none of them take a model name today and none would then.
- `scripts/check-model-literals.mjs` makes the rule mechanical rather than aspirational; the settings and pricing configs are its allowlist.
- The TS and Python values are mirrored, held honest by `ai-settings.contract.json`.
- **Cache invalidation is the one way this goes wrong.** `settingsFor()` is cached per tenant and invalidated on `billing.entitlements_changed`. Without it a downgraded tenant keeps the premium model for the cache TTL — giving away the thing you just stopped being paid for, in the direction that costs money rather than the one someone complains about.
