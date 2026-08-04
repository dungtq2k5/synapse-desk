import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  AUDIT_PATTERNS,
  AuditAction,
  AuditResourceType,
  formatErrorMsg,
  RecordAuditCommand,
  NATS_CLIENT,
} from '@synapsedesk/common';
import { CallerContext } from '@synapsedesk/grpc-proto';

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
   * A subscriber here was the obvious alternative and does not work —
   * auth-service is a pure gRPC microservice, so a NATS `@EventPattern` would
   * never be listened for without turning it into a hybrid app for the sake of
   * a stopgap. Logging costs nothing and proves the publisher is being called.
   *
   * Set AUDIT_LOG_TO_CONSOLE=false once the real consumer exists.
   */
  private readonly logToConsole: boolean;

  constructor(
    @Inject(NATS_CLIENT) private readonly client: ClientProxy,
    configService: ConfigService,
  ) {
    this.logToConsole = configService.get<boolean>(
      'AUDIT_LOG_TO_CONSOLE',
      true,
    );
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
      organizationId:
        event.organizationId !== undefined
          ? event.organizationId
          : context.organizationId,
      userId: context.sub,
      origin: { ip: context.ip, userAgent: context.userAgent },
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      metadata: event.metadata,
      // Stamped here, not by the consumer: a consumer restart must not backdate
      // a backlog of events to the moment it caught up.
      occurredAt: new Date().toISOString(),
    };

    if (this.logToConsole) {
      // Serialized as one field so it survives a JSON log pipeline intact and
      // cannot collide with the logger's own keys.
      this.logger.log(JSON.stringify(command));
    }

    // `emit()` returns a COLD observable — nothing is published until something
    // subscribes. Omitting `.subscribe()` is the classic silent failure with
    // this API: no error, no message, no clue.
    this.client.emit(AUDIT_PATTERNS.record, command).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Failed to publish ${command.action} to ${AUDIT_PATTERNS.record}: ${formatErrorMsg(error)}`,
        ),
    });
  }
}
