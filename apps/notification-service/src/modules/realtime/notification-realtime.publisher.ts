import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CreateInAppNotificationCommand,
  formatErrorMsg,
  NATS_CLIENT,
  NOTIFICATION_REALTIME_PATTERNS,
  NotificationReadPayload,
  NotificationRealtimePayload,
} from '@synapsedesk/common';

/** What `persist()` decided, so the publisher can pick `created` vs `updated`. */
type PersistOutcome = {
  kind: 'created' | 'grouped' | 'duplicate';
  notificationId: string | null;
};

/**
 * Pushes a notification toward the socket.
 *
 * **Publishes a fact; decides no rooms.** The socket server lives at the
 * gateway, with the Redis adapter and the `user:{id}` rooms every other
 * real-time event already uses. Adding a second socket server here would mean
 * two things to scale, two adapters to configure, and a client holding two
 * connections to one product.
 *
 * **Fire-and-forget, and that is the design.** The row is already written when
 * this runs, so a failed emit costs a toast and not a notification: a
 * disconnected user finds it waiting on next load. This is why there is no
 * delivery row for the socket — the in-app row IS the record, and a `WEBHOOK`-
 * style entry for a channel that cannot be missed would imply it could be.
 */
@Injectable()
export class NotificationRealtimePublisher {
  private readonly logger = new Logger(NotificationRealtimePublisher.name);

  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  publish(
    command: CreateInAppNotificationCommand,
    outcome: PersistOutcome,
    recipientId: string,
  ): void {
    if (!outcome.notificationId) return;

    // `updated` for a collapse, so the client edits the toast it already has
    // ("12 new messages on #1042") rather than stacking a twelfth. Without the
    // distinction, grouping exists in the database and is invisible in the UI —
    // which is the same shape of bug as the subject with no subscriber.
    const pattern =
      outcome.kind === 'grouped'
        ? NOTIFICATION_REALTIME_PATTERNS.updated
        : NOTIFICATION_REALTIME_PATTERNS.created;

    const payload: NotificationRealtimePayload = {
      organizationId: command.organizationId,
      recipientId,
      notificationId: outcome.notificationId,
      type: command.type,
      priority: command.priority,
      title: command.title,
      body: command.body,
      data: command.data ?? {},
      actionUrl: command.actionUrl ?? null,
      groupKey: command.groupKey ?? null,
      // The client re-reads the count from the feed if it needs an exact one;
      // this is enough to render "N new" on the toast that just arrived.
      groupCount: outcome.kind === 'grouped' ? 0 : 1,
      occurredAt: command.occurredAt,
    };

    this.emit(pattern, payload);
  }

  /** Read/archive, so a second tab stops showing a badge the user cleared. */
  publishRead(payload: NotificationReadPayload): void {
    this.emit(NOTIFICATION_REALTIME_PATTERNS.read, payload);
  }

  private emit(pattern: string, payload: unknown): void {
    // `.subscribe()` is mandatory: `emit()` is COLD and nothing is published
    // without it. The classic silent failure with this API, and one that would
    // be invisible here because nothing awaits the result.
    this.client.emit(pattern, payload).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Could not publish ${pattern}: ${formatErrorMsg(error)}`,
        ),
    });
  }
}
