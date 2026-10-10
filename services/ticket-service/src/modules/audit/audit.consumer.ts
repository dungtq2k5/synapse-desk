import { Injectable, Logger } from '@nestjs/common';
import {
  formatErrorMsg,
  isUniqueConstraintViolation,
  RecordAuditCommand,
  UnprocessableMessage,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

/** The unique that makes a redelivered audit event a no-op. */
const AUDIT_EVENT_ID_INDEX = 'audit_logs_event_id_key';

/**
 * The consumer Domain A has been publishing into since it was built.
 *
 * `AuditPublisher` has emitted to `audit.record` from day one, with nothing
 * subscribed and a console log as the documented stopgap. This ends that: the
 * events now land in `audit_logs`, which `ticket-service` owns per the
 * ownership map even though every producer so far is auth-service.
 *
 * **At-least-once over JetStream** since ADR 0041, which is why `eventId` and
 * the unique index below exist: the stream will deliver the same message twice
 * and an audit trail that counted it twice would inflate the one question it
 * exists to answer.
 *
 * **A malformed payload is still dropped rather than rethrown**, and that is
 * now load-bearing rather than merely simple. `PullConsumerRunner` naks what
 * throws, so a handler that threw on an unparseable event would redeliver it
 * `MAX_DELIVER` times and park it — spending the whole retry budget on an event
 * that cannot succeed. Dropping one unusable row is strictly better.
 *
 * A write that fails for a TRANSIENT reason does rethrow, because that is
 * exactly what redelivery is for.
 */
@Injectable()
export class AuditConsumer {
  private readonly logger = new Logger(AuditConsumer.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(command: RecordAuditCommand): Promise<void> {
    try {
      if (!this.isUsable(command)) {
        // Logged at WARN rather than ERROR: a malformed event is a bug in a
        // PUBLISHER, and the operator reading this needs to know which one —
        // hence the payload in the message.
        this.logger.warn(
          `Dropped a malformed audit event: ${JSON.stringify(command)?.slice(0, 500)}`,
        );
        return;
      }

      // **Not `?? null` any more, and this is where the type stops being a
      // guarantee.** `RecordAuditCommand.eventId` is `string`, but this subject
      // has no `@EventPattern` and therefore no deserializer in front of it —
      // the runner hands over whatever JSON reached the stream. A NULL here does
      // not conflict in the unique index, so the row and every redelivery of it
      // would be written again: the dedupe guard bypassed rather than absent.
      //
      // Parked rather than retried, because no redelivery adds a missing field.
      if (!command.eventId) {
        throw new UnprocessableMessage(
          `${command.action} arrived with no eventId, so it cannot be deduplicated`,
        );
      }

      await this.prisma.auditLog.create({
        data: {
          // The publisher's id for the act, and what makes a redelivery a no-op
          // rather than a second row. Non-null by the guard above; the COLUMN
          // stays nullable for rows written before the field existed.
          eventId: command.eventId,
          // `?? null`, never `?? someTenant`. A platform-level act belongs to
          // the platform (RDM §1.7), and coercing it into a tenant would file
          // an operator's action inside a customer's own audit trail — which
          // is both wrong and a disclosure.
          organizationId: command.organizationId ?? null,
          userId: command.userId ?? null,
          action: command.action,
          resourceType: command.resourceType ?? null,
          resourceId: command.resourceId ?? null,
          ipAddress: command.origin?.ip || null,
          userAgent: command.origin?.userAgent || null,
          // Cast because Prisma's `Json` input type is a recursive union that
          // `Record<string, unknown>` does not structurally satisfy — the value
          // IS valid JSON, the two type systems just describe it differently.
          metadata: (command.metadata ?? {}) as Prisma.InputJsonValue,
          // The PUBLISHER's clock. A consumer restart must not backdate a
          // backlog of events to the moment it caught up — the whole point of
          // an audit timestamp is when the thing happened, not when it was
          // filed.
          createdAt: new Date(command.occurredAt),
        },
      });
    } catch (error) {
      // Straight back out to the runner, which parks it. Falling through would
      // hand a permanent failure to the arm that logs and rethrows as transient,
      // and it would be retried five times on the way to the same place.
      if (error instanceof UnprocessableMessage) throw error;

      // **A duplicate is SUCCESS, not a failure**, and this is the half that
      // makes at-least-once delivery safe here: the stream WILL deliver the
      // same message twice, and an audit trail that counted it twice would
      // inflate "how many times did X happen" — the question it exists to
      // answer.
      //
      // The same shape `InAppNotificationService` already uses, and it is
      // deliberately NOT a read-then-write: two deliveries racing would both
      // read "absent" and both insert. The unique index is the only thing that
      // can decide this, so the insert asks it.
      if (isUniqueConstraintViolation(error, AUDIT_EVENT_ID_INDEX)) {
        this.logger.debug(
          `Audit event ${command.eventId} already recorded; redelivery ignored`,
        );
        return;
      }

      this.logger.error(
        `Failed to persist audit event ${command?.action}: ${formatErrorMsg(error)}`,
      );
      // Rethrown, unlike every other arm above. This is the transient case — a
      // dropped connection, a database mid-failover — and rethrowing is what
      // asks the runner to nak so the stream delivers it again. Swallowing here
      // would ack a message whose row was never written, which is the one
      // outcome durability was bought to prevent.
      throw error;
    }
  }

  /**
   * The minimum an audit row needs to be worth keeping.
   *
   * Only `action` and `occurredAt` are required, and that is not laziness:
   * every other field is legitimately absent in some real case — a system actor
   * has no `userId`, a platform act has no `organizationId`, a login has no
   * `resourceId`. Rejecting on those would drop valid events.
   *
   * An unparseable `occurredAt` is checked rather than trusted, because
   * `new Date('nonsense')` is an Invalid Date that Postgres rejects at INSERT
   * time — turning a bad field into a caught exception several lines later,
   * with a message that names the database rather than the payload.
   */
  private isUsable(command: RecordAuditCommand | undefined): boolean {
    if (!command?.action || !command.occurredAt) return false;

    return !Number.isNaN(new Date(command.occurredAt).getTime());
  }
}
