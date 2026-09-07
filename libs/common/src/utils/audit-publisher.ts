import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_PATTERNS,
  AuditAction,
  AuditResourceType,
  RecordAuditCommand,
} from '../contracts/audit.contract';
import { CallerContext } from '../configs/identity.config';
import { JetStreamPublisher } from '../jetstream/jetstream.module';

/** Everything about an event except who did it and where from. */
export type AuditEvent = {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Overrides the actor's own tenant. Needed only for platform acts, which
   * record `null` even though the acting Super Admin touched a real customer.
   */
  organizationId?: string | null;
};

/**
 * Fire-and-forget publisher for the audit trail.
 *
 * Non-throwing for the same reason NotificationPublisher is: recording that a
 * department was deleted is a consequence of deleting it, not a precondition.
 * A broker outage must not roll back the write the user asked for.
 *
 * That is a deliberate trade — it means the trail can have holes when NATS is
 * down. The alternative is writing audit rows inside the business transaction,
 * which makes them exact but couples every write in the system to the audit
 * store's availability. If a regulator ever requires the stronger guarantee,
 * this is the class to change, and the call sites stay as they are.
 */
@Injectable()
export class AuditPublisher {
  private readonly logger = new Logger(AuditPublisher.name);

  /**
   * TEMPORARY local sink: mirrors every event to the log until `ticket-service`
   * owns `audit_logs` and subscribes.
   *
   * `ticket-service`'s `AuditConsumer` now owns `audit_logs` and subscribes, so
   * this is no longer the only sink. It stays because a mirrored line is cheap
   * and the trail is at-most-once — but it defaults ON, which is worth turning
   * off per service via AUDIT_LOG_TO_CONSOLE now that the rows are durable.
   */
  private readonly logToConsole: boolean;

  constructor(
    private readonly jetstream: JetStreamPublisher,
    configService: ConfigService,
  ) {
    this.logToConsole = configService.get<boolean>(
      'AUDIT_LOG_TO_CONSOLE',
      true,
    );
  }

  /**
   * An act with **no actor** — a scheduled sweep, not a person.
   *
   * `RecordAuditCommand.userId` is already documented as *"null for system and
   * cron actors, which have no user row acting for them"*; this is the first
   * caller to need it. Attributing an automatic unlock to the system USER row
   * would be worse than null: that account exists to satisfy
   * `roles.created_by_id`, and a reader seeing it in an audit trail would
   * reasonably conclude somebody signed in as it.
   *
   * The origin is the SERVICE rather than an IP, for the same reason: there was
   * no request, and a fabricated `127.0.0.1` reads as one.
   */
  recordSystem(
    event: AuditEvent & {
      organizationId: string | null;
      /**
       * Who scheduled this, e.g. `auth-service/scheduler`.
       *
       * REQUIRED, and deliberately without a default: the correct value names
       * a service this class cannot see, so any default it could offer would be
       * wrong for somebody — silently, since nothing about an audit row's
       * origin fails loudly.
       */
      origin: string;
    },
  ): void {
    this.publish({
      action: event.action,
      organizationId: event.organizationId,
      userId: null,
      // No request, so no IP. A fabricated `127.0.0.1` would read as one.
      origin: { ip: 'system', userAgent: event.origin },
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      metadata: event.metadata,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
    });
  }

  /**
   * Derives actor, tenant and origin from the verified caller context, so a
   * call site cannot record the wrong actor by passing the wrong id.
   */
  record(context: CallerContext, event: AuditEvent): void {
    const command: RecordAuditCommand = {
      action: event.action,
      // `!== undefined` rather than `??`: null is a MEANINGFUL override here
      // (platform acts record no tenant), and `??` would discard it in favour
      // of the actor's own organization.
      //
      // **`??` produces the same value, and the reason is enforced.** Platform
      // acts pass `null` and are performed by super admins, whose own
      // `organizationId` is also `null`, so the two forms agree — on an
      // invariant the database holds: `users_super_admin_iff_no_tenant`,
      // `(organization_id IS NULL) = is_super_admin`, applied by auth-service's
      // seeder DDL block (ADR 0039).
      //
      // The distinction still earns its keep, because the invariant constrains
      // WHO can perform a platform act and not what this expression means. The
      // day a platform act becomes performable by someone with a tenant — a
      // support engineer acting cross-tenant, say — `??` would stamp their own
      // organization on a platform audit row and the row would look right.
      // `!== undefined` records the null the caller asked for either way.
      organizationId:
        event.organizationId !== undefined // NOSONAR — see above; `??` is not equivalent here
          ? event.organizationId
          : context.organizationId,
      userId: context.sub,
      origin: { ip: context.ip, userAgent: context.userAgent },
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      metadata: event.metadata,
      // Minted at the PUBLISHER, like `occurredAt` and for the same reason: it
      // identifies this act, so a retry of the whole request is a new act and a
      // redelivery of this message is not.
      eventId: randomUUID(),
      // Stamped here, not by the consumer: a consumer restart must not backdate
      // a backlog of events to the moment it caught up.
      occurredAt: new Date().toISOString(),
    };

    this.publish(command);
  }

  /** The shared tail: mirror to the log, then emit. */
  private publish(command: RecordAuditCommand): void {
    if (this.logToConsole) {
      // Serialized as one field so it survives a JSON log pipeline intact and
      // cannot collide with the logger's own keys.
      this.logger.log(JSON.stringify(command));
    }

    // Durable since ADR 0041. `eventId` is the `Nats-Msg-Id`, so the stream
    // collapses a repeated PUBLISH of one act; the consumer's unique index
    // absorbs a repeated DELIVERY. Two mechanisms, two failures.
    this.jetstream.publish(AUDIT_PATTERNS.record, command, command.eventId);
  }
}
