package com.synapsedesk.gateway.modules.realtime;

import com.corundumstudio.socketio.AckRequest;
import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIONamespace;
import com.corundumstudio.socketio.SocketIOServer;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.auth.JwtVerifier;
import com.synapsedesk.gateway.common.config.JwtProperties;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import com.synapsedesk.gateway.common.dto.UserReferenceResponseDto;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.metrics.GatewayMetrics;
import com.synapsedesk.gateway.common.runtime.RuntimeParticipant;
import com.synapsedesk.gateway.modules.tickets.TicketReferences;
import io.grpc.stub.MetadataUtils;
import io.netty.handler.codec.http.HttpHeaderNames;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import synapsedesk.ticket.Message.CreateMessageRequest;
import synapsedesk.ticket.Message.CreateMessageResponse;
import synapsedesk.ticket.Message.NewAttachment;
import synapsedesk.ticket.MessageServiceGrpc;

/**
 * The handshake, the identity rooms and the socket server's own lifecycle.
 *
 * <p><b>{@link #activate} is the only thing that starts
 * {@link SocketIOServer#start()}</b>, so no socket can reach {@link #onConnect}
 * before it has run.
 *
 * <p><b>No explicit "is this a 2FA challenge token" check either.</b>
 * {@link JwtVerifier#verifyAccess} already rejects a challenge token before
 * this class ever sees it (`isChallenge` is filtered inside `verifyAccess`
 * itself), so a hand-written check here would repeat the access verifier's
 * own contract.
 *
 * <p><b>A refused `ticket:join`/budget check drops the frame silently</b>
 * rather than answering with an exception frame. The SECURITY property holds
 * either way — the room is never joined; the client just sees no error.
 */
@Component
@Order(0)
public class RealtimeGateway implements RuntimeParticipant {

  private static final Logger LOG = LoggerFactory.getLogger(
    RealtimeGateway.class
  );

  private final SocketIOServer server;
  private final JwtVerifier jwtVerifier;
  private final JwtProperties jwt;
  private final GatewayMetrics metrics;
  private final PresenceService presence;
  private final RealtimeBroadcast broadcast;
  private final WsThrottlerService wsThrottler;
  private final TicketAccessService ticketAccess;
  private final AiStreamService aiStreams;
  private final MessageServiceGrpc.MessageServiceBlockingStub messages;
  private final TicketViewers viewers;
  private final TicketReferences references;

  /**
   * Per-socket typing-relay gate: at most one `typing:start` relayed per
   * {@link #TYPING_RELAY_INTERVAL_MS} per (socket, ticket). Kept HERE rather
   * than on the socket itself because netty-socketio's client interface
   * exposes no general attribute bag — a
   * disconnect prunes its own entry in {@link #onDisconnect}, so nothing
   * outlives the connection that created it.
   */
  private final Map<UUID, Map<String, Long>> typingAt =
    new ConcurrentHashMap<>();

  private static final long TYPING_RELAY_INTERVAL_MS = 2_000;
  private static final long TYPING_TTL_MS = 5_000;

  private volatile boolean started;

