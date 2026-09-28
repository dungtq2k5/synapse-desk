package com.synapsedesk.gateway.webhookendpoints;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.UpdateWebhookEndpointDto;
import com.synapsedesk.gateway.web.CachedBodyRequest;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.notification.Notification.UpdateWebhookEndpointRequest;
import synapsedesk.notification.Notification.WebhookEndpointResponse;
import synapsedesk.notification.NotificationServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `WebhookEndpointsApi` — {@code update}'s {@code eventTypes} presence
 * check, ported from the same absent-vs-empty problem
 * `OrganizationsController.updateSettings` solved: proto3 cannot tell an
 * absent repeated field from an empty one, so "leave the subscriptions
 * alone" and "replace with zero subscriptions" (itself refused downstream,
 * but that is notification-service's call to make, not the gateway's to
 * pre-empt) must travel as different wire shapes — decided by whether the
 * RAW body named the key, never by the bound DTO's always-populated default
 * empty list.
 */
class WebhookEndpointsControllerTest {

  private final NotificationServiceGrpc.NotificationServiceBlockingStub stub =
    mock(NotificationServiceGrpc.NotificationServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private WebhookEndpointsController controller;

  private static void requestWithBody(String json) {
    MockHttpServletRequest request = new MockHttpServletRequest();
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(
        new CachedBodyRequest(request, json.getBytes(StandardCharsets.UTF_8))
      )
    );
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.require(any())).thenReturn(
      new RequestContext(
        "agent-1",
        "org-1",
        false,
        List.of(),
        List.of("organization.update"),
        true,
        "127.0.0.1",
        "test"
      )
    );
    controller = new WebhookEndpointsController(
      stub,
      currentUser,
      new ObjectMapper()
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void anAbsentEventTypesLeavesSubscriptionsUntouchedOnTheWire() {
    requestWithBody("{\"isActive\": false}");
    when(stub.updateWebhookEndpoint(any())).thenReturn(
      WebhookEndpointResponse.getDefaultInstance()
    );

    controller.webhookEndpointsControllerUpdateV1(
      "endpoint-1",
      new UpdateWebhookEndpointDto()
    );

    org.mockito.ArgumentCaptor<UpdateWebhookEndpointRequest> captor =
      org.mockito.ArgumentCaptor.forClass(UpdateWebhookEndpointRequest.class);
    org.mockito.Mockito.verify(stub).updateWebhookEndpoint(captor.capture());
    assertThat(captor.getValue().hasEventTypes()).isFalse();
  }

  @Test
  void anExplicitEmptyEventTypesArrayIsRefusedBeforeReachingThePeer() {
    // The exact case a plain `List.of()` default cannot distinguish from
    // "not sent" — the raw-body check exists to catch it, and this is the
    // one place the controller must enforce the "min 1" rule itself: the
    // generated `@Size(min = 1)` on this getter is dropped for this
    // property (ValidationConfig) because it can't tell "absent" from
    // "explicit `[]`" either — both bind to the same default empty list.
    requestWithBody("{\"eventTypes\": []}");
    UpdateWebhookEndpointDto dto = new UpdateWebhookEndpointDto();
    dto.setEventTypes(List.of());

    org.junit.jupiter.api.Assertions.assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () -> controller.webhookEndpointsControllerUpdateV1("endpoint-1", dto)
    );

    org.mockito.Mockito.verify(
      stub,
      org.mockito.Mockito.never()
    ).updateWebhookEndpoint(any());
  }

  @Test
  void aPresentEventTypesArraySetsTheWrapperWithValues() {
    requestWithBody("{\"eventTypes\": [\"ticket.assigned\"]}");
    UpdateWebhookEndpointDto dto = new UpdateWebhookEndpointDto();
    dto.setEventTypes(
      List.of(UpdateWebhookEndpointDto.EventTypesEnum.TICKET_ASSIGNED)
    );
    when(stub.updateWebhookEndpoint(any())).thenReturn(
      WebhookEndpointResponse.getDefaultInstance()
    );

    controller.webhookEndpointsControllerUpdateV1("endpoint-1", dto);

    org.mockito.ArgumentCaptor<UpdateWebhookEndpointRequest> captor =
      org.mockito.ArgumentCaptor.forClass(UpdateWebhookEndpointRequest.class);
    org.mockito.Mockito.verify(stub).updateWebhookEndpoint(captor.capture());
    assertThat(
      captor.getValue().getEventTypes().getValuesList()
    ).containsExactly(
      synapsedesk.notification.Notification.NotificationType.NOTIFICATION_TYPE_TICKET_ASSIGNED
    );
  }
}
