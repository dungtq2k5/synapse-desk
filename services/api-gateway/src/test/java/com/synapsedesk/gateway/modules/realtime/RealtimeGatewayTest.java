package com.synapsedesk.gateway.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.AckRequest;
import com.corundumstudio.socketio.HandshakeData;
import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIONamespace;
import com.corundumstudio.socketio.SocketIOServer;
import com.corundumstudio.socketio.listener.ConnectListener;
import com.corundumstudio.socketio.listener.DisconnectListener;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.auth.JwtVerifier;
import com.synapsedesk.gateway.common.config.JwtProperties;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import com.synapsedesk.gateway.common.metrics.GatewayMetrics;
import io.netty.handler.codec.http.DefaultHttpHeaders;
import io.netty.handler.codec.http.HttpHeaders;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

/**
 * The handshake and lifecycle logic, exercised through the connect/disconnect
 * listeners {@link RealtimeGateway} registers on construction — captured
 * here the same way Spring would deliver them from the real socket server.
 */
class RealtimeGatewayTest {

  private final SocketIOServer server = mock(SocketIOServer.class);
  private final SocketIONamespace realtimeNamespace = mock(
    SocketIONamespace.class
  );
  private final JwtVerifier jwtVerifier = mock(JwtVerifier.class);
  private final JwtProperties jwt = new JwtProperties(
    "access_token",
    "keys/access.pub",
    "refresh_token",
    "mfa_token",
    "keys/mfa.pub",
    "tenant_selection",
    "device_token"
  );
  private final GatewayMetrics metrics = mock(GatewayMetrics.class);
  private final PresenceService presence = mock(PresenceService.class);
  private final RealtimeBroadcast broadcast = mock(RealtimeBroadcast.class);
  private final WsThrottlerService wsThrottler = mock(WsThrottlerService.class);
  private final TicketAccessService ticketAccess = mock(
    TicketAccessService.class
  );
  private final AiStreamService aiStreams = mock(AiStreamService.class);
  private final TicketViewers viewers = mock(TicketViewers.class);
  private final com.synapsedesk.gateway.common.auth.RevokedSessions revokedSessions =
    mock(com.synapsedesk.gateway.common.auth.RevokedSessions.class);
  private final com.synapsedesk.gateway.modules.tickets.TicketReferences references =
    mock(com.synapsedesk.gateway.modules.tickets.TicketReferences.class);
  private final synapsedesk.ticket.MessageServiceGrpc.MessageServiceBlockingStub messagesStub =
    mock(
      synapsedesk.ticket.MessageServiceGrpc.MessageServiceBlockingStub.class
    );

  private final ArgumentCaptor<ConnectListener> connectCaptor =
    ArgumentCaptor.forClass(ConnectListener.class);
  private final ArgumentCaptor<DisconnectListener> disconnectCaptor =
    ArgumentCaptor.forClass(DisconnectListener.class);

  private RealtimeGateway gateway;

  @BeforeEach
  void wireListeners() {
    when(wsThrottler.allowHandshake(any())).thenReturn(true);
    when(wsThrottler.allowEvent(any(), any())).thenReturn(true);
    when(
      messagesStub.withDeadlineAfter(
        org.mockito.ArgumentMatchers.anyLong(),
        any()
      )
    ).thenReturn(messagesStub);
    when(messagesStub.withInterceptors(any())).thenReturn(messagesStub);

    gateway = new RealtimeGateway(
      server,
      realtimeNamespace,
      jwtVerifier,
      jwt,
      metrics,
      presence,
      broadcast,
      wsThrottler,
      ticketAccess,
      aiStreams,
      messagesStub,
      viewers,
      references,
      revokedSessions
    );
    verify(realtimeNamespace).addConnectListener(connectCaptor.capture());
    verify(realtimeNamespace).addDisconnectListener(disconnectCaptor.capture());
  }

  /** A handshake that arrived through the Ingress: one peer, its own X-Forwarded-For. */
  private static SocketIOClient clientForwardedFor(String forwardedFor) {
    SocketIOClient client = mock(SocketIOClient.class);
    HttpHeaders headers = new DefaultHttpHeaders();
    headers.add("X-Forwarded-For", forwardedFor);
    HandshakeData handshake = new HandshakeData(
      headers,
      Map.of(),
      new InetSocketAddress("10.0.0.5", 443),
      "/socket.io",
      false
    );
    when(client.getHandshakeData()).thenReturn(handshake);
    when(client.getSessionId()).thenReturn(UUID.randomUUID());
    return client;
  }