  public RealtimeGateway(
    SocketIOServer server,
    SocketIONamespace realtimeNamespace,
    JwtVerifier jwtVerifier,
    JwtProperties jwt,
    GatewayMetrics metrics,
    PresenceService presence,
    RealtimeBroadcast broadcast,
    WsThrottlerService wsThrottler,
    TicketAccessService ticketAccess,
    AiStreamService aiStreams,
    MessageServiceGrpc.MessageServiceBlockingStub messages,
    TicketViewers viewers,
    TicketReferences references
  ) {
    this.server = server;
    this.jwtVerifier = jwtVerifier;
    this.jwt = jwt;
    this.metrics = metrics;
    this.presence = presence;
    this.broadcast = broadcast;
    this.wsThrottler = wsThrottler;
    this.ticketAccess = ticketAccess;
    this.aiStreams = aiStreams;
    this.messages = messages;
    this.viewers = viewers;
    this.references = references;

    // On the `/ws` namespace specifically — `SocketIOServer.addConnectListener`
    // attaches to the DEFAULT namespace ("/"), which this gateway never
    // uses at all.
    realtimeNamespace.addConnectListener(this::onConnect);
    realtimeNamespace.addDisconnectListener(this::onDisconnect);
    realtimeNamespace.addEventListener(
      RealtimeEvents.CLIENT_EVENTS_PRESENCE_UPDATE,
      PresenceUpdateBody.class,
      this::onPresenceUpdate
    );
    realtimeNamespace.addEventListener(
      RealtimeEvents.CLIENT_EVENTS_TYPING_START,
      TicketIdBody.class,
      (client, body, ack) -> relayTyping(client, body, true)
    );
    realtimeNamespace.addEventListener(
      RealtimeEvents.CLIENT_EVENTS_TYPING_STOP,
      TicketIdBody.class,
      (client, body, ack) -> relayTyping(client, body, false)
    );
    realtimeNamespace.addEventListener(
      RealtimeEvents.CLIENT_EVENTS_TICKET_JOIN,
      TicketIdBody.class,
      (client, body, ack) -> onTicketJoin(client, body)
    );
    realtimeNamespace.addEventListener(
      RealtimeEvents.CLIENT_EVENTS_TICKET_LEAVE,
      TicketIdBody.class,
      (client, body, ack) -> onTicketLeave(client, body)
    );
    realtimeNamespace.addEventListener(
      RealtimeEvents.CLIENT_EVENTS_MESSAGE_SEND,
      MessageSendBody.class,
      this::onMessageSend
    );
    realtimeNamespace.addEventListener(
      RealtimeEvents.CLIENT_EVENTS_AI_STREAM_CANCEL,
      StreamIdBody.class,
      this::onAiStreamCancel
    );
  }

  @Override
  public synchronized void activate() {
    server.start();
    started = true;
    LOG.info("Realtime socket server listening");
  }

  @Override
  public synchronized void deactivate() {
    if (!started) {
      return;
    }

    server.stop();
    started = false;
  }

  /**
   * Authenticates the handshake, then joins the two rooms the caller is
   * entitled to by identity alone — `user:{sub}` and `org:{organizationId}`
   * need no authorization check because both ids come from a VERIFIED token.
   * `ticket:{id}` is the opposite, and is a client-initiated join, not part
   * of connection setup (`CLIENT_EVENTS.ticketJoin` — a later group).
   */
  private void onConnect(SocketIOClient client) {
    String handshakeIp = SocketHandshakes.ip(client);
    if (!wsThrottler.allowHandshake(handshakeIp)) {
      LOG.warn("Handshake budget exceeded for {}", handshakeIp);
      client.disconnect();

      return;
    }

    try {
      JwtPrincipal principal = verifyHandshake(client);
      client.getHandshakeData().setAuthToken(principal);

      client.joinRoom(RealtimeRooms.userRoom(principal.sub()));
      if (principal.organizationId() != null) {
        client.joinRoom(RealtimeRooms.orgRoom(principal.organizationId()));
        if (principal.isAgent()) {
          client.joinRoom(
            RealtimeRooms.orgAgentsRoom(principal.organizationId())
          );
        }
      }
      if (principal.departmentIds() != null) {
        for (String departmentId : principal.departmentIds()) {
          client.joinRoom(RealtimeRooms.deptRoom(departmentId));
        }
      }

      client.sendEvent(
        RealtimeEvents.REALTIME_EVENTS_CONNECTION_READY,
        WsResponse.ok(
          "Connected",
          new ConnectionReadyPayload(
            principal.sub(),
            principal.organizationId()
          )
        )
      );

      announceConnected(principal);
      metrics.socketOpened();
    } catch (RuntimeException refused) {
      LOG.warn(
        "Refused socket {}: {}",
        client.getSessionId(),
        refused.getMessage()
      );
      // Admit-then-disconnect, never a handshake-layer refusal: the client
      // sees `connect → disconnect(io server disconnect)` and does not
      // retry. Refusing at the transport layer instead
      // makes `socket.io-client` retry the handshake forever.
      client.disconnect();
    }
  }

