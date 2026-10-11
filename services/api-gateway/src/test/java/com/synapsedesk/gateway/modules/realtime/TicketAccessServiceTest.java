package com.synapsedesk.gateway.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.HandshakeData;
import com.corundumstudio.socketio.SocketIOClient;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import io.netty.handler.codec.http.DefaultHttpHeaders;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketAccessService`'s authorization table — same author/assignee rule
 * for both, with `ticket.read.all` and the closed-status refusal being the
 * two axes that split `canRead` from `canWrite`.
 */
class TicketAccessServiceTest {

  private final TicketServiceGrpc.TicketServiceBlockingStub stub = mock(
    TicketServiceGrpc.TicketServiceBlockingStub.class
  );
  private final TicketAccessService access = new TicketAccessService(stub);

  @BeforeEach
  void wireStubChaining() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
  }

  private static SocketIOClient client() {
    SocketIOClient client = mock(SocketIOClient.class);
    HandshakeData handshake = new HandshakeData(
      new DefaultHttpHeaders(),
      Map.of(),
      new InetSocketAddress(0),
      "/ws",
      false
    );
    when(client.getHandshakeData()).thenReturn(handshake);

    return client;
  }

  private static JwtPrincipal principal(List<String> permissionCodes) {
    return new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      permissionCodes,
      true,
      false
    );
  }

  @Test
  void canReadIsTrueForTheAuthor() {
    when(stub.getTicket(any())).thenReturn(
      TicketResponse.newBuilder().setAuthorId("u1").build()
    );

    assertThat(access.canRead("t1", principal(List.of()), client())).isTrue();
  }

  @Test
  void canReadIsTrueForTheCurrentAssignee() {
    when(stub.getTicket(any())).thenReturn(
      TicketResponse.newBuilder()
        .setAuthorId("someone-else")
        .setCurrentAssigneeId("u1")
        .build()
    );

    assertThat(access.canRead("t1", principal(List.of()), client())).isTrue();
  }

  @Test
  void canReadIsFalseForAPastAssigneeOnlyReflectedElsewhere() {
    // No currentAssigneeId set — a past assignee is not a current one.
    when(stub.getTicket(any())).thenReturn(
      TicketResponse.newBuilder().setAuthorId("someone-else").build()
    );

    assertThat(access.canRead("t1", principal(List.of()), client())).isFalse();
  }

  @Test
  void canReadIsTrueForTicketReadAllOnAnyInTenantTicket() {
    when(stub.getTicket(any())).thenReturn(
      TicketResponse.newBuilder().setAuthorId("someone-else").build()
    );

    assertThat(
      access.canRead("t1", principal(List.of("ticket.read.all")), client())
    ).isTrue();
  }

  @Test
  void canReadFailsClosedWhenTheRpcThrows() {
    when(stub.getTicket(any())).thenThrow(new RuntimeException("unavailable"));

    assertThat(access.canRead("t1", principal(List.of()), client())).isFalse();
  }

  @Test
  void canWriteExcludesTicketReadAllDeliberately() {
    when(stub.getTicket(any())).thenReturn(
      TicketResponse.newBuilder().setAuthorId("someone-else").build()
    );

    assertThat(
      access.canWrite("t1", principal(List.of("ticket.read.all")), client())
    ).isFalse();
  }

  @Test
  void canWriteRefusesOnAClosedTicketEvenForTheAuthor() {
    when(stub.getTicket(any())).thenReturn(
      TicketResponse.newBuilder()
        .setAuthorId("u1")
        .setStatus(TicketStatus.TICKET_STATUS_CLOSED)
        .build()
    );

    assertThat(access.canWrite("t1", principal(List.of()), client())).isFalse();
  }

  @Test
  void canWriteIsTrueForTheAuthorOnAnOpenTicket() {
    when(stub.getTicket(any())).thenReturn(
      TicketResponse.newBuilder()
        .setAuthorId("u1")
        .setStatus(TicketStatus.TICKET_STATUS_OPEN)
        .build()
    );

    assertThat(access.canWrite("t1", principal(List.of()), client())).isTrue();
  }
}
