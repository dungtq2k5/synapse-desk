package com.synapsedesk.gateway.tickets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.model.AssignTicketDto;
import com.synapsedesk.gateway.model.AssignTicketToSelfDto;
import com.synapsedesk.gateway.model.MarkTicketReadDto;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.ticket.Assignment.AssignTicketToSelfRequest;
import synapsedesk.ticket.Assignment.AssignmentResponse;
import synapsedesk.ticket.Assignment.ListAssignmentsResponse;
import synapsedesk.ticket.AssignmentServiceGrpc;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Ticket.MarkTicketReadRequest;
import synapsedesk.ticket.Ticket.MarkTicketReadResponse;
import synapsedesk.ticket.Ticket.TicketStatusChangeResponse;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketsApi`'s assignment-and-read-state group (group c, part 1). The
 * sharpest property here is the sibling-code risk the whole 3-group split
 * exists to protect: {@code assign}/{@code reassign}/{@code assignToSelf}/
 * {@code unassign} are four independent literal permission checks, so a
 * copy-paste swap between any two must be caught — not by a handler-body
 * check (settled: none is needed, see {@link TicketsAssignmentService}'s
 * class docblock), but by the per-route permission check itself.
 */
class TicketsAssignmentServiceTest {

  private final AssignmentServiceGrpc.AssignmentServiceBlockingStub assignmentStub =
    mock(AssignmentServiceGrpc.AssignmentServiceBlockingStub.class);
  private final TicketServiceGrpc.TicketServiceBlockingStub ticketStub = mock(
    TicketServiceGrpc.TicketServiceBlockingStub.class
  );
  private TicketsAssignmentService service;

  private static final UUID ASSIGNEE_ID = UUID.fromString(
    "11111111-1111-4111-8111-111111111111"
  );
  private static final UUID DEPARTMENT_ID = UUID.fromString(
    "22222222-2222-4222-8222-222222222222"
  );

  private static RequestContext contextWithCodes(List<String> codes) {
    return new RequestContext(
      "agent-1",
      "org-1",
      false,
      List.of(),
      codes,
      true,
      "127.0.0.1",
      "test"
    );
  }

  @BeforeEach
  void setUp() {
    when(assignmentStub.withDeadlineAfter(anyLong(), any())).thenReturn(
      assignmentStub
    );
    when(assignmentStub.withInterceptors(any())).thenReturn(assignmentStub);
    when(ticketStub.withDeadlineAfter(anyLong(), any())).thenReturn(ticketStub);
    when(ticketStub.withInterceptors(any())).thenReturn(ticketStub);
    service = new TicketsAssignmentService(assignmentStub, ticketStub);
  }

  @Test
  void assignRequiresTicketAssignNotTicketAssignSelf() {
    assertThatThrownBy(() ->
      service.assign(
        contextWithCodes(List.of("ticket.assign.self")),
        "ticket-1",
        assignDto()
      )
    ).isInstanceOf(ResponseStatusException.class);
    verify(assignmentStub, never()).assignTicket(any());

    when(assignmentStub.assignTicket(any())).thenReturn(wireAssignment());
    var response = service.assign(
      contextWithCodes(List.of("ticket.assign")),
      "ticket-1",
      assignDto()
    );
    assertThat(response.getStatusCode().value()).isEqualTo(200);
  }

  @Test
  void reassignRequiresTicketReassignNotTicketAssign() {
    assertThatThrownBy(() ->
      service.reassign(
        contextWithCodes(List.of("ticket.assign")),
        "ticket-1",
        assignDto()
      )
    ).isInstanceOf(ResponseStatusException.class);
    verify(assignmentStub, never()).reassignTicket(any());

    when(assignmentStub.reassignTicket(any())).thenReturn(wireAssignment());
    var response = service.reassign(
      contextWithCodes(List.of("ticket.reassign")),
      "ticket-1",
      assignDto()
    );
    assertThat(response.getStatusCode().value()).isEqualTo(200);
  }

  @Test
  void assignToSelfRequiresTicketAssignSelfNotTicketAssign() {
    AssignTicketToSelfDto dto = new AssignTicketToSelfDto();
    dto.setDepartmentId(DEPARTMENT_ID);

    assertThatThrownBy(() ->
      service.assignToSelf(
        contextWithCodes(List.of("ticket.assign")),
        "ticket-1",
        dto
      )
    ).isInstanceOf(ResponseStatusException.class);
    verify(assignmentStub, never()).assignTicketToSelf(any());

    when(assignmentStub.assignTicketToSelf(any())).thenReturn(wireAssignment());
    var response = service.assignToSelf(
      contextWithCodes(List.of("ticket.assign.self")),
      "ticket-1",
      dto
    );
    assertThat(response.getStatusCode().value()).isEqualTo(200);
  }

  @Test
  void assignToSelfDtoCarriesNoAssigneeFieldSoOnlyTheDepartmentIdReachesTheWire() {
    when(assignmentStub.assignTicketToSelf(any())).thenReturn(wireAssignment());
    AssignTicketToSelfDto dto = new AssignTicketToSelfDto();
    dto.setDepartmentId(DEPARTMENT_ID);

    service.assignToSelf(
      contextWithCodes(List.of("ticket.assign.self")),
      "ticket-1",
      dto
    );

    ArgumentCaptor<AssignTicketToSelfRequest> captor = ArgumentCaptor.forClass(
      AssignTicketToSelfRequest.class
    );
    verify(assignmentStub).assignTicketToSelf(captor.capture());
    assertThat(captor.getValue().getTicketId()).isEqualTo("ticket-1");
    assertThat(captor.getValue().getDepartmentId()).isEqualTo(
      DEPARTMENT_ID.toString()
    );
  }

  @Test
  void unassignRequiresTicketAssign() {
    assertThatThrownBy(() ->
      service.unassign(
        contextWithCodes(List.of("ticket.assign.self")),
        "ticket-1"
      )
    ).isInstanceOf(ResponseStatusException.class);
    verify(assignmentStub, never()).unassignTicket(any());

    var response = service.unassign(
      contextWithCodes(List.of("ticket.assign")),
      "ticket-1"
    );
    assertThat(response.getStatusCode().value()).isEqualTo(204);
  }

  @Test
  void listAssignmentsNeedsNoPermissionCheck() {
    when(assignmentStub.listAssignments(any())).thenReturn(
      ListAssignmentsResponse.getDefaultInstance()
    );

    var response = service.listAssignments(
      contextWithCodes(List.of()),
      "ticket-1"
    );

    assertThat(response.getStatusCode().value()).isEqualTo(200);
  }

  @Test
  void markReadForwardsAnExplicitReadAtVerbatim() {
    OffsetDateTime readAt = OffsetDateTime.parse("2026-09-01T00:00:00Z");
    when(ticketStub.markTicketRead(any())).thenReturn(
      MarkTicketReadResponse.newBuilder()
        .setLastReadAt(TicketsCrudService.toTimestamp(readAt))
        .build()
    );
    MarkTicketReadDto dto = new MarkTicketReadDto();
    dto.setReadAt(readAt);

    service.markRead(contextWithCodes(List.of()), "ticket-1", dto);

    ArgumentCaptor<MarkTicketReadRequest> captor = ArgumentCaptor.forClass(
      MarkTicketReadRequest.class
    );
    verify(ticketStub).markTicketRead(captor.capture());
    assertThat(captor.getValue().hasReadAt()).isTrue();
    assertThat(captor.getValue().getReadAt()).isEqualTo(
      TicketsCrudService.toTimestamp(readAt)
    );
  }

  @Test
  void markReadNeverDefaultsAnAbsentReadAt() {
    when(ticketStub.markTicketRead(any())).thenReturn(
      MarkTicketReadResponse.newBuilder()
        .setLastReadAt(Timestamp.getDefaultInstance())
        .build()
    );
    MarkTicketReadDto dto = new MarkTicketReadDto();

    service.markRead(contextWithCodes(List.of()), "ticket-1", dto);

    ArgumentCaptor<MarkTicketReadRequest> captor = ArgumentCaptor.forClass(
      MarkTicketReadRequest.class
    );
    verify(ticketStub).markTicketRead(captor.capture());
    assertThat(captor.getValue().hasReadAt()).isFalse();
  }

  @Test
  void listStatusChangesUsesTheIdFieldNameNotTicketId() {
    when(ticketStub.listTicketStatusChanges(any())).thenReturn(
      synapsedesk.ticket.Ticket.ListTicketStatusChangesResponse.newBuilder()
        .addItems(
          TicketStatusChangeResponse.newBuilder()
            .setId("row-1")
            .setTicketId("ticket-1")
            .setToStatus(TicketStatus.TICKET_STATUS_OPEN)
            .setChangedById("agent-1")
            .setChangedAt(Timestamp.getDefaultInstance())
            .build()
        )
        .build()
    );

    var response = service.listStatusChanges(
      contextWithCodes(List.of()),
      "ticket-1"
    );

    assertThat(response.getBody().data()).hasSize(1);
  }

  private static AssignTicketDto assignDto() {
    AssignTicketDto dto = new AssignTicketDto();
    dto.setAssigneeId(ASSIGNEE_ID);
    dto.setDepartmentId(DEPARTMENT_ID);
    return dto;
  }

  private static AssignmentResponse wireAssignment() {
    Timestamp now = Timestamp.newBuilder().setSeconds(1_756_684_800).build();
    return AssignmentResponse.newBuilder()
      .setId("assignment-1")
      .setTicketId("ticket-1")
      .setAssignedToId(ASSIGNEE_ID.toString())
      .setAssignedById("agent-1")
      .setDepartmentId(DEPARTMENT_ID.toString())
      .setAssignedAt(now)
      .setIsCurrent(true)
      .setCreatedAt(now)
      .build();
  }
}
