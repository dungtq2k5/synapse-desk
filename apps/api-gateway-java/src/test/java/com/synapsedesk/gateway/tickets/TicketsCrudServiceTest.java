package com.synapsedesk.gateway.tickets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.UpdateTicketDto;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Ticket.ListTicketsRequest;
import synapsedesk.ticket.Ticket.ListTicketsResponse;
import synapsedesk.ticket.Ticket.UpdateTicketRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketsApi`'s CRUD-and-plain-reads group (group a of 3). Sharpest
 * properties: {@code includeDeleted} refuses rather than silently
 * downgrading for a caller without {@code ticket.delete} (the same
 * "wrong-behaviour-returns-200-with-more-data" risk this session has found
 * repeatedly — here inverted: the risk is returning MORE without the
 * caller earning it, so the guard must REFUSE, not fall back to a narrower
 * read the caller never asked for); and {@code update}'s {@code priority}
 * field, which is NOT `optional` on the wire — unlike `title`/`description`
 * — so an absent DTO value must still be sent, mapped to {@code
 * TICKET_PRIORITY_UNSPECIFIED}, never simply omitted.
 */
class TicketsCrudServiceTest {

  private final TicketServiceGrpc.TicketServiceBlockingStub stub = mock(
    TicketServiceGrpc.TicketServiceBlockingStub.class
  );
  private TicketsCrudService service;

  private static RequestContext contextWithCodes(
    boolean superAdmin,
    List<String> codes
  ) {
    return new RequestContext(
      "agent-1",
      "org-1",
      superAdmin,
      List.of(),
      codes,
      true,
      "127.0.0.1",
      "test"
    );
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    service = new TicketsCrudService(stub);
  }

  @Test
  void includeDeletedIsRefusedForACallerWithoutTicketDelete() {
    RequestContext context = contextWithCodes(false, List.of());

    assertThatThrownBy(() ->
      service.list(
        context,
        java.math.BigDecimal.ONE,
        java.math.BigDecimal.TEN,
        "ASC",
        null,
        "createdAt",
        true,
        null,
        null,
        null,
        null,
        null,
        null
      )
    ).isInstanceOf(ResponseStatusException.class);

    verify(stub, org.mockito.Mockito.never()).listTickets(any());
  }

  @Test
  void includeDeletedIsAllowedForACallerHoldingTicketDelete() {
    when(stub.listTickets(any())).thenReturn(
      ListTicketsResponse.getDefaultInstance()
    );
    RequestContext context = contextWithCodes(false, List.of("ticket.delete"));

    service.list(
      context,
      java.math.BigDecimal.ONE,
      java.math.BigDecimal.TEN,
      "ASC",
      null,
      "createdAt",
      true,
      null,
      null,
      null,
      null,
      null,
      null
    );

    ArgumentCaptor<ListTicketsRequest> captor = ArgumentCaptor.forClass(
      ListTicketsRequest.class
    );
    verify(stub).listTickets(captor.capture());
    assertThat(captor.getValue().getIncludeDeleted()).isTrue();
  }

  @Test
  void includeDeletedIsAllowedForASuperAdminWithNoTicketPermissions() {
    when(stub.listTickets(any())).thenReturn(
      ListTicketsResponse.getDefaultInstance()
    );
    RequestContext context = contextWithCodes(true, List.of());

    service.list(
      context,
      java.math.BigDecimal.ONE,
      java.math.BigDecimal.TEN,
      "ASC",
      null,
      "createdAt",
      true,
      null,
      null,
      null,
      null,
      null,
      null
    );

    verify(stub).listTickets(any());
  }

  @Test
  void includeDeletedFalseNeedsNoPermissionAtAll() {
    when(stub.listTickets(any())).thenReturn(
      ListTicketsResponse.getDefaultInstance()
    );
    RequestContext context = contextWithCodes(false, List.of());

    service.list(
      context,
      java.math.BigDecimal.ONE,
      java.math.BigDecimal.TEN,
      "ASC",
      null,
      "createdAt",
      false,
      null,
      null,
      null,
      null,
      null,
      null
    );

    verify(stub).listTickets(any());
  }

  @Test
  void anAbsentPriorityIsUnspecifiedOnTheWireEvenThoughTheFieldIsNeverExplicitlySet() {
    when(stub.updateTicket(any())).thenReturn(wireTicket());
    RequestContext context = contextWithCodes(false, List.of("ticket.update"));
    UpdateTicketDto dto = new UpdateTicketDto();
    dto.setTitle("New title");

    service.update(context, "ticket-1", dto);

    ArgumentCaptor<UpdateTicketRequest> captor = ArgumentCaptor.forClass(
      UpdateTicketRequest.class
    );
    verify(stub).updateTicket(captor.capture());
    assertThat(captor.getValue().getPriority()).isEqualTo(
      TicketPriority.TICKET_PRIORITY_UNSPECIFIED
    );
    assertThat(captor.getValue().getTitle()).isEqualTo("New title");
    assertThat(captor.getValue().hasDescription()).isFalse();
  }

  @Test
  void updateRefusesForACallerWithoutTicketUpdate() {
    RequestContext context = contextWithCodes(false, List.of());
    UpdateTicketDto dto = new UpdateTicketDto();

    assertThatThrownBy(() ->
      service.update(context, "ticket-1", dto)
    ).isInstanceOf(ResponseStatusException.class);

    verify(stub, org.mockito.Mockito.never()).updateTicket(any());
  }

  @Test
  void anUnrecognizedStatusFilterIsRefused() {
    RequestContext context = contextWithCodes(false, List.of());

    assertThatThrownBy(() ->
      service.list(
        context,
        java.math.BigDecimal.ONE,
        java.math.BigDecimal.TEN,
        "ASC",
        null,
        "createdAt",
        false,
        "NOT_A_REAL_STATUS",
        null,
        null,
        null,
        null,
        null
      )
    ).isInstanceOf(ResponseStatusException.class);
  }

  private static TicketResponse wireTicket() {
    Timestamp now = Timestamp.newBuilder().setSeconds(1_756_684_800).build();
    return TicketResponse.newBuilder()
      .setId("ticket-1")
      .setTicketNumber(1)
      .setOrganizationId("org-1")
      .setAuthorId("author-1")
      .setSource(TicketSource.TICKET_SOURCE_WEB)
      .setStatus(TicketStatus.TICKET_STATUS_NEW)
      .setPriority(TicketPriority.TICKET_PRIORITY_MEDIUM)
      .setTitle("New title")
      .setDescription("desc")
      .setUnreadCount(0)
      .setCreatedAt(now)
      .setUpdatedAt(now)
      .build();
  }
}
