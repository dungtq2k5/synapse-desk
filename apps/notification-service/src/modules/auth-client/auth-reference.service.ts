import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  UserProjection,
  AUTH_GRPC_CLIENT,
  GRPC_DEADLINE_MS,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/common';
import {
  NotificationRecipient,
  toNotificationRecipient,
} from './auth-reference.mapper';

/**
 * Resolves an AUDIENCE from a permission code.
 *
 * The producer of an in-app notification names a permission — "whoever can act
 * on this" — because it cannot know who that is in a given tenant. auth-service
 * owns roles and permissions, so it answers; doing the join here would mean
 * duplicating it in every service that ever notifies anyone.
 */
@Injectable()
export class AuthReferenceService implements OnModuleInit {
  private readonly logger = new Logger(AuthReferenceService.name);

  private userService!: UserServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.userService =
      this.client.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  /**
   * The recipients, or an EMPTY LIST when auth-service cannot be reached.
   *
   * Empty rather than throwing, and the direction is deliberate: a consumer
   * that threw would leave the NATS handler rejecting, and core NATS has no
   * redelivery — so the notification would be lost either way, but the log
   * would blame the message rather than the outage. An empty audience is
   * logged loudly and the event is dropped with a reason.
   *
   * This is the OPPOSITE of the entitlement read, which fails closed. The rule
   * is what the failure costs: an unreadable BUDGET must not be treated as
   * unlimited, because that spends money. An unresolvable AUDIENCE costs one
   * notification.
   */
  async listPermissionHolders(
    organizationId: string,
    permissionCode: string,
    departmentId?: string,
  ): Promise<NotificationRecipient[]> {
    try {
      const response = await firstValueFrom(
        this.userService
          .listPermissionHolders({
            organizationId,
            permissionCode,
            departmentId,
          })
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return response.items.map(toNotificationRecipient);
    } catch (error) {
      this.logger.error(
        `Could not resolve '${permissionCode}' holders for ${organizationId}: ${formatErrorMsg(error)}`,
      );

      return [];
    }
  }

  /**
   * Addresses for recipients the producer ALREADY NAMED — 18-doc §1.3.
   *
   * The distinction matters: this decides nothing about who should be
   * notified. A ticket event knows its assignee, and asking "who holds
   * `ticket.read`?" instead would notify every agent in the tenant that one of
   * them got a ticket.
   *
   * Same empty-on-failure posture as above, and for the same reason.
   */
  async listUsersByIds(
    organizationId: string,
    userIds: string[],
  ): Promise<NotificationRecipient[]> {
    try {
      const response = await firstValueFrom(
        this.userService
          .listUsersByIds({
            organizationId,
            userIds,
            // **The notification audience, unchanged** — 27-doc §3. `false`
            // keeps "a notification to a deactivated account is a row nobody
            // reads" true now that the flag exists for the GraphQL loader,
            // which wants the opposite answer.
            includeInactive: false,
            projection: UserProjection.USER_PROJECTION_NOTIFICATION,
          })
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return response.items.map(toNotificationRecipient);
    } catch (error) {
      this.logger.error(
        `Could not resolve ${userIds.length} recipient(s) for ${organizationId}: ${formatErrorMsg(error)}`,
      );

      return [];
    }
  }
}
