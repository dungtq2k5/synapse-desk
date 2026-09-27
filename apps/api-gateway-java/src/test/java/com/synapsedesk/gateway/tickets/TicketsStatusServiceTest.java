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
import com.synapsedesk.gateway.generated.model.BulkTicketPriorityDto;
import com.synapsedesk.gateway.generated.model.BulkTicketStatusDto;
import com.synapsedesk.gateway.generated.model.BulkTicketStatusResponseDto;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Ticket.BulkTicketFailure;
import synapsedesk.ticket.Ticket.BulkTicketStatusRequest;
import synapsedesk.ticket.Ticket.BulkTicketStatusResponse;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketsApi`'s status-state-machine-and-bulk group (group b of 3). Two
 * properties matter more here than anywhere else in the interface: the
 * bulk ops' partial-success envelope must survive at the ITEM level (an
 * operation that silently drops a `failed[]` row is indistinguishable from
 * one that succeeded, the same "200 with more data" risk class this port
 * keeps finding — here inverted into "200 with a MISSING failure"); and
 * `escalate` must stay permission-FREE, since it is a deliberate correction
 * in Node, not an oversight a reader might "fix" by adding a guard.
 */
class TicketsStatusServiceTest {

  private final TicketServiceGrpc.TicketServiceBlockingStub stub = mock(TicketServiceGrpc.TicketServiceBlockingStub.class);
  private TicketsStatusService service;

  private static RequestContext contextWithCodes(List<String> codes) {
    return new RequestContext("agent-1", "org-1", false, List.of(), codes, true, "127.0.0.1", "test");
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    service = new TicketsStatusService(stub);
  }

  @Test
  void bulkChangeStatusPreservesThePartialSuccessEnvelopeAtTheItemLevel() {
    when(stub.bulkChangeTicketStatus(any())).thenReturn(
        BulkTicketStatusResponse.newBuilder()
            .addUpdated("11111111-1111-4111-8111-111111111111")
            .addFailed(
                BulkTicketFailure.newBuilder()
                    .setId("22222222-2222-4222-8222-222222222222")
                    .setReason("already CLOSED"))
            .build());
    BulkTicketStatusDto dto = new BulkTicketStatusDto();
    dto.setTicketIds(
        List.of(
            UUID.fromString("11111111-1111-4111-8111-111111111111"),
            UUID.fromString("22222222-2222-4222-8222-222222222222")));
    dto.setStatus(BulkTicketStatusDto.StatusEnum.OPEN);

    var response = service.bulkChangeStatus(contextWithCodes(List.of("ticket.update")), dto);

    assertThat(response.getStatusCode().value()).isEqualTo(200);
    BulkTicketStatusResponseDto data = response.getBody().getData();
    assertThat(data.getUpdated()).containsExactly("11111111-1111-4111-8111-111111111111");
    assertThat(data.getFailed()).hasSize(1);
    assertThat(data.getFailed().get(0).getId()).isEqualTo("22222222-2222-4222-8222-222222222222");
    assertThat(data.getFailed().get(0).getReason()).isEqualTo("already CLOSED");
  }

  @Test
  void bulkChangeStatusRefusesMoreThanFiftyTicketIds() {
    BulkTicketStatusDto dto = new BulkTicketStatusDto();
    List<UUID> ids = new ArrayList<>();
    for (int i = 0; i < 51; i++) {
      ids.add(UUID.randomUUID());
    }
    dto.setTicketIds(ids);
    dto.setStatus(BulkTicketStatusDto.StatusEnum.OPEN);

    assertThatThrownBy(() -> service.bulkChangeStatus(contextWithCodes(List.of("ticket.update")), dto))
        .isInstanceOf(ResponseStatusException.class);

    verify(stub, org.mockito.Mockito.never()).bulkChangeTicketStatus(any());
  }

  @Test
  void bulkChangeStatusForwardsTheReasonWhenPresent() {
    when(stub.bulkChangeTicketStatus(any())).thenReturn(BulkTicketStatusResponse.getDefaultInstance());
    BulkTicketStatusDto dto = new BulkTicketStatusDto();
    dto.setTicketIds(List.of(UUID.randomUUID()));
    dto.setStatus(BulkTicketStatusDto.StatusEnum.OPEN);
    dto.setReason("queue cleanup");

    service.bulkChangeStatus(contextWithCodes(List.of("ticket.update")), dto);

    ArgumentCaptor<BulkTicketStatusRequest> captor = ArgumentCaptor.forClass(BulkTicketStatusRequest.class);
    verify(stub).bulkChangeTicketStatus(captor.capture());
    assertThat(captor.getValue().getReason()).isEqualTo("queue cleanup");
  }

  @Test
  void bulkChangePriorityRefusesForACallerWithoutTicketUpdate() {
    BulkTicketPriorityDto dto = new BulkTicketPriorityDto();
    dto.setTicketIds(List.of(UUID.randomUUID()));
    dto.setPriority(BulkTicketPriorityDto.PriorityEnum.HIGH);

    assertThatThrownBy(() -> service.bulkChangePriority(contextWithCodes(List.of()), dto))
        .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void escalateNeedsNoPermissionAtAll() {
    when(stub.escalateTicket(any())).thenReturn(wireTicket());

    var response = service.escalate(contextWithCodes(List.of()), "ticket-1", null);

    assertThat(response.getStatusCode().value()).isEqualTo(200);
  }

  @Test
  void resolveRefusesForACallerHoldingOnlyTicketUpdate() {
    // `ticket.resolve` is a stronger, distinct right from `ticket.update` —
    // reopening and resolving are gated differently on purpose.
    assertThatThrownBy(
            () -> service.resolve(contextWithCodes(List.of("ticket.update")), "ticket-1", null))
        .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void reopenAcceptsTicketUpdateNotTicketResolve() {
    when(stub.reopenTicket(any())).thenReturn(wireTicket());

    var response = service.reopen(contextWithCodes(List.of("ticket.update")), "ticket-1", null);

    assertThat(response.getStatusCode().value()).isEqualTo(200);
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
        .setTitle("Title")
        .setDescription("desc")
        .setUnreadCount(0)
        .setCreatedAt(now)
        .setUpdatedAt(now)
        .build();
  }
}