  /**
   * Decrement is conditional on {@link #onConnect} having reached the point
   * where it set an auth token — a socket refused before authentication
   * completed never bumped the gauge, so it must not decrement it either, or
   * a handshake flood drives the count negative.
   */
  private void onDisconnect(SocketIOClient client) {
    aiStreams.cancelAll(client);
    typingAt.remove(client.getSessionId());
    if (
      client.getHandshakeData().getAuthToken() instanceof JwtPrincipal principal
    ) {
      List<String> left;
      try {
        left = viewers.disconnect(client.getSessionId());
      } catch (RuntimeException failure) {
        LOG.warn("Ticket viewers not cleared: {}", failure.getMessage());
        left = List.of();
      }
      for (String ticketId : left) {
        updateViewers(ticketId, principal, client, () -> true);
      }
    }

    if (client.getHandshakeData().getAuthToken() != null) {
      metrics.socketClosed();
    }
  }

  /**
   * The presence floor a new connection sets — `online` ONLY if nothing is
   * recorded, and the frame goes out only when the state actually changed.
   * Never fails the connection: presence is the least important thing this
   * socket does, and a Redis blip must not cost a user their ticket updates.
   */
  private void announceConnected(JwtPrincipal principal) {
    if (principal.organizationId() == null) {
      return;
    }

    try {
      String before = presence.read(
        principal.organizationId(),
        principal.sub()
      );
      String state = presence.onConnect(
        principal.organizationId(),
        principal.sub()
      );

      // `null` means the store was unreachable — announcing nothing is
      // right: a transition not actually made must not be reported.
      if (state != null && !state.equals(before)) {
        emitPresence(principal.organizationId(), principal.sub(), state);
      }
    } catch (RuntimeException failure) {
      LOG.warn(
        "Presence announce failed for {}: {}",
        principal.sub(),
        failure.getMessage()
      );
    }
  }

  /**
   * `presence:update` — an explicit self-report, or a client heartbeat
   * (same state resent). Broadcasts only on {@code changed}: a heartbeat
   * that merely refreshes a TTL — the common case — must not give every
   * colleague one frame per minute per peer carrying no information.
   */
  private void onPresenceUpdate(
    SocketIOClient client,
    PresenceUpdateBody body,
    AckRequest ack
  ) {
    try {
      JwtPrincipal principal = requireUser(client);
      requireEventBudget(
        RealtimeEvents.CLIENT_EVENTS_PRESENCE_UPDATE,
        principal.sub()
      );
      String state = requireState(body);

      // A platform-level account has no tenant, so there is no org room to
      // announce into and no colleagues to announce to. Accepted, not
      // refused: the client's own state is still valid, only unaudienced.
      if (principal.organizationId() == null) {
        ack.sendAckData(
          WsResponse.ok("Presence updated", new PresenceStatePayload(state))
        );

        return;
      }

      PresenceService.Update update = presence.set(
        principal.organizationId(),
        principal.sub(),
        state
      );
      if (update.changed()) {
        emitPresence(
          principal.organizationId(),
          principal.sub(),
          update.state()
        );
      }

      ack.sendAckData(
        WsResponse.ok(
          "Presence updated",
          new PresenceStatePayload(update.state())
        )
      );
    } catch (RuntimeException refused) {
      ack.sendAckData(WsResponse.fail(refused.getMessage()));
    }
  }

  /** Fanned to `org:{organizationId}` — not a ticket room, not a department room. */
  private void emitPresence(
    String organizationId,
    String userId,
    String state
  ) {
    broadcast.broadcastToRoom(
      RealtimeRooms.orgRoom(organizationId),
      RealtimeEvents.REALTIME_EVENTS_PRESENCE,
      WsResponse.ok("Presence changed", new PresencePayload(userId, state))
    );
  }

