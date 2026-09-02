/**
 * @file Outbound webhooks — the payload contract and the signing scheme.
 *
 * **The payload is an EVENT, never the notification.** `title` and `body` are
 * product copy: written for a person, in one language, changed whenever
 * somebody improves a sentence. Putting them in an integration payload makes
 * every copy edit a breaking API change for every customer parsing it — and
 * they will parse it, because it would be the only human-readable field. This
 * contract is versioned independently of the notification copy.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  NotificationResourceType,
  NotificationType,
} from './notification.contract';

/**
 * What a tenant's endpoint receives — the whole body, serialized ONCE.
 *
 * `type` is the {@link NotificationType} vocabulary, **never the NATS
 * subject**. The two are close enough to confuse — `ticket.assigned` is both —
 * and they are not the same set: the subjects include internal ones no
 * customer should learn about, and they change when we re-plumb. Publishing
 * subjects would make our transport topology part of a public contract.
 */
export type WebhookEventPayload = {
  /**
   * Fixed at ENQUEUE and stored on the delivery row, so every retry of the
   * same event carries the same id. That stability — not any derivation — is
   * what the receiver's deduplication depends on: our queue retrying a POST
   * five times must send one id five times.
   */
  id: string;
  type: NotificationType;
  /** ISO-8601, when the event occurred — not when this attempt was made. */
  occurredAt: string;
  organizationId: string;
  resourceType: NotificationResourceType | null;
  resourceId: string | null;
  /** Typed per event type; today the producer's `data` bag, passed through. */
  data: Record<string, unknown>;
};

/** The BullMQ queue delivery attempts ride. Hyphen, not colon — BullMQ's own
 * key delimiter, the same rule `SCHEDULER_QUEUE` records. */
export const WEBHOOK_QUEUE = 'webhook-deliveries';

/** The header carrying {@link signWebhook}'s output. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-synapsedesk-signature';

/**
 * `t=<unix seconds>,v1=<hex hmac-sha256 of "{t}.{rawBody}">`
 *
 * **The timestamp is inside the signed material**, so a replay is bounded by
 * whatever window the receiver enforces — outside the signature it would be a
 * header an attacker edits freely. During secret rotation the header carries
 * TWO `v1=` entries, old secret second, so a customer can roll without
 * dropping events.
 *
 * Mirrors the discipline `StripeService.constructEvent` verifies with, from
 * the producing side: sign the exact bytes that are sent. A body stringified
 * twice — once for the signature, once for the request — re-serializes with
 * different key order and fails verification forever.
 */
export function signWebhook(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
}

/**
 * The check the customer docs describe — here so the docs' worked example is
 * asserted against the real signer rather than kept true by proofreading.
 *
 * Constant-time, which is the mistake the receiving code will otherwise make.
 */
export function verifyWebhookSignature(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
  signatureHex: string,
): boolean {
  const expected = Buffer.from(
    signWebhook(secret, timestampSeconds, rawBody),
    'hex',
  );
  const actual = Buffer.from(signatureHex, 'hex');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * A delivery attempt's terminal-or-not state — persisted on
 * `webhook_deliveries.status`, so it is an enum (§7.3: a persisted domain
 * value gets one) with a proto twin and a bridge.
 */
export enum WebhookDeliveryStatus {
  /** Queued, or between retries. */
  PENDING = 'PENDING',
  /** The receiver answered 2xx. */
  DELIVERED = 'DELIVERED',
  /** Every attempt exhausted; the receiver never accepted it. */
  FAILED = 'FAILED',
}

// ---------------------------------------------------------------- Operation

/**
 * Attempts before an endpoint's delivery is abandoned, exponential backoff
 * between them. Five spans roughly half an hour, which covers a deploy at the
 * receiver's end without covering an abandoned one.
 */
export const WEBHOOK_MAX_ATTEMPTS = 5;

/** First retry delay; doubles per attempt (the `defaultJobOptions` pattern). */
export const WEBHOOK_BACKOFF_MS = 30_000;

/**
 * Consecutive FAILED deliveries after which the endpoint is auto-disabled.
 *
 * The part that makes the feature safe to operate: a dead endpoint with no
 * disable costs one POST per event forever, per tenant, and the load scales
 * with how successful the product is. The disable writes WHY, and tells the
 * tenant at HIGH priority — an endpoint that silently stops is worse than one
 * that noisily does.
 */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 10;

/**
 * How long delivery rows are kept.
 *
 * `webhook_deliveries` is one row per event per endpoint — a tenant with three
 * endpoints and a busy queue writes three rows per ticket assignment, forever,
 * and nothing else prunes it. Thirty days is long enough to debug an
 * integration and is the conventional answer.
 */
export const WEBHOOK_RETENTION_DAYS = 30;

/** Receiver must answer within this, or the attempt fails. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Bytes of response read before the socket is destroyed.
 *
 * The body is not wanted at all — only the status — but a hard zero would
 * close before some receivers finish writing headers. A small cap bounds a
 * receiver that streams forever at a worker we get back.
 */
export const WEBHOOK_MAX_RESPONSE_BYTES = 16_384;

/**
 * How long a rotated-out secret keeps verifying.
 *
 * Rotation without an overlap is an outage the customer schedules: the moment
 * the secret changes, every in-flight and queued delivery signs with a key the
 * receiver no longer has. Both signatures are sent during the window.
 */
export const WEBHOOK_ROTATION_OVERLAP_HOURS = 24;

/** Endpoints per tenant. A cap, not a plan dimension — abuse, not billing. */
export const MAX_WEBHOOK_ENDPOINTS = 10;

/** The URL column's width (`VarChar(2000)`) and the DTO's bound, one number. */
export const MAX_WEBHOOK_URL_LENGTH = 2_000;

/** The description's bound. Webhook-owned — NOT one of the 500-character audit
 * reasons (`MAX_ADMIN_REASON_LENGTH`, `MAX_LOCK_REASON_LENGTH`), which happen
 * to share the value and mean something else.
 */
export const MAX_WEBHOOK_DESCRIPTION_LENGTH = 500;

/**
 * The deliveries listing's page bound and REST default.
 *
 * One object, because the two numbers move together — and it lives HERE
 * rather than in the gateway's `dto.config.ts` because `MAX` is enforced on
 * BOTH sides of the wire: the gateway's query DTO and the notification
 * service's own clamp. Split across the boundary they drift; imported from
 * one place they cannot.
 */
export const WEBHOOK_DELIVERY_LIMIT = { DEFAULT: 50, MAX: 100 } as const;
