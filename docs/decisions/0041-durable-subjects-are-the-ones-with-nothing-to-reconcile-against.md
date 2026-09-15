# 0041 — Durable subjects are the ones with nothing to reconcile against

**Status:** accepted · **Code:** `libs/common/src/configs/jetstream.config.ts`, `libs/common/src/utils/jetstream-bootstrap.ts`, `audit.consumer.ts`, `notifications.controller.ts`

## Decision

Four subjects move to JetStream with durable pull consumers, explicit acks, `MaxDeliver` and a DLQ republish:

| Stream | Subjects | Consumer |
| :--- | :--- | :--- |
| `AUDIT` | `audit.record` | ticket-service |
| `NOTIFICATIONS` | `notification.>` | notification-service |

Everything else stays on core NATS at-most-once. The core transport is untouched and still serves `ticket.*`, `document.*` and `storage.object.superseded`.

## Why

**Prefer reconciliation where the state exists; use redelivery where it does not.**

That is the whole rule, and `document.*` is what makes it concrete. It was the highest-severity delivery gap in the system, and the reconcile sweep closed it without touching the transport — a lost `document.uploaded` is reconciled within ten minutes from the row the document already has. Redelivery would have bought the same guarantee at a much higher price.

`audit.record` and `notification.*` do not qualify for that treatment, because there is no row to sweep for. Nothing else in the system knows an email should have been sent; a lost `audit.record` leaves no trace of the act that a sweep could notice was missing. Absence is indistinguishable from "never happened", which is exactly the property an audit trail is bought to deny.

The subjects staying on core each have a specific reason, not an absence of one:

| Subject | Why at-most-once is right |
| :--- | :--- |
| `ticket.*` | The only consumer is the WS relay. A lost broadcast is a client that reconnects and re-reads — the state is in Postgres and the event is a hint |
| `document.*` | The `ingestion-reconcile` sweep reconciles from state, within ten minutes |
| `storage.object.superseded` | A lost message orphans an object. Costs storage, not correctness |

## Consequences

- **At-least-once converts "lost" into "possibly twice", and that is a real cost, not a free upgrade.** A durable subject in front of a consumer that cannot absorb a duplicate is a *downgrade*: at-most-once loses an audit row occasionally, at-least-once double-counts one, and "how many times did X happen" is the question the trail exists to answer. Every subject promoted here had to earn it with a duplicate story, and the three answers differ.
- **`audit.record` needed an id it did not have.** `RecordAuditCommand.eventId` is minted with `randomUUID()` at the publisher and is `@unique` on `audit_logs`; a redelivery hits the index and the consumer treats the violation as success. Generated rather than content-hashed, because the same admin locking the same user twice in one second is two events and a hash would record one. Deliberately not a read-then-write: two racing deliveries would both read "absent".
- **`notification.in_app.create` was already safe**, by `@@unique([notificationId, channel])` on `NotificationDelivery` — which is why it needed no new column.
- **`notification.email.send` and `.sms.send` ship at-least-once with no dedupe, deliberately.** They are the transactional paths and have no `notifications` row to key on. The trade is lopsided: a password reset that never arrives locks a user out with no recovery path, while one that arrives twice carries the same token and is a nuisance. If a specific template cannot tolerate a duplicate, the cheap answer is a Redis `SET NX` on the command id at the top of the handler, not a table — `InboundAutoReply` is the precedent for adding a record only where the template demands it.
- **Publish dedupe and consumer idempotency are different mechanisms for different failures.** `Nats-Msg-Id` inside `duplicate_window` collapses two *publishes* of one act; the unique index absorbs two *deliveries* of one message. Neither substitutes for the other, and a test of one does not cover the other.
- **These four subjects bypass `@nestjs/microservices`.** Its NATS transport is core-only — a `@EventPattern` handler never receives a JetStream message, which is why the standing TODO asking for an explicit `nak()` could not be done where it was written: there is no message object there to nak. The alternative was owning a custom `Server` transport strategy and its ack semantics forever, to preserve a decorator whose routing, for four subjects, is a `switch`.
- **Two streams rather than one**, because retention and volume differ by an order of magnitude and one stream makes them share limits. A burst of notifications must not age out audit records. `WorkQueue` retention because each subject has exactly one consumer, which is what that mode requires and what makes "delivered and acked" mean "done".
- **Pull, not push.** A push consumer delivers at the stream's pace, and a slow SMTP call becomes back-pressure the consumer has no way to express.
- **A poison message is terminated, and terminated messages go somewhere.** JetStream has no built-in dead-letter, so `MaxDeliver` is followed by a republish to a `.dlq` subject before `term()`. This is the ingestion-jobs work and the reconcile sweep arriving from a third direction: a deterministic failure retried forever blocks everything behind it. `MaxDeliver` is the JetStream spelling of the `try`/`catch` the sweep already carries.
- **A full retry cycle must fit inside `duplicate_window`**, or a message can outlive the window that would recognise it. The first statement of this rule was `AckWait × MaxDeliver`, which described a mechanism the code did not use: with an explicit `nak()` the redeliveries are immediate and the cycle is ~0s. The real pacing is `RETRY_BACKOFF_MS`, and the arithmetic is now asserted in `jetstream.config.spec.ts` rather than written in a comment.
- **Redelivery is paced by two mechanisms, for two failures.** `nak(ms)` paces a handler that failed and said so; the consumer's `backoff[]` paces one that died without answering. Measured, because the difference is invisible otherwise: `backoff` is accepted into the config and reported by `nats consumer info` while doing nothing to an explicit nak. Configuring only one leaves the other unpaced.
- **Every `backoff` entry replaces `ack_wait` for its attempt**, so none may be shorter than a handler's slowest legitimate run — a 5s entry redelivers a healthy 20s SMTP send, and that duplicate is a second real email.
- **Three outcomes, not two.** A transient failure is nak'd, a malformed payload is dropped and acked, and one that is unrecoverable *but worth keeping* is parked immediately via `UnprocessableMessage` — no retries, because no redelivery adds a field that was never sent. Retrying a deterministic failure is the poison loop `MaxDeliver` exists to bound, entered on purpose.
- **The broker needs `-sd /data`.** JetStream defaults its store to `/tmp`, inside the container's writable layer, so a durable subject on a misconfigured broker is *worse* than a core one: core loses the message visibly, JetStream acks the publisher first and loses it silently on the next `compose up`. `assertDurableStore` refuses to boot against such a broker, and both services call it before declaring a stream.
- **Five docblocks argued from at-most-once and stay correct** — `ticket-event.publisher.ts`, `document-flags.service.ts`, and the handlers that named JetStream as the upgrade. What changed is that the premise now holds for four subjects and not the others, and the asymmetry is arbitrary-looking enough to be worth one place rather than being rediscovered per docblock.
- **The choice of a `ticket_status_changes` table over consuming `ticket.status_changed` ([ADR 0040](./0040-ticket-status-history-is-a-table-not-a-trail.md)) survives unchanged.** `ticket.*` is still at-most-once, so its reasoning still holds — and the permission boundary settled it independently anyway.