  /**
   * Joining a ticket room is an AUTHORIZATION decision, not a subscription
   * — `ticket:{uuid}` is a guessable string any connected client can ask
   * for. Refused with a generic message rather than "forbidden": telling a
   * caller a ticket exists but is not theirs turns room-joining into a
   * cross-tenant existence oracle.
   */
  private void onTicketJoin(SocketIOClient client, TicketIdBody body) {
    JwtPrincipal principal = requireUser(client);
    if (
      !wsThrottler.allowEvent(
        RealtimeEvents.CLIENT_EVENTS_TICKET_JOIN,
        principal.sub()
      )
    ) {
      return;
    }

    String ticketId = body != null ? body.ticketId() : null;
    if (ticketId == null) {
      return;
    }

    if (!ticketAccess.canRead(ticketId, principal, client)) {
      return;
    }

    client.joinRoom(RealtimeRooms.ticketRoom(ticketId));

    // The agent-only half — joined only by a socket whose principal is an
    // agent at THIS moment, read from the verified token, not re-fetched:
    // the permission set is a JWT claim, and a revocation lands on the NEXT
    // join.
    if (principal.isAgent()) {
      client.joinRoom(RealtimeRooms.ticketInternalRoom(ticketId));
    }

    client.sendEvent(
      RealtimeEvents.REALTIME_EVENTS_TICKET_JOINED,
      WsResponse.ok("Joined ticket room", new TicketJoinedPayload(ticketId))
    );

    if (principal.isAgent()) {
      updateViewers(ticketId, principal, client, () -> {
        viewers.join(ticketId, client.getSessionId(), principal.sub());
        return true;
      });
    }
  }

  /** No authorization check — leaving a room you are not in is a no-op. */
  private void onTicketLeave(SocketIOClient client, TicketIdBody body) {
    JwtPrincipal principal = requireUser(client);
    if (
      !wsThrottler.allowEvent(
        RealtimeEvents.CLIENT_EVENTS_TICKET_LEAVE,
        principal.sub()
      )
    ) {
      return;
    }

    String ticketId = body != null ? body.ticketId() : null;
    if (ticketId == null) {
      return;
    }

    client.leaveRoom(RealtimeRooms.ticketRoom(ticketId));
    // Both halves, unconditionally — an agent whose permission was revoked
    // mid-session must not stay in the internal room.
    client.leaveRoom(RealtimeRooms.ticketInternalRoom(ticketId));
    updateViewers(ticketId, principal, client, () ->
      viewers.leave(ticketId, client.getSessionId())
    );
  }

  /**
   * Applies a change to a ticket's viewers and, when it changed something, sends
   * every replica's agents in `ticket:{id}:internal` the new list as
   * `ticket:viewers`, names from one `ListUsersByIds`. End users never join that
   * room. Never fails the caller: who else is looking is the least of what this
   * socket does, as presence is.
   */
  private void updateViewers(
    String ticketId,
    JwtPrincipal principal,
    SocketIOClient client,
    BooleanSupplier change
  ) {
    try {
      if (!change.getAsBoolean()) return;

      List<String> ids = viewers.viewerIds(ticketId);
      Map<String, UserReferenceResponseDto> people = references.users(
        SocketRequestContext.from(principal, client),
        new LinkedHashSet<>(ids)
      );
      List<TicketViewersPayload.Viewer> list = ids
        .stream()
        .map(id -> {
          UserReferenceResponseDto person = people.get(id);
          return new TicketViewersPayload.Viewer(
            id,
            person == null ? null : person.fullName()
          );
        })
        .toList();
      broadcast.broadcastToRoom(
        RealtimeRooms.ticketInternalRoom(ticketId),
        RealtimeEvents.REALTIME_EVENTS_TICKET_VIEWERS,
        WsResponse.ok(
          "Viewers changed",
          new TicketViewersPayload(ticketId, list)
        )
      );
    } catch (RuntimeException failure) {
      LOG.warn(
        "Ticket viewers not updated for {}: {}",
        ticketId,
        failure.getMessage()
      );
    }
  }

