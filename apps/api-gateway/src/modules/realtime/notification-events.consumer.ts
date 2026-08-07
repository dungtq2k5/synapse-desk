import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  formatErrorMsg,
  NOTIFICATION_REALTIME_PATTERNS,
  NotificationReadPayload,
  NotificationRealtimePayload,
} from '@synapsedesk/common';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_EVENTS, userRoom } from './realtime.config';

/**
 * Domain E's events → sockets — 18-doc §6.
 *
 * **Reuses the gateway, adds nothing.** The socket server, the Redis adapter
 * and the `user:{id}` rooms already exist; notification-service publishes a
 * fact and this decides the room. Neither side imports the other, which is the
 * same arrangement `ticket-events.consumer.ts` has.
 *
 * **Every emit goes to `user:{recipientId}` and nowhere else.** That is the
 * whole privacy decision in this file: a notification is a personal inbox
 * entry, and the org room is joined by every member of a tenant with no further
 * check — one `org:` emit here would broadcast one user's notifications to
 * everybody connected.
 *
 * The unread count rides along on the read event rather than being computed
 * here, because this consumer has no database: the count arrives already
 * authoritative, which is also what stops a client incrementing a local
 * counter that is wrong the moment the user reads something on another device.
 */
@Controller()
export class NotificationEventsConsumer {
  private readonly logger = new Logger(NotificationEventsConsumer.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  @EventPattern(NOTIFICATION_REALTIME_PATTERNS.created)
  notificationCreated(@Payload() payload: NotificationRealtimePayload): void {
    this.relay(NOTIFICATION_REALTIME_PATTERNS.created, () => {
      this.gateway
        .toRoom(userRoom(payload.recipientId))
        .emit(REALTIME_EVENTS.notificationNew, payload);
    });
  }

  @EventPattern(NOTIFICATION_REALTIME_PATTERNS.updated)
  notificationUpdated(@Payload() payload: NotificationRealtimePayload): void {
    this.relay(NOTIFICATION_REALTIME_PATTERNS.updated, () => {
      // A DIFFERENT client event from `new`, so the UI updates the toast it is
      // already showing rather than stacking another.
      this.gateway
        .toRoom(userRoom(payload.recipientId))
        .emit(REALTIME_EVENTS.notificationUpdated, payload);
    });
  }

  @EventPattern(NOTIFICATION_REALTIME_PATTERNS.read)
  notificationRead(@Payload() payload: NotificationReadPayload): void {
    this.relay(NOTIFICATION_REALTIME_PATTERNS.read, () => {
      const room = this.gateway.toRoom(userRoom(payload.recipientId));

      room.emit(REALTIME_EVENTS.notificationRead, payload);
      // Sent as its own event as well, so a client that only tracks the badge
      // does not have to understand the read payload's shape.
      room.emit(REALTIME_EVENTS.notificationUnreadCount, {
        count: payload.unreadCount,
      });
    });
  }

  /**
   * Swallows after logging, like the ticket relay.
   *
   * An unhandled rejection in a NATS handler takes the process down, and this
   * process is the API gateway — losing every open socket in order to fail one
   * toast is not a trade worth making, especially when the notification itself
   * is already durably written.
   */
  private relay(pattern: string, emit: () => void): void {
    try {
      emit();
    } catch (error) {
      this.logger.error(`Could not relay ${pattern}: ${formatErrorMsg(error)}`);
    }
  }
}
