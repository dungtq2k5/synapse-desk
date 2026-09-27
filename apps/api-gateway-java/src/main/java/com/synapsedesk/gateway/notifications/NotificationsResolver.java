package com.synapsedesk.gateway.notifications;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.graphql.GraphqlLimits;
import com.synapsedesk.gateway.graphql.UserSummaryGqlDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.notification.Notification.ListNotificationsRequest;
import synapsedesk.notification.Notification.ListNotificationsResponse;
import synapsedesk.notification.Notification.MarkReadRequest;
import synapsedesk.notification.Notification.MarkReadResponse;
import synapsedesk.notification.Notification.NotificationIdRequest;
import synapsedesk.notification.Notification.UnreadCountResponse;
import synapsedesk.notification.NotificationServiceGrpc;

/**
 * The notification feed, and one mutation — `notifications.resolver.ts`,
 * reproduced. No `@RequirePermission` anywhere here: a notification belongs
 * to its recipient, and the service scopes every read to the caller's own
 * `sub` — a permission would be asking whether someone may read their own
 * inbox.
 */
@Controller
public class NotificationsResolver {

  private static final long DEADLINE_SECONDS = 5;

  private final NotificationServiceGrpc.NotificationServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public NotificationsResolver(
      NotificationServiceGrpc.NotificationServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @QueryMapping(name = "notifications")
  public NotificationFeedGqlDto notifications(@Argument int first, @Argument String cursor) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListNotificationsRequest.Builder wire =
        ListNotificationsRequest.newBuilder()
            .setUnreadOnly(false)
            .setIncludeArchived(false)
            .setLimit(Math.min(first, GraphqlLimits.MAX_PAGE_SIZE));
    if (cursor != null) {
      wire.setCursor(cursor);
    }

    ListNotificationsResponse response = withMetadata(context).listNotifications(wire.build());

    return NotificationMapper.toFeedGqlDto(response);
  }

  @QueryMapping
  public int unreadNotificationCount() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // Reuses `ListNotificationsRequest` — the recipient comes from metadata,
    // matching `NotificationsController`'s own REST route.
    UnreadCountResponse response =
        withMetadata(context)
            .getUnreadCount(
                ListNotificationsRequest.newBuilder()
                    .setUnreadOnly(true)
                    .setIncludeArchived(false)
                    .setLimit(0)
                    .build());

    return response.getCount();
  }

  /** `Notification.actor` — who caused it. `UserSummary`, never the full profile. */
  @SchemaMapping(typeName = "Notification", field = "actor")
  public CompletableFuture<UserSummaryGqlDto> actor(
      NotificationGqlDto notification, DataLoader<String, UserSummaryGqlDto> loader) {
    if (notification.actorId() == null) {
      return CompletableFuture.completedFuture(null);
    }

    RequestContext context = currentUser.require(CurrentRequest.request());

    return loader.load(notification.actorId(), context);
  }

  @MutationMapping
  public MarkNotificationReadPayloadGqlDto markNotificationRead(@Argument String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    MarkReadResponse response =
        withMetadata(context).markRead(NotificationIdRequest.newBuilder().setId(id).build());

    // The new BADGE, not the row — the client already has the row it just
    // clicked, and a locally-decremented counter is always wrong eventually
    // because a notification can be read on another device.
    return new MarkNotificationReadPayloadGqlDto(id, response.getUnreadCount());
  }

  private NotificationServiceGrpc.NotificationServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
