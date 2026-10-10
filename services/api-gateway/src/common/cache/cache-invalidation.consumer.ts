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
 * Cache eviction driven by domain events.
 *
 * This is the mechanism; `@InvalidateCache` is the fast path. A decorator only
 * sees writes that went through this gateway, and a ticket changes in ways that
 * did not — a `message:send` over the WebSocket, escalation side effects inside
 * `ticket-service`, a scheduled job, another service writing its own path.
 *
 * Redis is shared, so cross-INSTANCE invalidation is already free. What this
 * solves is **origin fan-out**: a change the gateway never saw.
 *
 * **Every handler is fire-and-forget and must never throw.** A failed
 * invalidation costs one stale entry until its TTL; an unhandled rejection in a
 * NATS handler takes the process down.
 *
 * **There is deliberately no `user.*` subscription.** Every writer of a user's
 * name or avatar is a gateway mutation, so the decorator is precise
 * invalidation there rather than a fallback. Departments are the same shape.
 * That answer changes the day a non-gateway writer appears — a SCIM sync, a
 * directory import — and this class is where the subscription would go.
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
    // that change what a `GET /documents` row says gives that list
    // a 60s TTL precisely because status moves asynchronously.
    this.drop(CACHE_SCOPES.documents, event);
  }

  /**
   * A plan change, and the precedent for all of this.
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
