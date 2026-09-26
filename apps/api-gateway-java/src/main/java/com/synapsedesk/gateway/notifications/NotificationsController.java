package com.synapsedesk.gateway.notifications;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.NotificationsApi;
import com.synapsedesk.gateway.generated.model.DeviceTokenResponseDto;
import com.synapsedesk.gateway.generated.model.MarkManyReadDto;
import com.synapsedesk.gateway.generated.model.MarkReadResponseDto;
import com.synapsedesk.gateway.generated.model.NotificationFeedResponseDto;
import com.synapsedesk.gateway.generated.model.NotificationResponseDto;
import com.synapsedesk.gateway.generated.model.NotificationsControllerListDevicesV1200Response;
import com.synapsedesk.gateway.generated.model.NotificationsControllerListPreferencesV1200Response;
import com.synapsedesk.gateway.generated.model.NotificationsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.NotificationsControllerMarkManyReadV1200Response;
import com.synapsedesk.gateway.generated.model.NotificationsControllerRegisterDeviceV1200Response;
import com.synapsedesk.gateway.generated.model.NotificationsControllerUnreadCountV1200Response;
import com.synapsedesk.gateway.generated.model.NotificationsControllerUpdatePreferenceV1200Response;
import com.synapsedesk.gateway.generated.model.PreferenceResponseDto;
import com.synapsedesk.gateway.generated.model.RegisterDeviceDto;
import com.synapsedesk.gateway.generated.model.UnreadCountResponseDto;
import com.synapsedesk.gateway.generated.model.UpdatePreferenceDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.notification.Notification.DeviceIdRequest;
import synapsedesk.notification.Notification.DeviceTokenResponse;
import synapsedesk.notification.Notification.ListNotificationsRequest;
import synapsedesk.notification.Notification.ListNotificationsResponse;
import synapsedesk.notification.Notification.ListPreferencesRequest;
import synapsedesk.notification.Notification.MarkReadRequest;
import synapsedesk.notification.Notification.MarkReadResponse;
import synapsedesk.notification.Notification.NotificationIdRequest;
import synapsedesk.notification.Notification.NotificationResourceType;
import synapsedesk.notification.Notification.NotificationResponse;
import synapsedesk.notification.Notification.NotificationType;
import synapsedesk.notification.Notification.PreferenceResponse;
import synapsedesk.notification.Notification.RegisterDeviceRequest;
import synapsedesk.notification.Notification.UnreadCountResponse;
import synapsedesk.notification.Notification.UpdatePreferenceRequest;
import synapsedesk.notification.NotificationServiceGrpc;

/**
 * `NotificationsApi` — the personal inbox, ported from
 * `notifications.service.ts` / `notifications-grpc.client.ts` /
 * `notification.mapper.ts`.
 *
 * <p><b>Every route is SELF-scoped, and there is deliberately no permission
 * check</b> — the recipient is {@code context.sub()}, carried in the gRPC
 * metadata {@link CallerMetadata} already packs, and no request shape here
 * can name a different one. The caller-scoping IS the security; a sabotage
 * that dropped the metadata's `user_id` would be the one that matters most
 * for this module, not a missing annotation.
 *
 * <p>Pays for the notification-service channel — the third peer after
 * ticket-service and ingestion-service.
 */
@RestController
public class NotificationsController implements NotificationsApi {

  private static final long DEADLINE_SECONDS = 5;

  /**
   * `NOTIFICATION_TYPES` (`@synapsedesk/common`), reproduced — the wire enum's
   * member names do not match the REST DTO's dotted string values (the domain
   * side is a dotted-subject map, not a `NOTIFICATION_TYPE_*` suffix), so this
   * is an explicit table rather than the strip-the-prefix trick every other
   * enum bridge in this codebase uses.
   */
  private static final Map<NotificationType, String> TYPE_VALUES = new EnumMap<>(NotificationType.class);

