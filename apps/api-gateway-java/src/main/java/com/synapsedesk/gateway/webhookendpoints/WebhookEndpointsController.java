package com.synapsedesk.gateway.webhookendpoints;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.WebhookEndpointsApi;
import com.synapsedesk.gateway.generated.model.CreateWebhookEndpointDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DeleteWebhookEndpointResponseDto;
import com.synapsedesk.gateway.generated.model.TestWebhookResponseDto;
import com.synapsedesk.gateway.generated.model.UpdateWebhookEndpointDto;
import com.synapsedesk.gateway.generated.model.WebhookDeliveriesResponseDto;
import com.synapsedesk.gateway.generated.model.WebhookDeliveryResponseDto;
import com.synapsedesk.gateway.generated.model.WebhookEndpointResponseDto;
import com.synapsedesk.gateway.generated.model.WebhookEndpointWithSecretResponseDto;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsControllerCreateV1200Response;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsControllerDeleteV1200Response;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsControllerGetV1200Response;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsControllerListDeliveriesV1200Response;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsControllerListEventTypesV1200Response;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsControllerTestV1200Response;
import com.synapsedesk.gateway.generated.model.WebhookEndpointsResponseDto;
import com.synapsedesk.gateway.generated.model.WebhookEventTypesResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.CachedBodyRequest;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.notification.Notification.CreateWebhookEndpointRequest;
import synapsedesk.notification.Notification.DeleteWebhookEndpointResponse;
import synapsedesk.notification.Notification.EventTypeList;
import synapsedesk.notification.Notification.ListWebhookDeliveriesRequest;
import synapsedesk.notification.Notification.ListWebhookDeliveriesResponse;
import synapsedesk.notification.Notification.ListWebhookEndpointsRequest;
import synapsedesk.notification.Notification.ListWebhookEventTypesRequest;
import synapsedesk.notification.Notification.ListWebhookEventTypesResponse;
import synapsedesk.notification.Notification.NotificationType;
import synapsedesk.notification.Notification.TestWebhookEndpointResponse;
import synapsedesk.notification.Notification.UpdateWebhookEndpointRequest;
import synapsedesk.notification.Notification.WebhookDeliveryResponse;
import synapsedesk.notification.Notification.WebhookDeliveryStatus;
import synapsedesk.notification.Notification.WebhookEndpointIdRequest;
import synapsedesk.notification.Notification.WebhookEndpointResponse;
import synapsedesk.notification.Notification.WebhookEndpointWithSecretResponse;
import synapsedesk.notification.NotificationServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `WebhookEndpointsApi` — outbound webhook management, against
 * notification-service. `organization.read`/`organization.update` gate it,
 * matching Node's own reasoning: this is tenant configuration, like billing
 * and settings, not a notification-specific permission.
 *
 * <p>
 * <b>The secret rides ONLY on {@code create} and {@code rotateSecret}</b> —
 * enforced structurally by the generated types, not by convention:
 * {@link WebhookEndpointWithSecretResponseDto} is the only response DTO with
 * a {@code secret} field, and {@code get}/{@code list}/{@code update} never
 * construct one.
 *
 * <p>
 * <b>{@code update}'s {@code eventTypes} needs the raw request body</b>, the
 * same shape as {@code OrganizationsController.updateSettings}: proto3
 * cannot tell an absent repeated field from an empty one, so "leave the
 * subscriptions alone" and "replace them" travel as a wrapper message
 * ({@link EventTypeList}) that is only ever set when the client's JSON
 * actually named the key — read via {@link CachedBodyRequest}, since the
 * bound DTO's {@code eventTypes} defaults to an empty list whether the key
 * was sent or not.
 */
@RestController
public class WebhookEndpointsController implements WebhookEndpointsApi {

  private static final long DEADLINE_SECONDS = 5;

