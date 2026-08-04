import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { isUUID } from 'class-validator';
import {
  isFullJwtPayload,
  JwtPayload,
  MaybeJwtPayload,
} from '@synapsedesk/common';
import { SecureGateway } from '../../common/decorators/secure-gateway.decorator';
import { WsThrottlerService } from '../../common/services/ws-throttler.service';
import { WsResponse } from '../../common/interfaces/ws-response.interface';
import { TicketAccessService } from './ticket-access.service';
import {
  CLIENT_EVENTS,
  orgRoom,
  REALTIME_EVENTS,
  RealtimeRoom,
  ticketRoom,
  userRoom,
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
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly ACCESS_COOKIE_NAME: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly wsThrottler: WsThrottlerService,
    private readonly ticketAccess: TicketAccessService,
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

      // AFTER the rooms are joined, never before: the whole point is that a
      // client receiving this may safely emit, and emitting depends on
      // `client.data.user` being set and the identity rooms being live.
      client.emit(REALTIME_EVENTS.connectionReady, {
        success: true,
        message: 'Connected',
        data: { userId: payload.sub, organizationId: payload.organizationId },
      } satisfies WsResponse<{
        userId: string;
        organizationId: string | null;
      }>);

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
    const id = this.requireTicketId(ticketId);

    const allowed = await this.ticketAccess.canRead(id, payload, client);
    if (!allowed) {
      // NOT_FOUND phrasing rather than "forbidden", for the same reason every
      // by-id route returns 404: "you may not see this" confirms the ticket
      // exists, which turns room joining into a cross-tenant existence oracle.
      throw new WsException('No ticket with that id');
    }

    await client.join(ticketRoom(id));

    client.emit(REALTIME_EVENTS.ticketJoined, {
      success: true,
      message: 'Joined ticket room',
      data: { ticketId: id },
    } satisfies WsResponse<{ ticketId: string }>);
  }

  @SubscribeMessage(CLIENT_EVENTS.ticketLeave)
  async handleTicketLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() ticketId: unknown,
  ): Promise<void> {
    // No authorization check: leaving a room you are not in is a no-op, and
    // refusing it would only make a client's cleanup path conditional.
    this.requireUser(client);
    await client.leave(ticketRoom(this.requireTicketId(ticketId)));
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
}
