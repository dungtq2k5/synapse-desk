package com.synapsedesk.gateway.modules.webhookendpoints;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.modules.webhookendpoints.dto.rest.UpdateWebhookEndpointDto;
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

/**
 * {@code update}'s {@code eventTypes} on the wire: proto3 cannot tell an absent
 * repeated field from an empty one, so "leave the subscriptions alone" and
 * "replace them" must travel as different shapes, decided by whether the DTO's
 * list is {@code null} (not sent) or present. An empty list never gets this far:
 * the DTO's {@code @Size(min = 1)} refuses it (see {@code ValidationConfigTest}
 * and the contract rows).
 */
class WebhookEndpointsControllerTest {

  private final NotificationServiceGrpc.NotificationServiceBlockingStub stub =
    mock(NotificationServiceGrpc.NotificationServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private WebhookEndpointsController controller;

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
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );
    controller = new WebhookEndpointsController(stub, currentUser);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void anAbsentEventTypesLeavesSubscriptionsUntouchedOnTheWire() {
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
  void aPresentEventTypesArraySetsTheWrapperWithValues() {
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