  /**
   * `NOTIFICATION_TYPES`, reproduced — the wire enum's member names do not
   * match the REST DTO's dotted string values, so this is an explicit table
   * rather than the strip-the-prefix trick most enum bridges in this
   * codebase use. Matches {@code NotificationsController.TYPE_VALUES}
   * exactly; kept local rather than shared across packages, the convention
   * every other controller in this port follows.
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
  private final ObjectMapper json;

  public WebhookEndpointsController(
      NotificationServiceGrpc.NotificationServiceBlockingStub stub, CurrentUser currentUser, ObjectMapper json) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.json = json;
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<WebhookEndpointsControllerListV1200Response> webhookEndpointsControllerListV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).listWebhookEndpoints(ListWebhookEndpointsRequest.getDefaultInstance());

    WebhookEndpointsResponseDto data =
        new WebhookEndpointsResponseDto(response.getItemsList().stream().map(WebhookEndpointsController::toDto).toList());

    return ResponseEntity.ok(
        new WebhookEndpointsControllerListV1200Response().success(true).statusCode(BigDecimal.valueOf(200)).message("OK").data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<WebhookEndpointsControllerListEventTypesV1200Response> webhookEndpointsControllerListEventTypesV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListWebhookEventTypesResponse response =
        withMetadata(context).listWebhookEventTypes(ListWebhookEventTypesRequest.getDefaultInstance());

    WebhookEventTypesResponseDto data =
        new WebhookEventTypesResponseDto(
            response.getTypesList().stream().map(WebhookEndpointsController::toTypesEnum).filter(java.util.Objects::nonNull).toList());

    return ResponseEntity.ok(
        new WebhookEndpointsControllerListEventTypesV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<WebhookEndpointsControllerGetV1200Response> webhookEndpointsControllerGetV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    WebhookEndpointResponse response =
        withMetadata(context).getWebhookEndpoint(WebhookEndpointIdRequest.newBuilder().setEndpointId(id).build());

    return ResponseEntity.ok(
        new WebhookEndpointsControllerGetV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<WebhookEndpointsControllerCreateV1200Response> webhookEndpointsControllerCreateV1(
      CreateWebhookEndpointDto createWebhookEndpointDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateWebhookEndpointRequest.Builder wire =
        CreateWebhookEndpointRequest.newBuilder()
            .setUrl(createWebhookEndpointDto.getUrl().toString())
            .addAllEventTypes(
                createWebhookEndpointDto.getEventTypes().stream().map(type -> toProtoType(type.getValue())).toList());
    if (createWebhookEndpointDto.getDescription() != null) {
      wire.setDescription(createWebhookEndpointDto.getDescription());
    }

    WebhookEndpointWithSecretResponse response = withMetadata(context).createWebhookEndpoint(wire.build());

    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            new WebhookEndpointsControllerCreateV1200Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(201))
                .message("OK")
                .data(toWithSecretDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<WebhookEndpointsControllerGetV1200Response> webhookEndpointsControllerUpdateV1(
      String id, UpdateWebhookEndpointDto updateWebhookEndpointDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateWebhookEndpointRequest.Builder wire = UpdateWebhookEndpointRequest.newBuilder().setEndpointId(id);
    if (updateWebhookEndpointDto.getUrl() != null) {
      wire.setUrl(updateWebhookEndpointDto.getUrl().toString());
    }
    if (updateWebhookEndpointDto.getDescription() != null) {
      wire.setDescription(updateWebhookEndpointDto.getDescription());
    }
    if (updateWebhookEndpointDto.getIsActive() != null) {
      wire.setIsActive(updateWebhookEndpointDto.getIsActive());
    }
    if (rawBody().has("eventTypes")) {
      if (updateWebhookEndpointDto.getEventTypes().isEmpty()) {
        // The generator's own `@Size(min = 1)` on this getter can't tell an
        // absent key from an explicit `[]` (both bind to the same default
        // empty list), so it is dropped for this property (ValidationConfig)
        // and the refusal is reproduced here, where presence is known.
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "eventTypes must contain at least 1 elements");
      }
      wire.setEventTypes(
          EventTypeList.newBuilder()
              .addAllValues(
                  updateWebhookEndpointDto.getEventTypes().stream().map(type -> toProtoType(type.getValue())).toList()));
    }

    WebhookEndpointResponse response = withMetadata(context).updateWebhookEndpoint(wire.build());

    return ResponseEntity.ok(
        new WebhookEndpointsControllerGetV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<WebhookEndpointsControllerDeleteV1200Response> webhookEndpointsControllerDeleteV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DeleteWebhookEndpointResponse response =
        withMetadata(context).deleteWebhookEndpoint(WebhookEndpointIdRequest.newBuilder().setEndpointId(id).build());

    return ResponseEntity.ok(
        new WebhookEndpointsControllerDeleteV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new DeleteWebhookEndpointResponseDto(response.getDeleted())));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<WebhookEndpointsControllerCreateV1200Response> webhookEndpointsControllerRotateSecretV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    WebhookEndpointWithSecretResponse response =
        withMetadata(context).rotateWebhookSecret(WebhookEndpointIdRequest.newBuilder().setEndpointId(id).build());

    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            new WebhookEndpointsControllerCreateV1200Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(201))
                .message("OK")
                .data(toWithSecretDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<WebhookEndpointsControllerTestV1200Response> webhookEndpointsControllerTestV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    TestWebhookEndpointResponse response =
        withMetadata(context).testWebhookEndpoint(WebhookEndpointIdRequest.newBuilder().setEndpointId(id).build());

    TestWebhookResponseDto data =
        new TestWebhookResponseDto(
            response.getDelivered(),
            response.hasResponseStatus() ? BigDecimal.valueOf(response.getResponseStatus()) : null,
            response.hasError() ? response.getError() : null);

    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            new WebhookEndpointsControllerTestV1200Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(201))
                .message("OK")
                .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<WebhookEndpointsControllerListDeliveriesV1200Response> webhookEndpointsControllerListDeliveriesV1(
      String id, BigDecimal limit) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListWebhookDeliveriesResponse response =
        withMetadata(context)
            .listWebhookDeliveries(
                ListWebhookDeliveriesRequest.newBuilder().setEndpointId(id).setLimit(limit.intValue()).build());

    WebhookDeliveriesResponseDto data =
        new WebhookDeliveriesResponseDto(
            response.getItemsList().stream().map(WebhookEndpointsController::toDeliveryDto).toList());

    return ResponseEntity.ok(
        new WebhookEndpointsControllerListDeliveriesV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  private tools.jackson.databind.JsonNode rawBody() {
    if (CurrentRequest.request() instanceof CachedBodyRequest cached) {
      return json.readTree(cached.body());
    }
    return json.readTree("{}");
  }

  private static WebhookEndpointResponseDto toDto(WebhookEndpointResponse endpoint) {
    return new WebhookEndpointResponseDto(
        endpoint.getId(),
        endpoint.getUrl(),
        endpoint.hasDescription() ? endpoint.getDescription() : null,
        endpoint.getEventTypesList().stream().map(WebhookEndpointsController::toEventTypesEnum).filter(java.util.Objects::nonNull).toList(),
        endpoint.getIsActive(),
        endpoint.hasDisabledReason() ? endpoint.getDisabledReason() : null,
        toOffsetDateTime(endpoint.getCreatedAt()),
        toOffsetDateTime(endpoint.getUpdatedAt()));
  }

  private static WebhookEndpointWithSecretResponseDto toWithSecretDto(WebhookEndpointWithSecretResponse response) {
    return new WebhookEndpointWithSecretResponseDto(toDto(response.getEndpoint()), response.getSecret());
  }

  private static WebhookDeliveryResponseDto toDeliveryDto(WebhookDeliveryResponse delivery) {
    return new WebhookDeliveryResponseDto(
        delivery.getId(),
        delivery.getEventId(),
        delivery.getEventType(),
        toDeliveryStatusEnum(delivery.getStatus()),
        BigDecimal.valueOf(delivery.getAttempts()),
        delivery.hasResponseStatus() ? BigDecimal.valueOf(delivery.getResponseStatus()) : null,
        delivery.hasLastError() ? delivery.getLastError() : null,
        toOffsetDateTime(delivery.getOccurredAt()),
        delivery.hasDeliveredAt() ? toOffsetDateTime(delivery.getDeliveredAt()) : null);
  }

  private static WebhookDeliveryResponseDto.StatusEnum toDeliveryStatusEnum(WebhookDeliveryStatus status) {
    return switch (status) {
      case WEBHOOK_DELIVERY_STATUS_PENDING -> WebhookDeliveryResponseDto.StatusEnum.PENDING;
      case WEBHOOK_DELIVERY_STATUS_DELIVERED -> WebhookDeliveryResponseDto.StatusEnum.DELIVERED;
      case WEBHOOK_DELIVERY_STATUS_FAILED -> WebhookDeliveryResponseDto.StatusEnum.FAILED;
      default -> null;
    };
  }

  private static NotificationType toProtoType(String value) {
    return TYPE_VALUES.entrySet().stream()
        .filter(entry -> entry.getValue().equals(value))
        .map(Map.Entry::getKey)
        .findFirst()
        .orElse(NotificationType.NOTIFICATION_TYPE_UNSPECIFIED);
  }

  private static WebhookEndpointResponseDto.EventTypesEnum toEventTypesEnum(NotificationType type) {
    String value = TYPE_VALUES.get(type);
    return value == null ? null : WebhookEndpointResponseDto.EventTypesEnum.fromValue(value);
  }

  private static WebhookEventTypesResponseDto.TypesEnum toTypesEnum(NotificationType type) {
    String value = TYPE_VALUES.get(type);
    return value == null ? null : WebhookEventTypesResponseDto.TypesEnum.fromValue(value);
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  private NotificationServiceGrpc.NotificationServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
