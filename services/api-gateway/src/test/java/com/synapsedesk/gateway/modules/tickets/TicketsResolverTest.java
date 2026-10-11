package com.synapsedesk.gateway.modules.tickets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.graphql.UserSummaryGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketMessageGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketMutationPayloadGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketPriorityGql;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketSourceGql;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketStatusGql;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.ticket.Assignment.AssignTicketRequest;
import synapsedesk.ticket.AssignmentServiceGrpc;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Message.ListMessagesRequest;
import synapsedesk.ticket.Message.ListMessagesResponse;
import synapsedesk.ticket.Message.MessageResponse;
import synapsedesk.ticket.MessageServiceGrpc;
import synapsedesk.ticket.Ticket.ChangeTicketStatusRequest;
import synapsedesk.ticket.Ticket.GetTicketRequest;
import synapsedesk.ticket.Ticket.ListTicketsRequest;
import synapsedesk.ticket.Ticket.ListTicketsResponse;
import synapsedesk.ticket.Ticket.TicketStatusActionRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/** `Query.ticket`/`tickets`, the `Ticket` edges, and the three mutations. */
class TicketsResolverTest {

  private final TicketServiceGrpc.TicketServiceBlockingStub ticketStub = mock(
    TicketServiceGrpc.TicketServiceBlockingStub.class
  );
  private final MessageServiceGrpc.MessageServiceBlockingStub messageStub =
    mock(MessageServiceGrpc.MessageServiceBlockingStub.class);
  private final AssignmentServiceGrpc.AssignmentServiceBlockingStub assignmentStub =
    mock(AssignmentServiceGrpc.AssignmentServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private TicketsResolver resolver;

  private static RequestContext context() {
    return new RequestContext(
      "agent-1",
      "11111111-1111-4111-8111-111111111111",
      false,
      List.of(),
      List.of("ticket.assign", "ticket.update"),
      true,
      "127.0.0.1",
      "test"
    );
  }

  private static TicketResponse.Builder baseTicket(String id) {
    return TicketResponse.newBuilder()
      .setId(id)
      .setTicketNumber(42)
      .setOrganizationId("org-1")
      .setAuthorId("author-1")
      .setTitle("Broken widget")
      .setDescription("It broke")
      .setUnreadCount(0)
      .setCreatedAt(com.google.protobuf.Timestamp.getDefaultInstance())
      .setUpdatedAt(com.google.protobuf.Timestamp.getDefaultInstance());
  }

  @BeforeEach
  void setUp() {
    when(ticketStub.withDeadlineAfter(anyLong(), any())).thenReturn(ticketStub);
    when(ticketStub.withInterceptors(any())).thenReturn(ticketStub);
    when(messageStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      messageStub
    );
    when(messageStub.withInterceptors(any())).thenReturn(messageStub);
    when(assignmentStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      assignmentStub
    );
    when(assignmentStub.withInterceptors(any())).thenReturn(assignmentStub);
    when(currentUser.require(any())).thenReturn(context());
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(mock(HttpServletRequest.class))
    );
    resolver = new TicketsResolver(
      ticketStub,
      messageStub,
      assignmentStub,
      currentUser
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void ticketMapsAFoundResponse() {
    when(ticketStub.getTicket(any())).thenReturn(baseTicket("t1").build());

    TicketGqlDto result = resolver.ticket("t1");

    ArgumentCaptor<GetTicketRequest> captor = ArgumentCaptor.forClass(
      GetTicketRequest.class
    );
    verify(ticketStub).getTicket(captor.capture());
    assertThat(captor.getValue().getId()).isEqualTo("t1");
    assertThat(result.id()).isEqualTo("t1");
  }

  @Test
  void ticketReturnsNullWhenTheStatusIsNotOk() {
    when(ticketStub.getTicket(any())).thenThrow(
      new io.grpc.StatusRuntimeException(io.grpc.Status.NOT_FOUND)
    );

    assertThat(resolver.ticket("missing")).isNull();
  }

  @Test
  void ticketsNeverAsksForDeletedTicketsAndPassesEveryFilter() {
    when(ticketStub.listTickets(any())).thenReturn(
      ListTicketsResponse.newBuilder()
        .setMeta(synapsedesk.auth.Common.PageMeta.getDefaultInstance())
        .build()
    );

    resolver.tickets(
      10,
      1,
      "createdAt",
      TicketStatusGql.OPEN,
      TicketPriorityGql.HIGH,
      TicketSourceGql.CHAT,
      "assignee-1",
      "dept-1",
      "author-1"
    );

    ArgumentCaptor<ListTicketsRequest> captor = ArgumentCaptor.forClass(
      ListTicketsRequest.class
    );
    verify(ticketStub).listTickets(captor.capture());
    ListTicketsRequest sent = captor.getValue();
    assertThat(sent.getIncludeDeleted()).isFalse();
    assertThat(sent.getStatus()).isEqualTo(TicketStatus.TICKET_STATUS_OPEN);
    assertThat(sent.getAssigneeId()).isEqualTo("assignee-1");
    assertThat(sent.getDepartmentId()).isEqualTo("dept-1");
    assertThat(sent.getAuthorId()).isEqualTo("author-1");
  }

  @Test
  void assigneeIsNullWithNoLoaderCallWhenUnassigned() throws Exception {
    TicketGqlDto ticket = ticketWith(null, "author-1", "dept-1");
    @SuppressWarnings("unchecked")
    DataLoader<String, UserSummaryGqlDto> loader = mock(DataLoader.class);

    CompletableFuture<UserSummaryGqlDto> result = resolver.assignee(
      ticket,
      loader
    );

    assertThat(result.get(1, TimeUnit.SECONDS)).isNull();
    verifyNoInteractions(loader);
  }

  @Test
  void assigneeLoadsThroughTheLoaderWhenPresent() {
    TicketGqlDto ticket = ticketWith("agent-9", "author-1", "dept-1");
    @SuppressWarnings("unchecked")
    DataLoader<String, UserSummaryGqlDto> loader = mock(DataLoader.class);
    when(loader.load(any(), any())).thenReturn(
      CompletableFuture.completedFuture(null)
    );

    resolver.assignee(ticket, loader);

    verify(loader).load(org.mockito.ArgumentMatchers.eq("agent-9"), any());
  }

  @Test
  void messagesCallsTheServiceDirectlyNotALoader() {
    TicketGqlDto ticket = ticketWith("agent-9", "author-1", "dept-1");
    when(messageStub.listMessages(any())).thenReturn(
      ListMessagesResponse.newBuilder()
        .addItems(
          MessageResponse.newBuilder()
            .setId("m1")
            .setContent("hi")
            .setCreatedAt(com.google.protobuf.Timestamp.getDefaultInstance())
            .build()
        )
        .build()
    );

    List<TicketMessageGqlDto> result = resolver.messages(ticket, 50);

    ArgumentCaptor<ListMessagesRequest> captor = ArgumentCaptor.forClass(
      ListMessagesRequest.class
    );
    verify(messageStub).listMessages(captor.capture());
    assertThat(captor.getValue().getTicketId()).isEqualTo(ticket.id());
    assertThat(result).hasSize(1);
    assertThat(result.get(0).id()).isEqualTo("m1");
  }

  @Test
  void assignTicketAssignsThenRereadsTheTicket() {
    when(ticketStub.getTicket(any())).thenReturn(baseTicket("t1").build());

    TicketMutationPayloadGqlDto payload = resolver.assignTicket(
      "t1",
      "agent-9",
      "dept-1"
    );

    ArgumentCaptor<AssignTicketRequest> captor = ArgumentCaptor.forClass(
      AssignTicketRequest.class
    );
    verify(assignmentStub).assignTicket(captor.capture());
    assertThat(captor.getValue().getTicketId()).isEqualTo("t1");
    assertThat(captor.getValue().getAssigneeId()).isEqualTo("agent-9");
    assertThat(captor.getValue().getDepartmentId()).isEqualTo("dept-1");
    verify(ticketStub, times(1)).getTicket(any());
    assertThat(payload.ticket().id()).isEqualTo("t1");
    assertThat(payload.message()).isEqualTo("Ticket assigned");
  }

  @Test
  void escalateTicketCarriesNoReason() {
    when(ticketStub.escalateTicket(any())).thenReturn(baseTicket("t1").build());

    TicketMutationPayloadGqlDto payload = resolver.escalateTicket("t1");

    ArgumentCaptor<TicketStatusActionRequest> captor = ArgumentCaptor.forClass(
      TicketStatusActionRequest.class
    );
    verify(ticketStub).escalateTicket(captor.capture());
    assertThat(captor.getValue().getTicketId()).isEqualTo("t1");
    assertThat(captor.getValue().hasReason()).isFalse();
    assertThat(payload.message()).isEqualTo("Handed off to an agent");
  }

  @Test
  void transitionTicketStatusSendsTheProtoStatusAndReason() {
    when(ticketStub.changeTicketStatus(any())).thenReturn(
      baseTicket("t1").setStatus(TicketStatus.TICKET_STATUS_RESOLVED).build()
    );

    TicketMutationPayloadGqlDto payload = resolver.transitionTicketStatus(
      "t1",
      TicketStatusGql.RESOLVED,
      "fixed it"
    );

    ArgumentCaptor<ChangeTicketStatusRequest> captor = ArgumentCaptor.forClass(
      ChangeTicketStatusRequest.class
    );
    verify(ticketStub).changeTicketStatus(captor.capture());
    assertThat(captor.getValue().getId()).isEqualTo("t1");
    assertThat(captor.getValue().getStatus()).isEqualTo(
      TicketStatus.TICKET_STATUS_RESOLVED
    );
    assertThat(captor.getValue().getReason()).isEqualTo("fixed it");
    assertThat(payload.message()).isEqualTo("Status set to RESOLVED");
  }

  private static TicketGqlDto ticketWith(
    String assigneeId,
    String authorId,
    String departmentId
  ) {
    return new TicketGqlDto(
      "t1",
      1,
      "org-1",
      authorId,
      TicketSourceGql.WEB,
      TicketStatusGql.OPEN,
      TicketPriorityGql.LOW,
      "t",
      "d",
      assigneeId,
      departmentId,
      null,
      null,
      0,
      null,
      null,
      null,
      null
    );
  }
}
