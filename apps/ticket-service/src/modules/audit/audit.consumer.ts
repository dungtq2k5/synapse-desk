import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  AUDIT_PATTERNS,
  formatErrorMsg,
  RecordAuditCommand,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

/**
 * The consumer Domain A has been publishing into since it was built.
 *
 * `AuditPublisher` has emitted to `audit.record` from day one, with nothing
 * subscribed and a console log as the documented stopgap. This ends that: the
 * events now land in `audit_logs`, which `ticket-service` owns per the
 * ownership map even though every producer so far is auth-service.
 *
 * **At-most-once, deliberately, and matching the publisher.** NATS core has no
 * redelivery, and `AuditPublisher`'s own docblock already accepts that the
 * trail can have holes when the broker is down. Matching that here keeps this
 * handler simple: it catches, logs and drops. It never rethrows.
 *
 * That last part is the load-bearing one. A handler that throws on a malformed
 * payload does not "fail safely" — with a durable subscription it produces a
 * poison-message loop that redelivers the same bad event forever and buries
 * every good one behind it. Dropping one row is strictly better than losing the
 * stream.
 *
 * If the trail is ever REQUIRED to be gap-free, the fix is JetStream plus a
 * durable consumer, applied to both ends — not a retry bolted onto this one.
 */
@Controller()
export class AuditConsumer {
  private readonly logger = new Logger(AuditConsumer.name);

  constructor(private readonly prisma: PrismaService) {}

  @EventPattern(AUDIT_PATTERNS.record)
  async record(@Payload() command: RecordAuditCommand): Promise<void> {
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

      await this.prisma.auditLog.create({
        data: {
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
      this.logger.error(
        `Failed to persist audit event ${command?.action}: ${formatErrorMsg(error)}`,
      );
      // Deliberately swallowed. See the class docblock.
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