  static {
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_TICKET_ASSIGNED, "ticket.assigned");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_TICKET_REASSIGNED, "ticket.reassigned");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_TICKET_ESCALATED, "ticket.escalated");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_TICKET_MESSAGE_CREATED, "ticket.message_created");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_TICKET_STATUS_CHANGED, "ticket.status_changed");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_QUOTA_THRESHOLD, "quota.threshold");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_LIMIT_THRESHOLD, "limit.threshold");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_PAYMENT_FAILED, "billing.payment_failed");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_PLAN_CHANGED, "billing.plan_changed");
    TYPE_VALUES.put(NotificationType.NOTIFICATION_TYPE_WEBHOOK_ENDPOINT_DISABLED, "webhook.endpoint_disabled");
  }

  private final NotificationServiceGrpc.NotificationServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final tools.jackson.databind.ObjectMapper json;

  public NotificationsController(
      NotificationServiceGrpc.NotificationServiceBlockingStub stub,
      CurrentUser currentUser,
      tools.jackson.databind.ObjectMapper json) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.json = json;
  }

  private NotificationServiceGrpc.NotificationServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<NotificationsControllerListV1200Response> notificationsControllerListV1(
      Boolean unreadOnly, Boolean includeArchived, BigDecimal limit, String type, String cursor) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListNotificationsRequest.Builder wire =
        ListNotificationsRequest.newBuilder()
            .setUnreadOnly(Boolean.TRUE.equals(unreadOnly))
            .setIncludeArchived(Boolean.TRUE.equals(includeArchived))
            .setLimit(limit.intValue());
    if (type != null) {
      wire.setType(toProtoType(type));
    }
    if (cursor != null) {
      wire.setCursor(cursor);
    }

    ListNotificationsResponse response = withMetadata(context).listNotifications(wire.build());

    return ResponseEntity.ok(
        new NotificationsControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toFeedDto(response)));
  }

  @Override
  public ResponseEntity<NotificationsControllerUnreadCountV1200Response> notificationsControllerUnreadCountV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // Reuses `ListNotificationsRequest` — the recipient comes from metadata,
    // so every field but these three is irrelevant here, matching the Node
    // client's own comment on why.
    UnreadCountResponse response =
        withMetadata(context)
            .getUnreadCount(
                ListNotificationsRequest.newBuilder()
                    .setUnreadOnly(true)
                    .setIncludeArchived(false)
                    .setLimit(0)
                    .build());

    return ResponseEntity.ok(
        new NotificationsControllerUnreadCountV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new UnreadCountResponseDto().count(BigDecimal.valueOf(response.getCount()))));
  }

  @Override
  public ResponseEntity<NotificationsControllerListPreferencesV1200Response> notificationsControllerListPreferencesV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    List<PreferenceResponseDto> data =
        withMetadata(context).listPreferences(ListPreferencesRequest.newBuilder().build()).getItemsList().stream()
            .map(NotificationsController::toPreferenceDto)
            .toList();

    return ResponseEntity.ok(
        new NotificationsControllerListPreferencesV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<NotificationsControllerUpdatePreferenceV1200Response> notificationsControllerUpdatePreferenceV1(
      UpdatePreferenceDto updatePreferenceDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdatePreferenceRequest.Builder wire =
        UpdatePreferenceRequest.newBuilder()
            .setType(updatePreferenceDto.getType().getValue())
            .setChannel(toProtoChannel(updatePreferenceDto.getChannel().getValue()));
    if (updatePreferenceDto.getIsEnabled() != null) {
      wire.setIsEnabled(updatePreferenceDto.getIsEnabled());
    }
    if (updatePreferenceDto.getDigest() != null) {
      wire.setDigest(toProtoDigest(updatePreferenceDto.getDigest().getValue()));
    }

    PreferenceResponse response = withMetadata(context).updatePreference(wire.build());

    return ResponseEntity.ok(
        new NotificationsControllerUpdatePreferenceV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toPreferenceDto(response)));
  }

  @Override
  public ResponseEntity<NotificationsControllerRegisterDeviceV1200Response> notificationsControllerRegisterDeviceV1(
      RegisterDeviceDto registerDeviceDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RegisterDeviceRequest.Builder wire =
        RegisterDeviceRequest.newBuilder()
            .setToken(registerDeviceDto.getToken())
            .setPlatform(toProtoPlatform(registerDeviceDto.getPlatform().getValue()));
    if (registerDeviceDto.getDeviceName() != null) {
      wire.setDeviceName(registerDeviceDto.getDeviceName());
    }

    DeviceTokenResponse response = withMetadata(context).registerDevice(wire.build());

    return ResponseEntity.ok(
        new NotificationsControllerRegisterDeviceV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toDeviceDto(response)));
  }

  @Override
  public ResponseEntity<NotificationsControllerListDevicesV1200Response> notificationsControllerListDevicesV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    List<DeviceTokenResponseDto> data =
        withMetadata(context).listDevices(synapsedesk.notification.Notification.ListDevicesRequest.newBuilder().build())
            .getItemsList().stream()
            .map(NotificationsController::toDeviceDto)
            .toList();

    return ResponseEntity.ok(
        new NotificationsControllerListDevicesV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<Void> notificationsControllerForgetDeviceV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).forgetDevice(DeviceIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.noContent().build();
  }

  @Override
  public ResponseEntity<NotificationsControllerMarkManyReadV1200Response> notificationsControllerMarkManyReadV1(
      MarkManyReadDto markManyReadDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    MarkReadRequest.Builder wire =
        MarkReadRequest.newBuilder()
            .addAllIds(markManyReadDto.getIds().stream().map(Object::toString).toList());
    if (markManyReadDto.getResourceType() != null) {
      wire.setResourceType(toProtoResourceType(markManyReadDto.getResourceType().getValue()));
    }
    if (markManyReadDto.getResourceId() != null) {
      wire.setResourceId(markManyReadDto.getResourceId().toString());
    }

    MarkReadResponse response = withMetadata(context).markManyRead(wire.build());

    return ResponseEntity.ok(
        new NotificationsControllerMarkManyReadV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toMarkReadDto(response)));
  }

  @Override
  public ResponseEntity<NotificationsControllerMarkManyReadV1200Response> notificationsControllerMarkReadV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    MarkReadResponse response =
        withMetadata(context).markRead(NotificationIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new NotificationsControllerMarkManyReadV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toMarkReadDto(response)));
  }

  @Override
  public ResponseEntity<NotificationsControllerMarkManyReadV1200Response> notificationsControllerArchiveV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    MarkReadResponse response =
        withMetadata(context).archive(NotificationIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new NotificationsControllerMarkManyReadV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toMarkReadDto(response)));
  }

  // ------------------------------------------------------------------ mappers

  private NotificationFeedResponseDto toFeedDto(ListNotificationsResponse response) {
    return new NotificationFeedResponseDto()
        .items(response.getItemsList().stream().map(this::toNotificationDto).toList())
        .nextCursor(response.hasNextCursor() ? response.getNextCursor() : null)
        .hasMore(response.getHasMore());
  }

  private NotificationResponseDto toNotificationDto(NotificationResponse notification) {
    return new NotificationResponseDto()
        .id(notification.getId())
        .organizationId(notification.getOrganizationId())
        .type(toTypeEnum(notification.getType()))
        .priority(toPriorityEnum(notification.getPriority()))
        .title(notification.getTitle())
        .body(notification.hasBody() ? notification.getBody() : null)
        .data(parseData(notification.getData()))
        .actionUrl(notification.hasActionUrl() ? notification.getActionUrl() : null)
        .actorId(notification.hasActorId() ? notification.getActorId() : null)
        .resourceType(toResourceTypeEnum(notification.getResourceType()))
        .resourceId(notification.hasResourceId() ? notification.getResourceId() : null)
        .groupKey(notification.hasGroupKey() ? notification.getGroupKey() : null)
        .groupCount(BigDecimal.valueOf(notification.getGroupCount()))
        .readAt(notification.hasReadAt() ? toOffsetDateTime(notification.getReadAt()) : null)
        .archivedAt(notification.hasArchivedAt() ? toOffsetDateTime(notification.getArchivedAt()) : null)
        .createdAt(toOffsetDateTime(notification.getCreatedAt()));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> parseData(String raw) {
    if (raw == null || raw.isEmpty()) {
      return Map.of();
    }

    try {
      return json.readValue(raw, Map.class);
    } catch (RuntimeException malformed) {
      // A malformed payload on one row must not take out the whole feed —
      // `parseData`'s own guard, reproduced.
      return Map.of();
    }
  }

  private static PreferenceResponseDto toPreferenceDto(PreferenceResponse preference) {
    return new PreferenceResponseDto()
        // The wire's `type` is already the dotted string / `'*'` a preference
        // key can be — `fromValue` answers null for anything else, matching
        // `asPreferenceType`'s own narrowing.
        .type(PreferenceResponseDto.TypeEnum.fromValue(preference.getType()))
        .channel(PreferenceResponseDto.ChannelEnum.fromValue(
            preference.getChannel().name().replace("NOTIFICATION_CHANNEL_", "")))
        .isEnabled(preference.getIsEnabled())
        .digest(PreferenceResponseDto.DigestEnum.fromValue(preference.getDigest().name().replace("DIGEST_MODE_", "")))
        .source(
            PreferenceResponseDto.SourceEnum.fromValue(
                preference.getSource().name().replace("PREFERENCE_SOURCE_", "")));
  }

  private static DeviceTokenResponseDto toDeviceDto(DeviceTokenResponse device) {
    return new DeviceTokenResponseDto()
        .id(device.getId())
        .platform(
            DeviceTokenResponseDto.PlatformEnum.fromValue(
                device.getPlatform().name().replace("DEVICE_PLATFORM_", "")))
        .deviceName(device.hasDeviceName() ? device.getDeviceName() : null)
        .lastUsedAt(device.hasLastUsedAt() ? toOffsetDateTime(device.getLastUsedAt()) : null)
        .createdAt(toOffsetDateTime(device.getCreatedAt()));
  }

  private static MarkReadResponseDto toMarkReadDto(MarkReadResponse response) {
    return new MarkReadResponseDto()
        .updated(BigDecimal.valueOf(response.getUpdated()))
        .unreadCount(BigDecimal.valueOf(response.getUnreadCount()));
  }

  // ----------------------------------------------------------- enum bridges

  private static NotificationType toProtoType(String value) {
    return TYPE_VALUES.entrySet().stream()
        .filter(entry -> entry.getValue().equals(value))
        .map(Map.Entry::getKey)
        .findFirst()
        .orElse(NotificationType.NOTIFICATION_TYPE_UNSPECIFIED);
  }

  private static NotificationResponseDto.TypeEnum toTypeEnum(NotificationType type) {
    String value = TYPE_VALUES.get(type);

    return value == null ? null : NotificationResponseDto.TypeEnum.fromValue(value);
  }

  private static NotificationResponseDto.PriorityEnum toPriorityEnum(
      synapsedesk.notification.Notification.NotificationPriority priority) {
    return NotificationResponseDto.PriorityEnum.fromValue(priority.name().replace("NOTIFICATION_PRIORITY_", ""));
  }

  private static NotificationResponseDto.ResourceTypeEnum toResourceTypeEnum(NotificationResourceType resourceType) {
    return NotificationResponseDto.ResourceTypeEnum.fromValue(
        resourceType.name().replace("NOTIFICATION_RESOURCE_TYPE_", ""));
  }

  private static synapsedesk.notification.Notification.NotificationChannel toProtoChannel(String value) {
    return synapsedesk.notification.Notification.NotificationChannel.valueOf("NOTIFICATION_CHANNEL_" + value);
  }

  private static synapsedesk.notification.Notification.DigestMode toProtoDigest(String value) {
    return synapsedesk.notification.Notification.DigestMode.valueOf("DIGEST_MODE_" + value);
  }

  private static synapsedesk.notification.Notification.DevicePlatform toProtoPlatform(String value) {
    return synapsedesk.notification.Notification.DevicePlatform.valueOf("DEVICE_PLATFORM_" + value);
  }

  private static NotificationResourceType toProtoResourceType(String value) {
    return NotificationResourceType.valueOf("NOTIFICATION_RESOURCE_TYPE_" + value);
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}