  @Test
  void theHandshakeBudgetIsKeyedByTheCallerNotByTheIngress() {
    // Every handshake behind the Ingress has the same peer; the budget is keyed
    // on the rightmost X-Forwarded-For entry, the one the Ingress appended.
    for (String forwarded : List.of(
      "198.51.100.7, 203.0.113.9",
      "198.51.100.7, 203.0.113.10",
      "192.0.2.1, 203.0.113.9"
    )) {
      connectCaptor.getValue().onConnect(clientForwardedFor(forwarded));
    }

    ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
    verify(wsThrottler, times(3)).allowHandshake(keys.capture());
    assertThat(keys.getAllValues()).containsExactly(
      "203.0.113.9",
      "203.0.113.10",
      "203.0.113.9"
    );
  }

  private static SocketIOClient clientWithCookie(String cookieHeader) {
    SocketIOClient client = mock(SocketIOClient.class);
    HttpHeaders headers = new DefaultHttpHeaders();
    if (cookieHeader != null) {
      headers.add("cookie", cookieHeader);
    }
    HandshakeData handshake = new HandshakeData(
      headers,
      Map.of(),
      new InetSocketAddress(0),
      "/socket.io",
      false
    );
    when(client.getHandshakeData()).thenReturn(handshake);
    when(client.getSessionId()).thenReturn(UUID.randomUUID());
    return client;
  }

  @Test
  void joinsUserOrgAndDepartmentRoomsInOrderThenEmitsConnectionReady() {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of("d1", "d2"),
      List.of(),
      true,
      false
    );
    when(jwtVerifier.verifyAccess("tok")).thenReturn(Optional.of(principal));
    SocketIOClient client = clientWithCookie("access_token=tok");

    connectCaptor.getValue().onConnect(client);

    InOrder order = inOrder(client);
    order.verify(client).joinRoom("user:u1");
    order.verify(client).joinRoom("org:o1");
    order.verify(client).joinRoom("dept:d1");
    order.verify(client).joinRoom("dept:d2");
    order
      .verify(client)
      .sendEvent(eq(RealtimeEvents.REALTIME_EVENTS_CONNECTION_READY), any());

