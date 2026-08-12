import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  ListNotificationsRequest,
  ListNotificationsResponse,
  ListPreferencesResponse,
  MarkReadRequest,
  MarkReadResponse,
  NotificationIdRequest,
  NotificationServiceController,
  ResolveTicketByMessageIdRequest,
  ResolveTicketByMessageIdResponse,
  NotificationServiceControllerMethods,
  PreferenceResponse,
  UnreadCountResponse,
  unpackCallerContext,
  UpdatePreferenceRequest,
} from '@synapsedesk/grpc-proto';
import { FeedService } from './feed.service';
import { InboundThreadService } from './inbound-thread.service';
import { PreferencesService } from '../preferences/preferences.service';

/**
 * Domain E's gRPC surface — 18-doc §1.1, §2.
 *
 * **Every method unpacks the caller context, and every one of them is
 * SELF-scoped.** The recipient is `ctx.sub`; no request message carries a user
 * id, which is what makes "read someone else's inbox" unexpressible rather
 * than merely refused.
 *
 * Note what is absent: there is no `Create`. Notifications are written by the
 * NATS consumers in this same process — an RPC would be a spam vector into
 * other users' inboxes and would bypass the `event_id` idempotency that makes
 * at-least-once delivery safe.
 */
@Controller()
@NotificationServiceControllerMethods()
export class NotificationsGrpcController implements NotificationServiceController {
  constructor(
    private readonly feed: FeedService,
    private readonly preferences: PreferencesService,
    private readonly inboundThreads: InboundThreadService,
  ) {}

  /**
   * 31-doc §4 — the `In-Reply-To` fallback.
   *
   * **No caller context, and it does not need one.** The caller is the inbound
   * webhook, which holds a verified Worker signature and no user; the tenant it
   * scopes on travels in the REQUEST, resolved from the address the mail was
   * sent to rather than from anything the message claimed.
   */
  resolveTicketByMessageId(
    request: ResolveTicketByMessageIdRequest,
  ): Promise<ResolveTicketByMessageIdResponse> {
    return this.inboundThreads.resolveTicketByMessageId(request);
  }

  listNotifications(
    request: ListNotificationsRequest,
    metadata?: Metadata,
  ): Promise<ListNotificationsResponse> {
    return this.feed.list(request, unpackCallerContext(metadata));
  }

  async getUnreadCount(
    _request: ListNotificationsRequest,
    metadata?: Metadata,
  ): Promise<UnreadCountResponse> {
    return {
      count: await this.feed.unreadCount(unpackCallerContext(metadata)),
    };
  }

  markRead(
    request: NotificationIdRequest,
    metadata?: Metadata,
  ): Promise<MarkReadResponse> {
    return this.feed.markRead(request, unpackCallerContext(metadata));
  }

  archive(
    request: NotificationIdRequest,
    metadata?: Metadata,
  ): Promise<MarkReadResponse> {
    return this.feed.archive(request, unpackCallerContext(metadata));
  }

  markManyRead(
    request: MarkReadRequest,
    metadata?: Metadata,
  ): Promise<MarkReadResponse> {
    return this.feed.markManyRead(request, unpackCallerContext(metadata));
  }

  listPreferences(
    _request: Record<string, never>,
    metadata?: Metadata,
  ): Promise<ListPreferencesResponse> {
    return this.preferences.list(unpackCallerContext(metadata));
  }

  updatePreference(
    request: UpdatePreferenceRequest,
    metadata?: Metadata,
  ): Promise<PreferenceResponse> {
    return this.preferences.update(request, unpackCallerContext(metadata));
  }
}
