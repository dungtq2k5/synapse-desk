import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  BILLING_PATTERNS,
  DOCUMENT_PATTERNS,
  TICKET_PATTERNS,
  formatErrorMsg,
} from '@synapsedesk/common';
import { CacheService } from './cache.service';
import { CACHE_SCOPES } from '../config/cache.config';

/**
 * Cache eviction driven by domain events — 29-doc §4.2.
 *
 * **This is the mechanism; `@InvalidateCache` is the fast path.** A decorator on
 * a gateway route sees writes that went through this gateway, and a ticket
 * changes in at least four ways that did not (28-doc §3): a `message:send` over
 * the WebSocket, the escalation side effects inside `ticket-service`, a
 * scheduled job, and another service writing through its own path. Shipping the
 * decorator alone would look complete and be silently partial — which is why
 * 29-doc §5 insists the two land together.
 *
 * > Redis is shared, so cross-INSTANCE invalidation is already free: a `del`
 * > from any gateway pod is global. What this solves is **origin fan-out** — a
 * > change the gateway never saw.
 *
 * **Every handler is fire-and-forget and must never throw.** A failed
 * invalidation costs one stale entry until its TTL; an unhandled rejection in a
 * NATS handler takes the process down. That is the same rule
 * `ticket-events.consumer.ts` already applies to relaying, and the reason both
 * of them wrap the body rather than trusting it.
 *
 * ---
 *
 * **On what is NOT here.** 29-doc's table listed `user.*` events, and there are
 * none — auth-service publishes audit records, billing entitlements,
 * notifications and storage supersessions, and nothing about users. That is not
 * a gap to fill: every writer of a user's name or avatar is a gateway mutation
 * (`updateOwnProfile`, `updateUser`, `confirmAvatarUpload`, `deleteAvatar`), so
 * the decorator IS precise invalidation there rather than a fallback, and
 * publishing a `user.*` contract now would mean a contract with no publisher.
 * Departments are the same shape: `PATCH /departments/:id` is the only writer.
 *
 * **What changes that answer** is a non-gateway writer of `fullName` or
 * `avatarUrl` — a SCIM sync, a directory import, an admin tool talking to
 * auth-service directly. On the day one appears, the users and departments
 * scopes need the contract, and this class is where the subscription goes.
 */
@Controller()
export class CacheInvalidationConsumer {
  private readonly logger = new Logger(CacheInvalidationConsumer.name);

  constructor(private readonly cache: CacheService) {}

  /**
   * Anything that happened to a ticket drops the tenant's ticket lists.
   *
   * **One handler for every ticket pattern**, because the cache does not care
   * which: a create, a status change and a redaction all make the same cached
   * list wrong, and nine handlers doing one thing is nine places for the tenth
   * pattern to be forgotten.
   *
   * **An ARRAY, not stacked decorators**, and the difference is invisible until
   * production. `@EventPattern` writes its metadata with
   * `Reflect.defineMetadata(PATTERN_METADATA, [].concat(metadata))` — it
   * OVERWRITES. Nine stacked decorators therefore subscribe to exactly one
   * pattern, chosen by decorator application order, and the other eight events
   * arrive to nobody with nothing logged. The array form is what
   * `listeners-controller` iterates.
   *
   * `Object.values` rather than a written-out list: the point of one handler is
   * that a tenth pattern needs no edit here, and re-listing them would put the
   * edit back.
   */
  @EventPattern(Object.values(TICKET_PATTERNS))
  ticketChanged(@Payload() event: unknown): void {
    this.drop(CACHE_SCOPES.tickets, event);
  }

  @EventPattern([
    DOCUMENT_PATTERNS.indexed,
    DOCUMENT_PATTERNS.ingestionFailed,
    DOCUMENT_PATTERNS.scopeChanged,
  ])
  documentChanged(@Payload() event: unknown): void {
    // `document.uploaded` is deliberately absent: it is the WORKER's trigger
    // and nothing is readable yet. `indexed` and `ingestion_failed` are the two
    // that change what a `GET /documents` row says — 29-doc §3 gives that list
    // a 60s TTL precisely because status moves asynchronously.
    this.drop(CACHE_SCOPES.documents, event);
  }

  /**
   * A plan change — 15-doc §1.3, and the precedent for all of this.
   *
   * *"A stale settings cache keeps a downgraded tenant on the premium model"* —
   * this pattern, built once already, for the case where getting it wrong costs
   * money.
   */
  @EventPattern(BILLING_PATTERNS.entitlementsChanged)
  entitlementsChanged(@Payload() event: unknown): void {
    this.drop(CACHE_SCOPES.settings, event);
    this.drop(CACHE_SCOPES.organizations, event);
  }

  /**
   * Drops a scope for the event's tenant, and never lets anything escape.
   *
   * **Not `await`ed, and it is a `void` handler on purpose.** A NATS event
   * handler has no caller to report to; returning a promise only gives the
   * framework something to reject. The floating promise is closed by the
   * `.catch()` rather than left to the process.
   */
  private drop(scope: string, event: unknown): void {
    const organizationId = organizationIdOf(event);

    if (!organizationId) {
      // Not thrown: an event with no tenant is a producer-side bug, and the
      // right response is a log somebody can find — not a dead gateway.
      this.logger.warn(`Cache event for scope ${scope} carried no tenant`);

      return;
    }

    this.cache
      .invalidateScope(organizationId, scope)
      .then((removed) =>
        removed > 0
          ? this.logger.debug(
              `Dropped ${removed} ${scope} entries for ${organizationId}`,
            )
          : undefined,
      )
      .catch((error: unknown) =>
        this.logger.error(
          `Cache invalidation failed for ${scope}: ${formatErrorMsg(error)}`,
        ),
      );
  }
}

/**
 * The tenant on a domain event.
 *
 * Read structurally rather than through each contract's type, because this
 * consumer subscribes across three domains and the ONE field it needs is the
 * one all of them carry. Typing each handler to its own union would be nine
 * signatures agreeing about `organizationId`.
 *
 * A payload that arrives as `undefined` lands here too, which is worth knowing:
 * Nest's NATS deserializer treats a payload carrying `pattern` as an envelope
 * and extracts its absent `.data`, so a raw publish of a domain event delivers
 * nothing at all. That produces the warning above rather than a crash.
 */
function organizationIdOf(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null;

  const value = (event as Record<string, unknown>).organizationId;

  return typeof value === 'string' && value.length > 0 ? value : null;
}