  /**
   * `message:send` — a TRANSPORT, not a second write path. This calls the
   * SAME `MessageService.createMessage` RPC the REST controller calls, with
   * {@code invokeAi} forced false: streaming owns that path instead, so
   * ticket-service must not ALSO run its own unary draft.
   *
   * <p><b>Never emits `message:new`</b> — the NATS consumer already does
   * that for every path; emitting here too double-delivers to the room,
   * including the sender.
   */
  private void onMessageSend(
    SocketIOClient client,
    MessageSendBody body,
    AckRequest ack
  ) {
    try {
      JwtPrincipal principal = requireUser(client);
      requireEventBudget(
        RealtimeEvents.CLIENT_EVENTS_MESSAGE_SEND,
        principal.sub()
      );

      if (
        body == null ||
        body.ticketId() == null ||
        body.content() == null ||
        body.clientMessageId() == null
      ) {
        throw new IllegalArgumentException("A valid message is required");
      }

      if (!ticketAccess.canWrite(body.ticketId(), principal, client)) {
        throw new IllegalStateException("No ticket with that id");
      }

      CreateMessageRequest.Builder wire = CreateMessageRequest.newBuilder()
        .setTicketId(body.ticketId())
        .setContent(body.content())
        .setIsInternalNote(Boolean.TRUE.equals(body.isInternalNote()))
        .setInvokeAi(false)
        .setClientMessageId(body.clientMessageId());
      if (body.attachments() != null) {
        wire.addAllAttachments(
          body
            .attachments()
            .stream()
            .map(attachment ->
              NewAttachment.newBuilder()
                .setObjectPath(attachment.objectPath())
                .setFileName(attachment.fileName())
                .build()
            )
            .toList()
        );
      }

      CreateMessageResponse response = messagesWith(
        principal,
        client
      ).createMessage(wire.build());

      String streamId = Boolean.TRUE.equals(body.invokeAi())
        ? startAnswerStream(
            client,
            body.ticketId(),
            body.content(),
            principal,
            response.getMessage().getId()
          )
        : null;

      ack.sendAckData(
        WsResponse.ok(
          "Message sent",
          new MessageSendAck(
            response.getMessage().getId(),
            streamId,
            response.getSkippedAttachmentsList()
          )
        )
      );
    } catch (RuntimeException refused) {
      ack.sendAckData(WsResponse.fail(refused.getMessage()));
    }
  }

  /**
   * Opens the answer stream, and never fails the send because of it — the
   * user's message is already committed. An unreachable rag-service is a
   * MISSING SECOND MESSAGE, not a failed write.
   */
  private String startAnswerStream(
    SocketIOClient client,
    String ticketId,
    String content,
    JwtPrincipal principal,
    String messageId
  ) {
    try {
      return aiStreams.start(client, ticketId, content, principal, messageId);
    } catch (RuntimeException failure) {
      LOG.error(
        "Answer stream failed to start for ticket {}: {}",
        ticketId,
        failure.getMessage()
      );

      return null;
    }
  }

  private void onAiStreamCancel(
    SocketIOClient client,
    StreamIdBody body,
    AckRequest ack
  ) {
    try {
      JwtPrincipal principal = requireUser(client);
      requireEventBudget(
        RealtimeEvents.CLIENT_EVENTS_AI_STREAM_CANCEL,
        principal.sub()
      );

      String streamId = body != null ? body.streamId() : null;
      if (streamId == null) {
        throw new IllegalArgumentException("A valid streamId is required");
      }

      ack.sendAckData(
        WsResponse.ok(
          "Cancelled",
          new CancelledPayload(aiStreams.cancel(client, streamId))
        )
      );
    } catch (RuntimeException refused) {
      ack.sendAckData(WsResponse.fail(refused.getMessage()));
    }
  }

