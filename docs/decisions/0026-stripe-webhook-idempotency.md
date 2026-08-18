# 0026 — Stripe webhook idempotency is a UNIQUE constraint, not a check

**Status:** accepted · **Code:** `billing_events.stripe_event_id`

## Decision

`stripe_event_id` is UNIQUE. The webhook bypasses the global auth and body-parsing pipeline deliberately, and verifies the signature against the **raw** body.

## Why

- **Stripe retries on any non-2xx, including a timeout on a request that actually succeeded.** Without the constraint a retry applies the entitlement write twice — harmless for an idempotent `UPDATE`, and *not* harmless for anything that ever becomes incremental, like a credit top-up.
- Signature verification needs bytes, not a parsed object: any body parser ahead of it breaks the check.

## Consequences

- The Customer Portal replaces UI you would otherwise build — card updates, plan changes, cancellation. That is most of the reason to use Stripe rather than a raw payment processor.
- The entitlement write emits `billing.entitlements_changed`, which is what invalidates the cached AI settings — see [0007](./0007-settings-layer-owns-model-names.md).
