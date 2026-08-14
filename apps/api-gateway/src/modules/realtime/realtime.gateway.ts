import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { isUUID, validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  isFullJwtPayload,
  JwtPayload,
  MaybeJwtPayload,
  RequestContext,
  formatErrorMsg,
} from '@synapsedesk/common';
import { SecureGateway } from '../../common/decorators/secure-gateway.decorator';
import { WsThrottlerService } from './ws-throttler.service';
import {
  WsAck,
  WsResponse,
} from '../../common/interfaces/ws-response.interface';
import { socketStore } from './socket-store';
import { TicketAccessService } from './ticket-access.service';
import { MessagesGrpcClient } from '../tickets/messages-grpc.client';
import { AiStreamService } from './ai-stream.service';
import { PresenceService } from './presence.service';
import { MetricsRegistry } from '../metrics/metrics.registry';
import { PresenceUpdateDto } from './dto/presence-update.dto';
import { MessageSendDto } from './dto/message-send.dto';
import {
  ConnectionReadyPayloadDto,
  PresencePayloadDto,
  TicketJoinedPayloadDto,
  TypingPayloadDto,
} from './dto/realtime-payload.dto';
import {
  CLIENT_EVENTS,
  ClientEvent,
  deptRoom,
  PresenceState,
  orgRoom,
  REALTIME_EVENTS,
  RealtimeRoom,
  ticketInternalRoom,
  ticketRoom,
  TYPING_RELAY_INTERVAL_MS,
  TYPING_TTL_MS,
  userRoom,
  WS_EVENT_LIMITS,
} from './realtime.config';

/**
 * The gateway's real-time surface.
 *
 * It owns the Socket.IO server and NOTHING else — no database, no business
 * rules, no knowledge of what a ticket is beyond who may watch one. Events
 * arrive from `TicketEventsConsumer` over NATS; ticket-service publishes them
 * knowing nothing about WebSockets at all. That separation is what lets the
 * relay be replaced, or a second consumer added, without either side changing.
 *
 * Note what this class does NOT do: it exposes no method for a service to
 * "grab the server and emit". A shared mutable `server` field assigned from
 * `handleConnection` — a pattern that looks convenient — is undefined until the
 * first client connects, and makes every publisher silently depend on someone
 * having opened a socket first.
 */
