# 0018 — Inbound email: token in the local part, authoritative threading

**Status:** accepted · **Code:** `worker/`, `apps/api-gateway/src/modules/inbound-email/`, `organizations.inbound_token`

## Decision

The tenant is identified by a token in the address **local part**, so the Worker uses a catch-all rule rather than per-address routing. Threading is authoritative, never best-effort.

## Why

- **Getting threading wrong attaches a customer's message to someone else's thread.** That is a disclosure, so the mechanism cannot be heuristic.
- The fallback storage already exists in a service neither obvious nor free to reach: `notification_deliveries.provider_message_id` is populated from nodemailer's `messageId` and indexed, and the notification carries the ticket it was about — a two-hop join.

## Consequences

- **An unrecognised sender domain is a drop, not a signup.** Self-signup can afford to create an organization and make the sender its founding Org Admin because a human deliberately registered; an inbound email is not that, and treating it as such hands a tenant to whoever emailed.
- **The right answer is a contact model** — a person who can have tickets without an account. `tickets.author_id` is `NOT NULL`, so that is a schema change and a permission model of its own: genuinely correct, genuinely out of scope, recorded so the constraint is visible.
- **No attachments via inbound email.**
- The webhook is HMAC-signed; `INBOUND_SECRET` in the Worker must match the gateway's `INBOUND_EMAIL_SECRET`.
- The Worker is outside turbo's build and lint by design; its only automated check is the fixture contract test.