  private MessageServiceGrpc.MessageServiceBlockingStub messagesWith(
    JwtPrincipal principal,
    SocketIOClient client
  ) {
    return messages
      .withDeadlineAfter(5, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(
          CallerMetadata.of(SocketRequestContext.from(principal, client))
        )
      );
  }

  private void relayTyping(
    SocketIOClient client,
    TicketIdBody body,
    boolean isTyping
  ) {
    JwtPrincipal principal = requireUser(client);
    String event = isTyping
      ? RealtimeEvents.CLIENT_EVENTS_TYPING_START
      : RealtimeEvents.CLIENT_EVENTS_TYPING_STOP;

    // Silent, unlike every throttled ack handler: a dropped typing frame is
    // invisible and correct, so refusal simply ends the frame here.
    if (!wsThrottler.allowEvent(event, principal.sub())) {
      return;
    }

    String ticketId = body != null ? body.ticketId() : null;
    if (ticketId == null) {
      return;
    }

    // Membership is the authorization — a socket can only reach a room it
    // was admitted to at join time.
    if (!client.getAllRooms().contains(RealtimeRooms.ticketRoom(ticketId))) {
      return;
    }

    if (isTyping && !mayRelayTyping(client, ticketId)) {
      return;
    }

    broadcast.relayExcludingSender(
      RealtimeRooms.ticketRoom(ticketId),
      RealtimeEvents.REALTIME_EVENTS_TYPING,
      WsResponse.ok(
        isTyping ? "Typing" : "Stopped typing",
        new TypingPayload(ticketId, principal.sub(), isTyping, TYPING_TTL_MS)
      ),
      client
    );
  }

  /** At most one relayed `typing:start` per {@link #TYPING_RELAY_INTERVAL_MS} per (socket, ticket). */
  private boolean mayRelayTyping(SocketIOClient client, String ticketId) {
    Map<String, Long> seen = typingAt.computeIfAbsent(
      client.getSessionId(),
      ignored -> new ConcurrentHashMap<>()
    );
    long now = System.currentTimeMillis();
    Long last = seen.get(ticketId);

    if (last != null && now - last < TYPING_RELAY_INTERVAL_MS) {
      return false;
    }

    seen.put(ticketId, now);

    return true;
  }

  private String requireState(PresenceUpdateBody body) {
    if (body == null || body.state() == null) {
      throw new IllegalArgumentException("A valid state is required");
    }

    return body.state();
  }

  private void requireEventBudget(String event, String subject) {
    if (!wsThrottler.allowEvent(event, subject)) {
      throw new IllegalStateException("Too many requests");
    }
  }

  /** The verified payload this socket authenticated with. */
  private JwtPrincipal requireUser(SocketIOClient client) {
    Object token = client.getHandshakeData().getAuthToken();
    if (!(token instanceof JwtPrincipal principal)) {
      throw new IllegalStateException("Unauthorized client");
    }

    return principal;
  }

  private JwtPrincipal verifyHandshake(SocketIOClient client) {
    String rawCookie = client
      .getHandshakeData()
      .getHttpHeaders()
      .get(HttpHeaderNames.COOKIE);
    if (rawCookie == null) {
      throw new IllegalStateException("No cookies in handshake");
    }

    String cookiePrefix = jwt.accessName() + "=";
    String token = Arrays.stream(rawCookie.split(";"))
      .map(String::trim)
      .filter(part -> part.startsWith(cookiePrefix))
      .map(part -> part.substring(cookiePrefix.length()))
      .findFirst()
      .orElseThrow(() -> new IllegalStateException("Access token missing"));

    return jwtVerifier
      .verifyAccess(token)
      .orElseThrow(() ->
        new IllegalStateException("Invalid or expired access token")
      );
  }
}