@SecureGateway('ws')
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly ACCESS_COOKIE_NAME: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly wsThrottler: WsThrottlerService,
    private readonly ticketAccess: TicketAccessService,
    private readonly messages: MessagesGrpcClient,
    private readonly aiStreams: AiStreamService,
    private readonly presence: PresenceService,
    private readonly metrics: MetricsRegistry,
  ) {
    this.ACCESS_COOKIE_NAME =
      this.configService.getOrThrow<string>('JWT_ACCESS_NAME');
  }

  /**
   * Authenticates the handshake, then joins the two rooms the caller is
   * entitled to by identity alone.
   *
   * `user:{sub}` and `org:{organizationId}` need no authorization check because
   * both ids come from a VERIFIED token — a client cannot ask for someone
   * else's. `ticket:{id}` is the opposite and is handled below.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      if (
        !(await this.wsThrottler.allowHandshake(client, RealtimeGateway.name))
      ) {
        // Already disconnected inside the service; returning here avoids
        // running auth on a socket that is going away.
        return;
      }

      const payload = this.verifyHandshake(client);
      // `client.data` is typed `any` by socket.io — this is the one write to
      // it, and `requireUser()` below is the one read, so the unsafety is
      // contained to two lines rather than spread across every handler.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      client.data.user = payload;

      await client.join(userRoom(payload.sub));
      if (payload.organizationId) {
        await client.join(orgRoom(payload.organizationId));
      }

      // **The department rooms, from the token** — 22-doc §6.2.
      //
      // Same reasoning as `user:` and `org:`: the ids come from a verified JWT,
      // so no authorization call is needed and a client cannot ask for a
      // department it is not in. They exist for `document:indexed`, which must
      // not be announced tenant-wide — a department-scoped document is
      // invisible to users outside its departments, and `org:` would disclose
      // its title to exactly the people that boundary excludes.
      //
      // Joined in ONE call rather than one per department: `join` takes an
      // array, and a user in twelve departments would otherwise pay twelve
      // sequential adapter round trips before `connection:ready` — the frame
      // every client waits on before it may emit anything.
      await client.join(payload.departmentIds.map(deptRoom));

      // AFTER the rooms are joined, never before: the whole point is that a
      // client receiving this may safely emit, and emitting depends on
      // `client.data.user` being set and the identity rooms being live.
      client.emit(REALTIME_EVENTS.connectionReady, {
        success: true,
        message: 'Connected',
        data: { userId: payload.sub, organizationId: payload.organizationId },
      } satisfies WsResponse<ConnectionReadyPayloadDto>);

      // AFTER `connection:ready`, and not awaited into it: presence is an
      // availability signal for colleagues, and a slow Redis must not delay the
      // frame that tells this client it may start talking.
      void this.announceConnected(payload);

      // 23-doc §4: WebSocket traffic was entirely invisible to monitoring —
      // this process could hold ten thousand sockets and no dashboard would
      // show it. Counted AFTER authentication, so a flood of refused
      // handshakes does not read as legitimate load.
      this.metrics.websocketConnections.inc();

      this.logger.log(
        `Socket ${client.id} authenticated as ${payload.sub} (tenant ${payload.organizationId ?? 'platform'})`,
      );
    } catch (error) {
      this.logger.warn(
        `Refused socket ${client.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // HARD disconnect. An unauthenticated socket left open is a socket that
      // will try again on the next frame, and every attempt costs a
      // verification.
      client.disconnect(true);
    }
  }

  /**
   * Cancels whatever this socket still had running — 22-doc §5.2.
   *
   * **This is the cancellation that actually happens.** `ai:stream:cancel`
   * covers a user who pressed stop; closing the tab is the same intent
   * expressed the way people actually express it, and without this the gRPC
   * call runs to completion, is billed in full, and emits its tokens at a
   * socket that is gone.
   *
   * Nothing else needs cleaning: every other piece of per-socket state on this
   * gateway lives on `client.data` and dies with the connection. Streams are
   * the exception because they hold something OUTSIDE the process.
   */
  handleDisconnect(client: Socket): void {
    this.aiStreams.cancelAll(client);

    // Only for sockets that were counted. `handleConnection` increments after
    // authentication, so decrementing unconditionally would drift the gauge
    // negative under a handshake flood — and a gauge that goes negative is one
    // nobody trusts again.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (client.data.user) this.metrics.websocketConnections.dec();
  }

  /**
   * `presence:update` — 22-doc §4.
   *
   * **The ONLY writer.** Connecting sets a floor and a heartbeat refreshes a
   * TTL; neither states anything about the user's intent. Keeping one writer is
   * what makes "last write wins" a complete rule rather than the first half of
   * a precedence table.
   *
   * **Emitted on TRANSITION only.** The same frame doubles as the heartbeat —
   * a client sends its current state once a minute to keep the key alive — so
   * broadcasting unconditionally would give every agent one frame per minute per
   * peer carrying no information. `set` returns whether anything changed, and
   * silence is the answer when nothing did.
   */
  @SubscribeMessage(CLIENT_EVENTS.presenceUpdate)
  async handlePresenceUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<{ state: string }>> {
    return this.acknowledge(client, CLIENT_EVENTS.presenceUpdate, async () => {
      const payload = this.requireUser(client);
      await this.requireEventBudget(client, CLIENT_EVENTS.presenceUpdate);

      const dto = await this.validateBody(PresenceUpdateDto, body);

      // A platform-level account has no tenant, so there is no org room to
      // announce into and no colleagues to announce to. Accepted rather than
      // refused: the client's own state is still valid, it simply has no
      // audience.
      if (!payload.organizationId) {
        return {
          success: true,
          message: 'Presence updated',
          data: { state: dto.state },
        };
      }

      const { changed, state } = await this.presence.set(
        payload.organizationId,
        payload.sub,
        dto.state,
      );

      if (changed) {
        this.emitPresence(payload.organizationId, payload.sub, state);
      }

      return {
        success: true,
        message: 'Presence updated',
        data: { state },
      };
    });
  }

  /**
   * Joining a ticket room is an AUTHORIZATION decision, not a subscription.
   *
   * `ticket:{uuid}` is a guessable string that any connected client can ask
   * for, so `client.join()` without a check would make every ticket in the
   * system readable by anyone with a session — the room name is not a secret
   * and was never meant to be one.
   *
   * The check is the same one `GET /tickets/:id` performs, delegated to
   * `TicketAccessService` so there is one answer to "may this person see this
   * ticket?" rather than an HTTP one and a WebSocket one that drift.
   */
  @SubscribeMessage(CLIENT_EVENTS.ticketJoin)
  async handleTicketJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() ticketId: unknown,
  ): Promise<void> {
    const payload = this.requireUser(client);
    await this.requireEventBudget(client, CLIENT_EVENTS.ticketJoin);
    const id = this.requireTicketId(ticketId);

    const allowed = await this.ticketAccess.canRead(id, payload, client);
    if (!allowed) {
      // NOT_FOUND phrasing rather than "forbidden", for the same reason every
      // by-id route returns 404: "you may not see this" confirms the ticket
      // exists, which turns room joining into a cross-tenant existence oracle.
      throw new WsException('No ticket with that id');
    }

    await client.join(ticketRoom(id));

    // **The agent-only half** — 22-doc §1. Joined only by a socket that holds
    // `ticket.read.all` at THIS moment, which is what makes the internal-note
    // fan-out a single room emit rather than a per-socket permission read on
    // every message.
    //
    // Read from the verified token, not re-fetched: the permission set is a JWT
    // claim, and the whole design accepts that a revocation lands on the next
    // join (§6.3).
    if (payload.permissionCodes.includes('ticket.read.all')) {
      await client.join(ticketInternalRoom(id));
    }

    client.emit(REALTIME_EVENTS.ticketJoined, {
      success: true,
      message: 'Joined ticket room',
      data: { ticketId: id },
    } satisfies WsResponse<TicketJoinedPayloadDto>);
  }

  @SubscribeMessage(CLIENT_EVENTS.ticketLeave)
  async handleTicketLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() ticketId: unknown,
  ): Promise<void> {
    // No authorization check: leaving a room you are not in is a no-op, and
    // refusing it would only make a client's cleanup path conditional.
    this.requireUser(client);
    await this.requireEventBudget(client, CLIENT_EVENTS.ticketLeave);
    const id = this.requireTicketId(ticketId);

    await client.leave(ticketRoom(id));
    // Both halves, unconditionally. Leaving a room you are not in is a no-op,
    // and making this conditional on the permission would leave an agent whose
    // permission was revoked mid-session still in the internal room.
    await client.leave(ticketInternalRoom(id));
  }

  /**
   * `message:send` — 22-doc §2.
   *
   * **A transport, not a second write path.** The spec says it "mirrors
   * `POST /tickets/:id/messages`", and mirroring is the trap: a second
   * implementation of a write means two validators, two audit call sites, two
   * notification triggers and two rate limits, and they diverge on the first
   * change to either. This calls the SAME `MessagesGrpcClient.create` the HTTP
   * controller calls, so the two-write `invokeAi` path, `ticket.message_created`,
   * the audit row and the notification producer all come along unchanged —
   * because it is literally the same code.
   *
   * Three things this owns that the controller does not:
   *
   *   1. Building a `RequestContext` from the socket rather than a request.
   *   2. Acking to the sender, so the client can clear its pending state.
   *   3. **NOT emitting `message:new`.** The NATS consumer already does that for
   *      every path; emitting here too double-delivers to the room including the
   *      sender. That is the mistake that looks like a feature — "send it
   *      straight back for latency" — and it is why the ack carries the message
   *      id and nothing else.
   */
  @SubscribeMessage(CLIENT_EVENTS.messageSend)
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<{ messageId: string; streamId?: string }>> {
    // **Every refusal returns in the ACK rather than throwing** — 22-doc §2.1.
    //
    // The ack is what lets the client clear its pending state, and a refused
    // send is exactly when clearing matters most. A thrown `WsException` leaves
    // Socket.IO's ack callback uncalled, so the client's spinner runs forever
    // and its retry never fires — the message simply disappears from the user's
    // point of view. The `exception` frame the filter emits is not a substitute:
    // the client is awaiting THIS call.
    return this.acknowledge(client, CLIENT_EVENTS.messageSend, () =>
      this.sendMessage(client, body),
    );
  }

  /**
   * `ai:stream:cancel` — 22-doc §5.2.
   *
   * Acked, because a client that pressed stop needs to know the stream is
   * actually gone before it re-enables its composer. A cancel for a stream this
   * socket does not own acks `false` rather than erroring: the client's intent
   * — "that stream should not be running" — is satisfied either way, and an
   * error would be indistinguishable from a race with the stream finishing.
   */
  @SubscribeMessage(CLIENT_EVENTS.aiStreamCancel)
  async handleAiStreamCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<{ cancelled: boolean }>> {
    return this.acknowledge(client, CLIENT_EVENTS.aiStreamCancel, async () => {
      this.requireUser(client);
      await this.requireEventBudget(client, CLIENT_EVENTS.aiStreamCancel);

      const streamId = this.requireStreamId(body);

      return {
        success: true,
        message: 'Stream cancelled',
        data: { cancelled: this.aiStreams.cancel(client, streamId) },
      };
    });
  }

  /**
   * `typing:start` / `typing:stop` — 22-doc §3.
   *
   * **Ephemeral, and that word does the work.** No table, no NATS subject, no
   * audit. A typing frame is worth less than the bytes it costs, which is why
   * the design is about not spending anything on it.
   *
   * Three consequences, each visible in the six lines below:
   *
   *   - **`client.to(room)`, not `server.to(room)`** — the sender is excluded.
   *     Echoing a user's own typing back is a frame that can only cause a bug.
   *   - **Throttled to one relay per {@link TYPING_RELAY_INTERVAL_MS} per
   *     (socket, ticket), and dropped SILENTLY.** A refusal would be noise for
   *     something nobody asked to be told about.
   *   - **The frame carries a TTL and the client expires it.** No server-side
   *     timer exists to leak, which is what test 3 asserts.
   *
   * **Internal-note typing does not exist**, deliberately. There is no way to
   * know which composer an agent is typing in, so this only ever means "someone
   * is replying" — inferring internal activity from a keystroke would be a leak
   * of exactly the kind §1 just closed.
   */
  @SubscribeMessage(CLIENT_EVENTS.typingStart)
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    await this.relayTyping(client, body, true);
  }

  @SubscribeMessage(CLIENT_EVENTS.typingStop)
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    // `typing:stop` is NOT throttled: it is the frame that clears the
    // indicator, and dropping it would leave a stale "typing…" on every peer
    // until the TTL expired. The start frames are the storm; the stop is one.
    await this.relayTyping(client, body, false);
  }

  // -------------------------------------------------------------------------

  /**
   * Reads and VERIFIES the access token from the handshake cookie.
   *
   * Verification, not decoding: the payload decides which rooms this socket
   * joins, so an unverified `sub` would let anyone address themselves as
   * anyone. Same RS256 public key the HTTP guards use — the gateway holds no
   * signing material and cannot mint what it checks.
   */
  private verifyHandshake(client: Socket): JwtPayload {
    const rawCookie = client.handshake.headers.cookie;
    if (!rawCookie) throw new WsException('No cookies in handshake');

    const token = rawCookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${this.ACCESS_COOKIE_NAME}=`))
      ?.slice(this.ACCESS_COOKIE_NAME.length + 1);

    if (!token) throw new WsException('Access token missing');

    const payload = this.jwtService.verify<MaybeJwtPayload>(token);

    // A 2FA CHALLENGE token proves a password and nothing else. It is signed by
    // a different keypair so it should already have failed verification — this
    // is the same belt-and-braces check `JwtStrategy.validate` keeps, and for
    // the same reason: the failure it guards against is a half-authenticated
    // caller holding a full session, which is severe and silent.
    if (!isFullJwtPayload(payload)) {
      throw new WsException('Two-factor challenge is not complete');
    }

    return payload;
  }

  /** The verified payload this socket authenticated with. */
  private requireUser(client: Socket): JwtPayload {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const payload = client.data.user as JwtPayload | undefined;
    // Unreachable while `handleConnection` disconnects on failure — kept
    // because "unreachable" depends on that method staying correct, and the
    // cost of being wrong is an unauthenticated caller reaching a handler.
    if (!payload) throw new WsException('Unauthorized client');

    return payload;
  }

  /**
   * Runs an ack-based handler, turning a refusal into a failure ACK.
   *
   * Same `ErrorResponse` envelope the exception filter emits and every REST
   * error uses, so a client parses one shape rather than three. See
   * `handleMessageSend` for why the ack rather than an `exception` frame.
   */
  private async acknowledge<T>(
    client: Socket,
    event: ClientEvent,
    run: () => Promise<WsResponse<T>>,
  ): Promise<WsAck<T>> {
    try {
      return await run();
    } catch (error) {
      const message =
        error instanceof WsException
          ? formatErrorMsg(error.getError())
          : formatErrorMsg(error);

      // Logged here because the exception filter never sees it — the throw is
      // caught, so an unexpected failure would otherwise be invisible.
      //
      // The event is a PARAMETER rather than a constant: three handlers share
      // this helper, and naming one of them here reported a refused
      // `presence:update` as a refused `message:send` — misdirection at exactly
      // the moment someone is reading the log to find out what was refused.
      this.logger.warn(`${event} refused for socket ${client.id}: ${message}`);

      return {
        success: false,
        statusCode: 400,
        path: client.nsp?.name ?? '/',
        timestamp: new Date().toISOString(),
        error: message,
      };
    }
  }

  /**
   * A `RequestContext` from a socket rather than an HTTP request.
   *
   * The verified JWT payload plus the observed origin, which is exactly what the
   * HTTP path packs — so ticket-service applies the same tenant filter and
   * writes the same audit origin whether the write arrived over a socket or a
   * request.
   */
  private requestContext(client: Socket, payload: JwtPayload): RequestContext {
    return {
      ...payload,
      ip: client.handshake.address,
      userAgent: (client.handshake.headers['user-agent'] as string) ?? '',
    };
  }

  /**
   * Validates a socket frame against a DTO — 22-doc §2.
   *
   * **Not because the global `ValidationPipe` cannot see socket frames — it
   * can.** `useGlobalPipes` binds across every execution context, so typing a
   * handler's `@MessageBody()` as a DTO really would validate it, exactly as the
   * HTTP routes do. The reason to do it by hand is what happens when validation
   * FAILS.
   *
   * A pipe rejects BEFORE the handler body runs, so the throw never reaches
   * {@link acknowledge} and never becomes a failure ack. Socket.IO's ack
   * callback is then never invoked: the client's spinner runs forever and its
   * retry never fires, which is the precise failure `WsAck`'s docblock and
   * 22-doc §2.1 exist to prevent. The `exception` frame the filter emits is not
   * a substitute, because the client is awaiting THIS call.
   *
   * Measured rather than argued: registering the pipe in the realtime fixture
   * and typing `presence:update`'s body as `PresenceUpdateDto` leaves the six
   * happy-path presence tests green and fails the one asserting that a bad
   * `state` comes back as a refusal ack.
   *
   * Two smaller reasons the DTO-typed parameter does not fit here either way:
   * `ticket:join` and the typing frames accept a BARE STRING as well as an
   * object, which no DTO class can express; and four of the seven handlers
   * return `void`, so only three are bound by the ack contract at all — a split
   * that would leave the parameter style inconsistent across one file.
   *
   * `whitelist` + `forbidNonWhitelisted` mirror the HTTP configuration, so an
   * unknown field is refused here exactly as it would be on a REST route.
   */
  private async validateBody<T extends object>(
    Dto: new () => T,
    body: unknown,
  ): Promise<T> {
    const instance = plainToInstance(Dto, body ?? {}, {
      enableImplicitConversion: true,
    });

    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      // The first constraint message, not the whole tree: a socket error frame
      // is read by a developer in a console, and the full nested structure is
      // less useful than the one sentence naming the offending field.
      const first = errors[0];
      const detail =
        Object.values(first.constraints ?? {})[0] ??
        `${first.property} is invalid`;

      throw new WsException(detail);
    }

    return instance;
  }

  /**
   * Spends one unit of this event's budget, or refuses the frame — 22-doc §6.3.
   *
   * **Throws rather than returning false.** Every caller here wants the client
   * told: a refused join or send that returned silently would leave the UI
   * waiting for an ack that never comes, which is worse than an error. The two
   * handlers that want silent drops (typing) call `wsThrottler.allowEvent`
   * directly and ignore the answer.
   */
  private async requireEventBudget(
    client: Socket,
    event: ClientEvent,
  ): Promise<void> {
    const { limit, ttlMs } = WS_EVENT_LIMITS[event];

    if (!(await this.wsThrottler.allowEvent(client, event, limit, ttlMs))) {
      throw new WsException('Too many requests');
    }
  }

  /**
   * A message body is whatever the client sent — there is no ValidationPipe on
   * a socket frame unless one is wired per handler, so the id is checked here
   * rather than trusted into a database query.
   */
  private requireTicketId(value: unknown): string {
    const id =
      typeof value === 'string'
        ? value
        : typeof value === 'object' && value !== null
          ? (value as { ticketId?: unknown }).ticketId
          : undefined;

    if (typeof id !== 'string' || !isUUID(id)) {
      throw new WsException('A valid ticketId is required');
    }

    return id;
  }

  /**
   * The presence floor a new connection sets.
   *
   * `online` ONLY if nothing is recorded — an existing `busy` survives a new
   * tab, because a user who declared themselves busy did not stop being busy by
   * opening a window. And the frame goes out only when the state actually
   * changed, for the same reason `presence:update` is transition-only.
   */
  private async announceConnected(payload: JwtPayload): Promise<void> {
    if (!payload.organizationId) return;

    try {
      const before = await this.presence.read(
        payload.organizationId,
        payload.sub,
      );
      const state = await this.presence.onConnect(
        payload.organizationId,
        payload.sub,
      );

      // `null` means the store was unreachable. Announcing nothing is right:
      // a transition we did not manage to record is one we must not report.
      if (state && state !== before) {
        this.emitPresence(payload.organizationId, payload.sub, state);
      }
    } catch (error) {
      // Never fails the connection. Presence is the least important thing this
      // socket does, and a Redis blip must not cost a user their real-time
      // ticket updates.
      this.logger.warn(
        `Presence announce failed for ${payload.sub}: ${formatErrorMsg(error)}`,
      );
    }
  }

  /**
   * Fanned to `org:{organizationId}` — 22-doc §4.
   *
   * Not a ticket room, which is far too narrow to be useful: presence answers
   * "who is around right now?", and the people asking are colleagues who have
   * not joined any particular thread. Not a department room either, which misses
   * the cross-department queues where the question actually comes up.
   */
  private emitPresence(
    organizationId: string,
    userId: string,
    state: PresenceState,
  ): void {
    this.toRoom(orgRoom(organizationId)).emit(REALTIME_EVENTS.presence, {
      success: true,
      message: 'Presence changed',
      data: { userId, state },
    } satisfies WsResponse<PresencePayloadDto>);
  }

  private async sendMessage(
    client: Socket,
    body: unknown,
  ): Promise<
    WsResponse<{
      messageId: string;
      streamId?: string;
      skippedAttachments: string[];
    }>
  > {
    const payload = this.requireUser(client);
    await this.requireEventBudget(client, CLIENT_EVENTS.messageSend);

    const dto = await this.validateBody(MessageSendDto, body);

    // `canWrite`, NOT `canRead` — 22-doc §2.2. A `ticket.read.all` holder may
    // watch any thread in the tenant and post into none of them.
    //
    // Note what this check is FOR: ticket-service re-validates on its own, so
    // removing it would not open a hole — it would produce a gRPC error where an
    // ack should be. It exists for the error, not for the security.
    if (!(await this.ticketAccess.canWrite(dto.ticketId, payload, client))) {
      throw new WsException('No ticket with that id');
    }

    const { message, skippedAttachments } = await this.messages.create(
      dto.ticketId,
      {
        content: dto.content,
        isInternalNote: dto.isInternalNote,
        // **Always false, even when the client asked for AI** — see
        // `startAnswerStream` below. Forwarding the flag would make
        // ticket-service run its own unary `Draft` and append a SECOND reply,
        // so one question would produce two answers: one streamed here, one
        // not. This path takes the AI over; it does not add to it.
        invokeAi: false,
        // Bound as the message is written, so the stream opened below sees them
        // — 36-doc §1.3. This handler is the one place where the write and the
        // answer are close enough together for the ordering to matter.
        attachments: dto.attachments,
      },
      this.requestContext(client, payload),
      dto.clientMessageId,
    );

    // **The AI answer STREAMS from here rather than from ticket-service** —
    // 22-doc §5.1.
    //
    // Only for a socket: the HTTP twin still uses ticket-service's unary path,
    // because a request has nowhere to stream to.
    //
    // Deliberately not awaited: the ack means "your message was stored", which
    // is already true. Waiting for the generation would put the whole answer
    // latency back into the ack — the exact latency streaming exists to hide.
    const streamId = dto.invokeAi
      ? await this.startAnswerStream(
          client,
          dto.ticketId,
          dto.content,
          payload,
          // The message just written, so its attachments can reach the model —
          // 36-doc §2. Passed rather than looked up: this handler already holds
          // the id, and re-reading the ticket's newest row would race with a
          // second message arriving between the write and the stream.
          message.id,
        )
      : undefined;

    // The ack, and nothing more besides the stream handle. A duplicate
    // `clientMessageId` returns the ORIGINAL message id here rather than an
    // error — the client's intent was satisfied, and an error would make it
    // retry again.
    return {
      success: true,
      message: 'Message sent',
      // **On the ack, not as a separate frame.** A file that did not confirm is
      // an outcome of THIS send, and the client is already awaiting this
      // response — 36-doc §1.3.1. `ai:stream:attachments-skipped` answers a
      // different question (the model could not read it) and would be the wrong
      // channel for "it was never attached".
      data: { messageId: message.id, streamId, skippedAttachments },
    };
  }

  /**
   * Opens the answer stream, and never fails the send because of it.
   *
   * The user's message is already committed. An unreachable rag-service is a
   * MISSING SECOND MESSAGE, not a failed write — the same trade ticket-service
   * makes on the unary path, kept identical here so the two behave the same
   * when the AI is down.
   */
  private async startAnswerStream(
    client: Socket,
    ticketId: string,
    content: string,
    payload: JwtPayload,
    messageId: string,
  ): Promise<string | undefined> {
    try {
      return await this.aiStreams.start(
        client,
        ticketId,
        content,
        this.requestContext(client, payload),
        messageId,
      );
    } catch (error) {
      this.logger.error(
        `Answer stream failed to start for ticket ${ticketId}: ${formatErrorMsg(error)}`,
      );
      return undefined;
    }
  }

  private requireStreamId(value: unknown): string {
    const id =
      typeof value === 'string'
        ? value
        : typeof value === 'object' && value !== null
          ? (value as { streamId?: unknown }).streamId
          : undefined;

    if (typeof id !== 'string' || !isUUID(id)) {
      throw new WsException('A valid streamId is required');
    }

    return id;
  }

  private async relayTyping(
    client: Socket,
    body: unknown,
    isTyping: boolean,
  ): Promise<void> {
    const payload = this.requireUser(client);
    const event = isTyping
      ? CLIENT_EVENTS.typingStart
      : CLIENT_EVENTS.typingStop;

    const { limit, ttlMs } = WS_EVENT_LIMITS[event];
    // Silent, unlike every other handler: `allowEvent` is consulted and its
    // answer simply ends the frame. See the class note above.
    if (!(await this.wsThrottler.allowEvent(client, event, limit, ttlMs))) {
      return;
    }

    const ticketId = this.requireTicketId(body);

    // **Membership is the authorization.** A socket can only reach a room it
    // was admitted to at join time, so a client emitting typing for a ticket it
    // never joined broadcasts into a room it is not in — which reaches nobody.
    // No extra check is needed and adding one would cost a gRPC call per
    // keystroke.
    if (!client.rooms.has(ticketRoom(ticketId))) return;

    if (isTyping && !this.mayRelayTyping(client, ticketId)) return;

    client.to(ticketRoom(ticketId)).emit(REALTIME_EVENTS.typing, {
      success: true,
      message: isTyping ? 'Typing' : 'Stopped typing',
      data: {
        ticketId,
        userId: payload.sub,
        isTyping,
        // The client expires it. See `TYPING_TTL_MS`.
        ttlMs: TYPING_TTL_MS,
      },
    } satisfies WsResponse<TypingPayloadDto>);
  }

  /**
   * The relay gate: at most one `typing:start` per interval per (socket, ticket).
   *
   * **Kept on the SOCKET, not in a service-level map.** `client.data` dies with
   * the connection, so a disconnect leaves nothing to clean up and nothing to
   * leak — which is what §3 test 3 asserts. A `Map` keyed by socket id in a
   * provider would need a `handleDisconnect` to prune it, and the entry for a
   * socket on a pod that crashed would never be pruned at all.
   *
   * A timestamp rather than a timer for the same reason: there is nothing to
   * cancel.
   */
  private mayRelayTyping(client: Socket, ticketId: string): boolean {
    const seen = socketStore<Record<string, number>>(
      client,
      'typingAt',
      () => ({}),
    );
    const now = Date.now();

    if (now - (seen[ticketId] ?? 0) < TYPING_RELAY_INTERVAL_MS) return false;

    seen[ticketId] = now;
    return true;
  }

  /**
   * The one way anything else in this process emits.
   *
   * Returns the room-scoped emitter rather than the server, so a caller cannot
   * accidentally broadcast to every connected socket — `server.emit()` is one
   * missing `.to()` away, and it is not a mistake that shows up in testing
   * because a single-client test cannot tell the difference.
   */
  toRoom(room: RealtimeRoom) {
    return this.server.to(room);
  }

  /**
   * Counts one outbound event — 23-doc §4.
   *
   * Labelled by EVENT NAME only. The names come from `REALTIME_EVENTS`, a fixed
   * object, so the cardinality is its size; adding the ticket or the recipient
   * would make it unbounded, which is the trap §4 is entirely about.
   */
  countEvent(event: string): void {
    this.metrics.websocketEvents.inc({ event });
  }

  /**
   * ONE emit addressing several rooms — 22-doc §6.2.
   *
   * Not a convenience wrapper around a loop, and the difference is the whole
   * reason it exists. Socket.IO deduplicates recipients WITHIN a single emit and
   * not across separate ones, so a socket in two of these rooms — the uploader
   * who is also in the document's department, which is the common case —
   * receives one frame here and two from `rooms.forEach(r => toRoom(r).emit())`.
   * A client rendering one toast per frame renders two.
   */
  toRooms(rooms: RealtimeRoom[]) {
    return this.server.to(rooms);
  }
}
