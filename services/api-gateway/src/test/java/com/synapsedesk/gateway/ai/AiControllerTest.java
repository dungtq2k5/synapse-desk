package com.synapsedesk.gateway.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.ticket.Ai.ClassifyTicketResponse;
import synapsedesk.ticket.Ai.GetSuggestionsResponse;
import synapsedesk.ticket.Ai.SuggestionsDegradation;
import synapsedesk.ticket.AiServiceGrpc;
import synapsedesk.ticket.Common.TicketPriority;

/**
 * `AiApi` — the narrowing-to-null mappers for the ticket priority and the
 * suggestions degradation. Neither the
 * model's UNSPECIFIED value nor an unrecognized one may surface as a REST
 * enum value the client was never told about.
 */
class AiControllerTest {

  private final AiServiceGrpc.AiServiceBlockingStub stub = mock(
    AiServiceGrpc.AiServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private AiController controller;

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
        List.of("ticket.ai.use"),
        true,
        "127.0.0.1",
        "test"
      )
    );
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );
    controller = new AiController(stub, currentUser);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void anUnspecifiedSuggestedPriorityMapsToNull() {
    when(stub.classifyTicket(any())).thenReturn(
      ClassifyTicketResponse.newBuilder()
        .setSuggestedDepartmentId("dept-1")
        .setSuggestedPriority(TicketPriority.TICKET_PRIORITY_UNSPECIFIED)
        .build()
    );

    var response = controller.aiControllerClassifyV1("ticket-1");

    assertThat(response.getBody().data().getSuggestedPriority()).isNull();
  }

  @Test
  void aRecognizedSuggestedPriorityMapsThrough() {
    when(stub.classifyTicket(any())).thenReturn(
      ClassifyTicketResponse.newBuilder()
        .setSuggestedDepartmentId("dept-1")
        .setSuggestedPriority(TicketPriority.TICKET_PRIORITY_URGENT)
        .build()
    );

    var response = controller.aiControllerClassifyV1("ticket-1");

    assertThat(response.getBody().data().getSuggestedPriority()).isEqualTo(
      com.synapsedesk.gateway.model.AiClassificationResponseDto.SuggestedPriorityEnum.URGENT
    );
  }

  @Test
  void anUnspecifiedDegradationMapsToNull() {
    when(stub.getSuggestions(any())).thenReturn(
      GetSuggestionsResponse.newBuilder()
        .setDegraded(SuggestionsDegradation.SUGGESTIONS_DEGRADATION_UNSPECIFIED)
        .build()
    );

    var response = controller.aiControllerGetSuggestionsV1("ticket-1");

    assertThat(response.getBody().data().getDegraded()).isNull();
  }

  @Test
  void aLexicalOnlyDegradationMapsThrough() {
    when(stub.getSuggestions(any())).thenReturn(
      GetSuggestionsResponse.newBuilder()
        .setDegraded(
          SuggestionsDegradation.SUGGESTIONS_DEGRADATION_LEXICAL_ONLY
        )
        .build()
    );

    var response = controller.aiControllerGetSuggestionsV1("ticket-1");

    assertThat(response.getBody().data().getDegraded()).isEqualTo(
      com.synapsedesk.gateway.model.AiSuggestionsResponseDto.DegradedEnum.LEXICAL_ONLY
    );
  }
}