    verify(metrics).socketOpened();
    verify(client, never()).disconnect();
  }

  @Test
  void anAgentAlsoJoinsTheTenantsAgentsRoomAnEndUserDoesNot() {
    for (List<String> codes : List.of(
      List.of("ticket.read.all"),
      List.of("ticket.message.moderate")
    )) {
      JwtPrincipal agent = new JwtPrincipal(
        "a1",
        "o1",
        false,
        List.of(),
        codes,
        true,
        false
      );
      when(jwtVerifier.verifyAccess("agent")).thenReturn(Optional.of(agent));
      SocketIOClient client = clientWithCookie("access_token=agent");

      connectCaptor.getValue().onConnect(client);

      verify(client).joinRoom("org:o1:agents");
    }

    JwtPrincipal endUser = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of("ticket.create"),
      true,
      false
    );
    when(jwtVerifier.verifyAccess("member")).thenReturn(Optional.of(endUser));
    SocketIOClient member = clientWithCookie("access_token=member");

    connectCaptor.getValue().onConnect(member);

    verify(member).joinRoom("org:o1");
    verify(member, never()).joinRoom("org:o1:agents");
  }

  @Test
  void noOrganizationSkipsTheOrgRoomButStillJoinsUser() {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      null,
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    when(jwtVerifier.verifyAccess("tok")).thenReturn(Optional.of(principal));
    SocketIOClient client = clientWithCookie("access_token=tok");

    connectCaptor.getValue().onConnect(client);

    verify(client).joinRoom("user:u1");
    verify(client, never()).joinRoom(eq("org:null"));
    verify(client, times(1)).joinRoom(any());
  }

  @Test
  void noCookieIsAdmittedThenDisconnectedNeverRefusedAtHandshake() {
    SocketIOClient client = clientWithCookie(null);

    connectCaptor.getValue().onConnect(client);

    verify(client).disconnect();
    verify(metrics, never()).socketOpened();
  }

  @Test
  void anInvalidOrExpiredTokenIsRefused() {
    when(jwtVerifier.verifyAccess("bad")).thenReturn(Optional.empty());
    SocketIOClient client = clientWithCookie("access_token=bad");

    connectCaptor.getValue().onConnect(client);

    verify(client).disconnect();
    verify(metrics, never()).socketOpened();
  }

  @Test
  void aRevokedSessionsTokenIsRefusedAtTheHandshake() {
    when(jwtVerifier.verifyAccess("revoked")).thenReturn(
      Optional.of(
        new JwtPrincipal(
          "u1",
          "o1",
          false,
          List.of(),
          List.of(),
          true,
          false,
          "family-1"
        )
      )
    );
    when(revokedSessions.isRevoked("family-1")).thenReturn(true);
    SocketIOClient client = clientWithCookie("access_token=revoked");

    connectCaptor.getValue().onConnect(client);

    verify(client).disconnect();
    verify(metrics, never()).socketOpened();
  }

  @Test
  void disconnectDecrementsOnlyWhenAuthenticationHadCompleted() {
    SocketIOClient authenticated = mock(SocketIOClient.class);
    HandshakeData authedHandshake = new HandshakeData(
      new DefaultHttpHeaders(),
      Map.of(),
      new InetSocketAddress(0),
      "/",
      false
    );
    authedHandshake.setAuthToken(
      new JwtPrincipal("u1", null, false, List.of(), List.of(), true, false)
    );
    when(authenticated.getHandshakeData()).thenReturn(authedHandshake);
    when(authenticated.getSessionId()).thenReturn(UUID.randomUUID());

    disconnectCaptor.getValue().onDisconnect(authenticated);

    verify(metrics, times(1)).socketClosed();

    SocketIOClient neverAuthenticated = mock(SocketIOClient.class);
    HandshakeData bareHandshake = new HandshakeData(
      new DefaultHttpHeaders(),
      Map.of(),
      new InetSocketAddress(0),
      "/",
      false
    );
    when(neverAuthenticated.getHandshakeData()).thenReturn(bareHandshake);
    when(neverAuthenticated.getSessionId()).thenReturn(UUID.randomUUID());

    disconnectCaptor.getValue().onDisconnect(neverAuthenticated);

    // Still just the one call — a socket that never authenticated must not
    // drive the gauge negative.
    verify(metrics, times(1)).socketClosed();
  }

  @Test
  void deactivateBeforeActivateIsANoop() {
    gateway.deactivate();

    verify(server, never()).stop();
  }

  @Test
  void activateThenDeactivateStartsAndStopsTheServerOnce() {
    gateway.activate();
    verify(server).start();

    gateway.deactivate();
    verify(server).stop();
  }

  @Test
  void aHandshakeOverBudgetIsAdmittedThenDisconnectedNeverJwtVerified() {
    when(wsThrottler.allowHandshake(any())).thenReturn(false);
    SocketIOClient client = clientWithCookie("access_token=tok");

    connectCaptor.getValue().onConnect(client);

    verify(client).disconnect();
    verify(jwtVerifier, never()).verifyAccess(any());
    verify(metrics, never()).socketOpened();
  }

  @Test
  void announcesPresenceOnlyWhenTheStateActuallyChanged() {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    when(jwtVerifier.verifyAccess("tok")).thenReturn(Optional.of(principal));
    when(presence.onConnect("o1", "u1")).thenReturn("online");

    connectCaptor.getValue().onConnect(clientWithCookie("access_token=tok"));

    verify(broadcast).broadcastToRoom(
      eq("org:o1"),
      eq(RealtimeEvents.REALTIME_EVENTS_PRESENCE),
      any()
    );
  }

  @Test
  void doesNotAnnouncePresenceTheConnectionDidNotSet() {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    when(jwtVerifier.verifyAccess("tok")).thenReturn(Optional.of(principal));
    // Already `busy`: the connection set nothing. And the state is not read
    // first, since a read taken before another socket's update is stale.
    when(presence.onConnect("o1", "u1")).thenReturn(null);

    connectCaptor.getValue().onConnect(clientWithCookie("access_token=tok"));

    verify(broadcast, never()).broadcastToRoom(any(), any(), any());
    verify(presence, never()).read(any(), any());
  }

  @Test
  void aPlatformAccountWithNoOrganizationIsNeverAnnounced() {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      null,
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    when(jwtVerifier.verifyAccess("tok")).thenReturn(Optional.of(principal));

    connectCaptor.getValue().onConnect(clientWithCookie("access_token=tok"));

    verify(presence, never()).onConnect(any(), any());
    verify(broadcast, never()).broadcastToRoom(any(), any(), any());
  }

  @SuppressWarnings("unchecked")
  private <T> com.corundumstudio.socketio.listener.DataListener<T> capturedListener(
    String event,
    Class<T> bodyType
  ) {
    ArgumentCaptor<
      com.corundumstudio.socketio.listener.DataListener<T>
    > captor = ArgumentCaptor.forClass(
      com.corundumstudio.socketio.listener.DataListener.class
    );
    verify(realtimeNamespace).addEventListener(
      eq(event),
      eq(bodyType),
      captor.capture()
    );

    return captor.getValue();
  }

  private static SocketIOClient authenticatedClient(JwtPrincipal principal) {
    SocketIOClient client = mock(SocketIOClient.class);
    HandshakeData handshake = new HandshakeData(
      new DefaultHttpHeaders(),
      Map.of(),
      new InetSocketAddress(0),
      "/ws",
      false
    );
    handshake.setAuthToken(principal);
    when(client.getHandshakeData()).thenReturn(handshake);
    when(client.getSessionId()).thenReturn(UUID.randomUUID());

    return client;
  }

  @Test
  void presenceUpdateBroadcastsOnlyOnChangeAndAcksTheStateEitherWay()
    throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    AckRequest ack = mock(AckRequest.class);
    when(presence.set("o1", "u1", "busy")).thenReturn(
      new PresenceService.Update(true, "busy")
    );

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_PRESENCE_UPDATE,
      PresenceUpdateBody.class
    ).onData(client, new PresenceUpdateBody("busy"), ack);

    verify(broadcast).broadcastToRoom(
      eq("org:o1"),
      eq(RealtimeEvents.REALTIME_EVENTS_PRESENCE),
      any()
    );
    verify(ack).sendAckData((Object[]) any());
  }

  @Test
  void typingIsRelayedExcludingTheSenderOnlyToJoinedTicketRooms()
    throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(client.getAllRooms()).thenReturn(
      java.util.Set.of("ticket:t1", "user:u1")
    );

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_TYPING_START,
      TicketIdBody.class
    ).onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(broadcast).relayExcludingSender(
      eq("ticket:t1"),
      eq(RealtimeEvents.REALTIME_EVENTS_TYPING),
      any(),
      eq(client)
    );
  }

  @Test
  void typingIsNotRelayedForARoomTheSocketNeverJoined() throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(client.getAllRooms()).thenReturn(java.util.Set.of("user:u1"));

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_TYPING_START,
      TicketIdBody.class
    ).onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(broadcast, never()).relayExcludingSender(any(), any(), any(), any());
  }

  @Test
  void aSecondTypingStartWithinTheRelayIntervalIsDropped() throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(client.getAllRooms()).thenReturn(java.util.Set.of("ticket:t1"));

    com.corundumstudio.socketio.listener.DataListener<TicketIdBody> listener =
      capturedListener(
        RealtimeEvents.CLIENT_EVENTS_TYPING_START,
        TicketIdBody.class
      );
    listener.onData(client, new TicketIdBody("t1"), mock(AckRequest.class));
    listener.onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(broadcast, times(1)).relayExcludingSender(
      any(),
      any(),
      any(),
      any()
    );
  }

  @Test
  void typingStopIsNeverThrottleGatedByTheRelayInterval() throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(client.getAllRooms()).thenReturn(java.util.Set.of("ticket:t1"));

    com.corundumstudio.socketio.listener.DataListener<TicketIdBody> stop =
      capturedListener(
        RealtimeEvents.CLIENT_EVENTS_TYPING_STOP,
        TicketIdBody.class
      );
    stop.onData(client, new TicketIdBody("t1"), mock(AckRequest.class));
    stop.onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(broadcast, times(2)).relayExcludingSender(
      any(),
      any(),
      any(),
      any()
    );
  }

  @Test
  void ticketJoinJoinsTheRoomAndEmitsTicketJoinedWhenAllowed()
    throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(ticketAccess.canRead("t1", principal, client)).thenReturn(true);

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_TICKET_JOIN,
      TicketIdBody.class
    ).onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(client).joinRoom("ticket:t1");
    verify(client, never()).joinRoom("ticket:t1:internal");
    verify(client).sendEvent(
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_JOINED),
      any()
    );
  }

  @Test
  void ticketJoinNeverJoinsTheRoomWhenRefused() throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(ticketAccess.canRead("t1", principal, client)).thenReturn(false);

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_TICKET_JOIN,
      TicketIdBody.class
    ).onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(client, never()).joinRoom(any());
    verify(client, never()).sendEvent(
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_JOINED),
      any()
    );
  }

  @Test
  void ticketJoinAlsoJoinsTheInternalRoomOnlyForAnAgent() throws Exception {
    // A super admin with no ticket permission: an agent all the same.
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      true,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(ticketAccess.canRead("t1", principal, client)).thenReturn(true);

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_TICKET_JOIN,
      TicketIdBody.class
    ).onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(client).joinRoom("ticket:t1");
    verify(client).joinRoom("ticket:t1:internal");
  }

  @Test
  void anAgentsJoinSendsTheViewersToTheInternalRoomAnEndUsersDoesNot()
    throws Exception {
    JwtPrincipal agent = new JwtPrincipal(
      "a1",
      "o1",
      false,
      List.of(),
      List.of("ticket.read.all"),
      true,
      false
    );
    JwtPrincipal endUser = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient agentClient = authenticatedClient(agent);
    SocketIOClient memberClient = authenticatedClient(endUser);
    when(ticketAccess.canRead(eq("t1"), any(), any())).thenReturn(true);
    when(viewers.viewerIds("t1")).thenReturn(List.of("a1"));
    when(references.users(any(), any())).thenReturn(Map.of());
    var join = capturedListener(
      RealtimeEvents.CLIENT_EVENTS_TICKET_JOIN,
      TicketIdBody.class
    );

    join.onData(memberClient, new TicketIdBody("t1"), mock(AckRequest.class));
    verify(viewers, never()).join(any(), any(), any());
    verify(broadcast, never()).broadcastToRoom(
      any(),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_VIEWERS),
      any()
    );

    join.onData(agentClient, new TicketIdBody("t1"), mock(AckRequest.class));
    verify(viewers).join("t1", agentClient.getSessionId(), "a1");
    // An unresolved name is null, not an error.
    verify(broadcast).broadcastToRoom(
      "ticket:t1:internal",
      RealtimeEvents.REALTIME_EVENTS_TICKET_VIEWERS,
      WsResponse.ok(
        "Viewers changed",
        new TicketViewersPayload(
          "t1",
          List.of(new TicketViewersPayload.Viewer("a1", null))
        )
      )
    );
  }

  @Test
  void aDisconnectSendsTheListForEveryTicketTheSocketViewed() {
    JwtPrincipal agent = new JwtPrincipal(
      "a1",
      "o1",
      false,
      List.of(),
      List.of("ticket.read.all"),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(agent);
    when(viewers.disconnect(client.getSessionId())).thenReturn(
      List.of("t1", "t2")
    );
    when(viewers.viewerIds(any())).thenReturn(List.of());
    when(references.users(any(), any())).thenReturn(Map.of());

    disconnectCaptor.getValue().onDisconnect(client);

    verify(broadcast).broadcastToRoom(
      eq("ticket:t1:internal"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_VIEWERS),
      any()
    );
    verify(broadcast).broadcastToRoom(
      eq("ticket:t2:internal"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_VIEWERS),
      any()
    );
  }

  @Test
  void ticketLeaveNeedsNoAuthorizationAndLeavesBothRooms() throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_TICKET_LEAVE,
      TicketIdBody.class
    ).onData(client, new TicketIdBody("t1"), mock(AckRequest.class));

    verify(client).leaveRoom("ticket:t1");
    verify(client).leaveRoom("ticket:t1:internal");
    verify(ticketAccess, never()).canRead(any(), any(), any());
  }

  @Test
  void messageSendNeverInvokesAiWhenNotRequestedAndNeverEmitsMessageNew()
    throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    AckRequest ack = mock(AckRequest.class);
    when(ticketAccess.canWrite("t1", principal, client)).thenReturn(true);

    synapsedesk.ticket.Message.MessageResponse persisted =
      synapsedesk.ticket.Message.MessageResponse.newBuilder()
        .setId("m1")
        .build();
    when(messagesStub.createMessage(any())).thenReturn(
      synapsedesk.ticket.Message.CreateMessageResponse.newBuilder()
        .setMessage(persisted)
        .build()
    );

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_MESSAGE_SEND,
      MessageSendBody.class
    ).onData(
      client,
      new MessageSendBody("t1", "hello", "cm1", false, false, List.of()),
      ack
    );

    org.mockito.ArgumentCaptor<synapsedesk.ticket.Message.CreateMessageRequest> captor =
      org.mockito.ArgumentCaptor.forClass(
        synapsedesk.ticket.Message.CreateMessageRequest.class
      );
    verify(messagesStub).createMessage(captor.capture());
    assertThat(captor.getValue().getInvokeAi()).isFalse();
    verify(aiStreams, never()).start(any(), any(), any(), any(), any());
    verify(client, never()).sendEvent(
      eq(RealtimeEvents.REALTIME_EVENTS_MESSAGE_NEW),
      any()
    );
    verify(ack).sendAckData((Object[]) any());
  }

  @Test
  void messageSendRefusesWithoutTicketAccessAndNeverCreatesTheMessage()
    throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(ticketAccess.canWrite("t1", principal, client)).thenReturn(false);

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_MESSAGE_SEND,
      MessageSendBody.class
    ).onData(
      client,
      new MessageSendBody("t1", "hello", "cm1", false, false, List.of()),
      mock(AckRequest.class)
    );

    verify(messagesStub, never()).createMessage(any());
  }

  @Test
  void messageSendStartsTheAnswerStreamOnlyWhenInvokeAiIsTrue()
    throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    when(ticketAccess.canWrite("t1", principal, client)).thenReturn(true);
    when(messagesStub.createMessage(any())).thenReturn(
      synapsedesk.ticket.Message.CreateMessageResponse.newBuilder()
        .setMessage(
          synapsedesk.ticket.Message.MessageResponse.newBuilder().setId("m1")
        )
        .build()
    );
    when(
      aiStreams.start(
        eq(client),
        eq("t1"),
        eq("hello"),
        eq(principal),
        eq("m1")
      )
    ).thenReturn("stream-1");

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_MESSAGE_SEND,
      MessageSendBody.class
    ).onData(
      client,
      new MessageSendBody("t1", "hello", "cm1", false, true, List.of()),
      mock(AckRequest.class)
    );

    verify(aiStreams).start(client, "t1", "hello", principal, "m1");
  }

  @Test
  void aiStreamCancelAcksTheCancelResult() throws Exception {
    JwtPrincipal principal = new JwtPrincipal(
      "u1",
      "o1",
      false,
      List.of(),
      List.of(),
      true,
      false
    );
    SocketIOClient client = authenticatedClient(principal);
    AckRequest ack = mock(AckRequest.class);
    when(aiStreams.cancel(client, "stream-1")).thenReturn(true);

    capturedListener(
      RealtimeEvents.CLIENT_EVENTS_AI_STREAM_CANCEL,
      StreamIdBody.class
    ).onData(client, new StreamIdBody("stream-1"), ack);

    verify(aiStreams).cancel(client, "stream-1");
    verify(ack).sendAckData((Object[]) any());
  }

  @Test
  void disconnectCancelsEveryAiStreamOnThatSocket() {
    SocketIOClient client = mock(SocketIOClient.class);
    HandshakeData handshake = new HandshakeData(
      new DefaultHttpHeaders(),
      Map.of(),
      new InetSocketAddress(0),
      "/",
      false
    );
    when(client.getHandshakeData()).thenReturn(handshake);
    when(client.getSessionId()).thenReturn(UUID.randomUUID());

    disconnectCaptor.getValue().onDisconnect(client);

    verify(aiStreams).cancelAll(client);
  }
}
