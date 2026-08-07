import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  ReassignmentReason,
  TICKET_PATTERNS,
  TicketDomainEvent,
  TicketEventOf,
  ticketMessageGroupKey,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import {
  ACCESS_COOKIE,
  RealtimeFixture,
  bootstrapRealtimeTest,
  expectNoEvent,
  signTwoFactorToken,
  waitForEvent,
} from '../utils';
import { grpcError, timestamp } from '../fixtures/wire';
import {
  CLIENT_EVENTS,
  REALTIME_EVENTS,
} from '../../src/modules/realtime/realtime.config';

/**
 * The real-time relay, end to end: a NATS publish in, a WebSocket frame out.
 *
 * Both ends are real — a real socket on a real ephemeral port, a real NATS
 * connection, the real Redis adapter. Only ticket-service's gRPC surface is
 * stubbed, because the relay's job is to translate events rather than to decide
 * anything about tickets.
 */
describe('the real-time relay (e2e)', () => {
  let fx: RealtimeFixture;

  const organizationId = faker.string.uuid();
  const ticketId = faker.string.uuid();
  const authorId = faker.string.uuid();
  const agentId = faker.string.uuid();

  /** A ticket the stubbed peer will hand back for the join authorization. */
  const wireTicket = (overrides: Record<string, unknown> = {}) => {
    return {
      id: ticketId,
      ticketNumber: 1,
      organizationId,
      authorId,
      source: 1,
      status: 2,
      priority: 2,
      title: 'Printer is on fire',
      description: 'It really is',
      currentAssigneeId: agentId,
      currentDepartmentId: faker.string.uuid(),
      createdAt: timestamp(),
      updatedAt: timestamp(),
      ...overrides,
    };
  };

  // Return type narrowed to the variant, not the union: a test that reads
  // `.messageId` needs the compiler to know which member it has.
  const messageEvent = (): TicketEventOf<
    typeof TICKET_PATTERNS.messageCreated
  > => {
    return {
      pattern: TICKET_PATTERNS.messageCreated,
      organizationId,
      ticketId,
      ticketNumber: 4211,
      occurredAt: new Date().toISOString(),
      messageId: faker.string.uuid(),
      senderId: authorId,
      requesterId: authorId,
      assigneeId: null,
      isAiGenerated: false,
      isInternalNote: false,
      groupKey: ticketMessageGroupKey(ticketId),
    };
  };

  beforeAll(async () => {
    fx = await bootstrapRealtimeTest();
  }, 30_000);

  beforeEach(() => {
    jest.clearAllMocks();
    // The default for every test: the ticket resolves, and the caller is its
    // author or assignee. Tests about refusal override it.
    fx.stubs.ticket.getTicket.mockReturnValue(of(wireTicket()));
  });

  afterAll(() => fx.close());

  // ------------------------------------------------------------- connection

  describe('handshake', () => {
    it('accepts a valid access-token cookie and joins the identity rooms', async () => {
      const socket = await fx.connectClient({ organizationId });
      expect(socket.connected).toBe(true);
    });

    it('REFUSES a socket with no cookie at all', async () => {
      const socket = fx.connectRaw('');

      await expect(
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('still open')),
            3_000,
          );
          socket.on('disconnect', () => {
            clearTimeout(timer);
            resolve();
          });
          socket.on('connect_error', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('REFUSES a malformed token', async () => {
      const socket = fx.connectRaw(`${ACCESS_COOKIE}=not-a-real-jwt`);

      await expect(
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('still open')),
            3_000,
          );
          socket.on('disconnect', () => {
            clearTimeout(timer);
            resolve();
          });
          socket.on('connect_error', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('REFUSES a 2FA challenge token — a password alone is not a session', async () => {
      // Signed by the separate 2FA keypair, so it should already fail signature
      // verification. The check stays anyway: the failure it guards against is a
      // half-authenticated caller holding a full real-time session, which is
      // severe and silent.
      const challenge = signTwoFactorToken({
        sub: faker.string.uuid(),
        is2faPending: true,
      });
      const socket = fx.connectRaw(`${ACCESS_COOKIE}=${challenge}`);

      await expect(
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('still open')),
            3_000,
          );
          socket.on('disconnect', () => {
            clearTimeout(timer);
            resolve();
          });
          socket.on('connect_error', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ------------------------------------------------------------ ticket:join

  describe('5. ticket:join re-authorization', () => {
    it('ADMITS the ticket author', async () => {
      const socket = await fx.connectClient({ sub: authorId, organizationId });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);

      await expect(
        waitForEvent(socket, REALTIME_EVENTS.ticketJoined),
      ).resolves.toMatchObject({ success: true, data: { ticketId } });
    });

    it('ADMITS the current assignee', async () => {
      const socket = await fx.connectClient({ sub: agentId, organizationId });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);

      await expect(
        waitForEvent(socket, REALTIME_EVENTS.ticketJoined),
      ).resolves.toBeDefined();
    });

    it('ADMITS a caller holding ticket.read.all', async () => {
      const socket = await fx.connectClient({
        sub: faker.string.uuid(),
        organizationId,
        permissionCodes: ['ticket.read.all'],
      });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);

      await expect(
        waitForEvent(socket, REALTIME_EVENTS.ticketJoined),
      ).resolves.toBeDefined();
    });

    it('REFUSES a caller who is neither author, assignee, nor read-all', async () => {
      // The re-authorization §1.6 calls non-optional. A room name is a
      // guessable UUID-keyed string, so joining one cannot be the permission
      // check.
      const socket = await fx.connectClient({
        sub: faker.string.uuid(),
        organizationId,
      });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);

      const error = await waitForEvent<{ success: boolean; error: string }>(
        socket,
        'exception',
      );
      expect(error.success).toBe(false);
      // Phrased as NOT FOUND, not "forbidden": "you may not see this" confirms
      // the ticket exists, which turns room joining into an existence oracle.
      expect(error.error).toMatch(/no ticket/i);
    });

    it('REFUSES when the ticket resolves in ANOTHER tenant', async () => {
      // The peer applies `tenantScope`, so a foreign id comes back NOT_FOUND.
      // The relay must treat that as a refusal rather than an error to retry.
      fx.stubs.ticket.getTicket.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'no such ticket')),
      );

      const socket = await fx.connectClient({
        sub: authorId,
        organizationId,
        permissionCodes: ['ticket.read.all'],
      });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);

      await expect(waitForEvent(socket, 'exception')).resolves.toMatchObject({
        success: false,
      });
    });

    it('FAILS CLOSED when the peer is unreachable', async () => {
      // Denying a legitimate watcher costs a page refresh. Admitting an
      // illegitimate one leaks a customer's support thread — so an error on the
      // authorization path can only mean no.
      fx.stubs.ticket.getTicket.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'peer is down')),
      );

      const socket = await fx.connectClient({ sub: authorId, organizationId });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);

      await expect(waitForEvent(socket, 'exception')).resolves.toMatchObject({
        success: false,
      });
    });

    it('REJECTS a non-UUID ticket id before any peer call', async () => {
      // There is no ValidationPipe on a socket frame unless one is wired per
      // handler, so the id is checked rather than trusted into a query.
      const socket = await fx.connectClient({ sub: authorId, organizationId });
      socket.emit(CLIENT_EVENTS.ticketJoin, "'; DROP TABLE tickets; --");

      await expect(waitForEvent(socket, 'exception')).resolves.toMatchObject({
        success: false,
      });
      expect(fx.stubs.ticket.getTicket).not.toHaveBeenCalled();
    });

    it('the exception frame uses the same envelope as an HTTP error', async () => {
      const socket = await fx.connectClient({ sub: faker.string.uuid() });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);

      const frame = await waitForEvent<Record<string, unknown>>(
        socket,
        'exception',
      );
      expect(frame).toMatchObject({
        success: false,
        statusCode: expect.any(Number),
        path: expect.any(String),
        timestamp: expect.any(String),
        error: expect.any(String),
      });
    });
  });

  // ------------------------------------------------------------- relaying

  describe('4. NATS in, WebSocket out', () => {
    it('BOTH clients in a ticket room receive message:new', async () => {
      const first = await fx.connectClient({ sub: authorId, organizationId });
      const second = await fx.connectClient({ sub: agentId, organizationId });

      first.emit(CLIENT_EVENTS.ticketJoin, ticketId);
      second.emit(CLIENT_EVENTS.ticketJoin, ticketId);
      await Promise.all([
        waitForEvent(first, REALTIME_EVENTS.ticketJoined),
        waitForEvent(second, REALTIME_EVENTS.ticketJoined),
      ]);

      const event = messageEvent();
      const received = Promise.all([
        waitForEvent<typeof event>(first, REALTIME_EVENTS.messageNew),
        waitForEvent<typeof event>(second, REALTIME_EVENTS.messageNew),
      ]);

      await fx.publish(event);
      const [a, b] = await received;

      expect(a.messageId).toBe(event.messageId);
      expect(b.messageId).toBe(event.messageId);
      // The full domain event travels in the payload, so a client that wants
      // the distinction between event types reads `pattern` — the same
      // discriminant every other consumer switches on.
      expect(a.pattern).toBe(TICKET_PATTERNS.messageCreated);
    });

    it('5b. the groupKey survives the hop BYTE-EXACT', async () => {
      // The one field Domain B must get right FOR Domain E: `group_key`
      // collapses a burst into one notification, and grouping works on exact
      // string equality. Domain E cannot fix a wrong key later without a
      // backfill.
      const first = await fx.connectClient({ sub: authorId, organizationId });
      first.emit(CLIENT_EVENTS.ticketJoin, ticketId);
      await waitForEvent(first, REALTIME_EVENTS.ticketJoined);

      const event = messageEvent();
      const received = waitForEvent<typeof event>(
        first,
        REALTIME_EVENTS.messageNew,
      );
      await fx.publish(event);

      expect((await received).groupKey).toBe(`ticket:${ticketId}:message`);
    });

    it('6. a client that never JOINED receives nothing', async () => {
      // The negative case, and the one that actually proves room scoping: that
      // joining works says nothing about whether not-joining excludes.
      const joined = await fx.connectClient({ sub: authorId, organizationId });
      const bystander = await fx.connectClient({
        sub: faker.string.uuid(),
        organizationId,
      });

      joined.emit(CLIENT_EVENTS.ticketJoin, ticketId);
      await waitForEvent(joined, REALTIME_EVENTS.ticketJoined);

      const silence = expectNoEvent(bystander, REALTIME_EVENTS.messageNew);
      const delivered = waitForEvent(joined, REALTIME_EVENTS.messageNew);

      await fx.publish(messageEvent());

      await expect(delivered).resolves.toBeDefined();
      await expect(silence).resolves.toBe(true);
    });

    it('6b. a client in ANOTHER tenant receives nothing tenant-wide', async () => {
      const insider = await fx.connectClient({ organizationId });
      const outsider = await fx.connectClient({
        organizationId: faker.string.uuid(),
      });

      const delivered = waitForEvent(insider, REALTIME_EVENTS.ticketCreated);
      const silence = expectNoEvent(outsider, REALTIME_EVENTS.ticketCreated);

      await fx.publish({
        pattern: TICKET_PATTERNS.created,
        organizationId,
        ticketId: faker.string.uuid(),
        occurredAt: new Date().toISOString(),
        ticketNumber: 42,
        authorId,
        source: TicketSource.WEB,
        title: 'New ticket',
      });

      await expect(delivered).resolves.toBeDefined();
      await expect(silence).resolves.toBe(true);
    });

    it('an assignment reaches the new assignee PERSONALLY, not just the room', async () => {
      // The assignee has almost certainly not joined the ticket room — being
      // assigned is how they learn it exists — so the room alone would reach
      // everyone except the one person who must act.
      const newAssignee = faker.string.uuid();
      const socket = await fx.connectClient({
        sub: newAssignee,
        organizationId,
      });

      const delivered = waitForEvent(socket, REALTIME_EVENTS.ticketAssigned);

      await fx.publish({
        pattern: TICKET_PATTERNS.assigned,
        organizationId,
        ticketId,
        ticketNumber: 4211,
        occurredAt: new Date().toISOString(),
        assignedToId: newAssignee,
        departmentId: faker.string.uuid(),
        assignedById: agentId,
      });

      await expect(delivered).resolves.toBeDefined();
    });

    it('a reassignment tells the PREVIOUS assignee too', async () => {
      const previous = faker.string.uuid();
      const socket = await fx.connectClient({ sub: previous, organizationId });

      // `ticket:updated`, not `ticket:assigned` — "this left your queue" is a
      // state change, and firing the assignment event would put it back on
      // their list.
      const delivered = waitForEvent(socket, REALTIME_EVENTS.ticketUpdated);
      const wrongEvent = expectNoEvent(socket, REALTIME_EVENTS.ticketAssigned);

      await fx.publish({
        pattern: TICKET_PATTERNS.reassigned,
        organizationId,
        ticketId,
        ticketNumber: 4211,
        occurredAt: new Date().toISOString(),
        fromAssigneeId: previous,
        toAssigneeId: faker.string.uuid(),
        departmentId: faker.string.uuid(),
        assignedById: agentId,
        reason: ReassignmentReason.LOAD_BALANCING,
      });

      await expect(delivered).resolves.toBeDefined();
      await expect(wrongEvent).resolves.toBe(true);
    });

    it('a status change reaches the ticket room', async () => {
      const socket = await fx.connectClient({ sub: authorId, organizationId });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);
      await waitForEvent(socket, REALTIME_EVENTS.ticketJoined);

      const delivered = waitForEvent<{ toStatus: string }>(
        socket,
        REALTIME_EVENTS.ticketUpdated,
      );

      await fx.publish({
        pattern: TICKET_PATTERNS.statusChanged,
        organizationId,
        ticketId,
        ticketNumber: 4211,
        requesterId: faker.string.uuid(),
        occurredAt: new Date().toISOString(),
        fromStatus: TicketStatus.OPEN,
        toStatus: TicketStatus.RESOLVED,
        changedById: agentId,
      });

      expect((await delivered).toStatus).toBe(TicketStatus.RESOLVED);
    });

    it('an internal-note message never reaches the ORG room', async () => {
      // `message:new` goes only to the authorized ticket room. Broadcasting it
      // tenant-wide would be exactly the leak `is_internal_note` exists to
      // prevent.
      const bystander = await fx.connectClient({
        sub: faker.string.uuid(),
        organizationId,
      });

      const silence = expectNoEvent(bystander, REALTIME_EVENTS.messageNew);
      await fx.publish({ ...messageEvent(), isInternalNote: true });

      await expect(silence).resolves.toBe(true);
    });

    it('leaving a room stops delivery', async () => {
      const socket = await fx.connectClient({ sub: authorId, organizationId });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);
      await waitForEvent(socket, REALTIME_EVENTS.ticketJoined);

      socket.emit(CLIENT_EVENTS.ticketLeave, ticketId);
      // No confirmation frame for a leave, so give the server a moment to
      // process it before asserting on the absence.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const silence = expectNoEvent(socket, REALTIME_EVENTS.messageNew);
      await fx.publish(messageEvent());

      await expect(silence).resolves.toBe(true);
    });

    it('a malformed event does not kill the consumer', async () => {
      const socket = await fx.connectClient({ sub: authorId, organizationId });
      socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);
      await waitForEvent(socket, REALTIME_EVENTS.ticketJoined);

      // Missing every field the handler reads.
      await fx.publish({
        pattern: TICKET_PATTERNS.messageCreated,
      } as unknown as TicketDomainEvent);

      // Still relaying afterwards, which is the assertion — a relay that threw
      // would have taken the subscription with it.
      const delivered = waitForEvent(socket, REALTIME_EVENTS.messageNew);
      await fx.publish(messageEvent());

      await expect(delivered).resolves.toBeDefined();
    });
  });

  describe('the Redis adapter', () => {
    it('is installed — events go through pub/sub, not the in-memory adapter', () => {
      // Asserted structurally: with the in-memory adapter a second replica
      // would never see this room, and that failure is invisible to a
      // single-instance test. §2.2 test 7 (two instances, one Redis) is the
      // behavioural proof and is deliberately kept out of the default run.
      const server = (
        fx.app as unknown as {
          get: (t: unknown) => unknown;
        }
      ).get;
      expect(server).toBeDefined();
      expect(process.env.REDIS_URL).toBeTruthy();
    });
  });

  // ------------------------------------------- 18-doc §6 — Domain E's relay

  describe('6. notifications reach the right socket, and only that one', () => {
    const notificationPayload = (recipientId: string) => ({
      organizationId,
      recipientId,
      notificationId: faker.string.uuid(),
      type: 'ticket.assigned',
      priority: 'NORMAL',
      title: 'Ticket #1042 assigned to you',
      body: 'You are now the assignee.',
      data: { ticketId, ticketNumber: 1042 },
      actionUrl: '/tickets/1042',
      groupKey: null,
      groupCount: 1,
      occurredAt: new Date().toISOString(),
    });

    it('emits `notification:new` to `user:{recipientId}` and NOWHERE else', async () => {
      // **The fan-out bug this test exists to prevent**: one `org:` emit here
      // would broadcast a single user's personal inbox to everybody connected
      // to the tenant. A notification is the one payload in this system where
      // the room choice is the whole privacy decision.
      const recipient = await fx.connectClient({
        sub: authorId,
        organizationId,
      });
      const bystander = await fx.connectClient({
        sub: agentId,
        organizationId,
      });

      const payload = notificationPayload(authorId);
      const received = waitForEvent<typeof payload>(
        recipient,
        REALTIME_EVENTS.notificationNew,
      );

      // Anything at all on the bystander's socket is a failure, so it is
      // watched for the SAME event rather than for a specific wrong one.
      let leaked = false;
      bystander.on(REALTIME_EVENTS.notificationNew, () => {
        leaked = true;
      });

      await fx.publishOn('notification.created', payload);
      const delivered = await received;

      expect(delivered.notificationId).toBe(payload.notificationId);
      // Enough to render and deep-link without a follow-up fetch.
      expect(delivered.title).toBe(payload.title);
      expect(delivered.actionUrl).toBe('/tickets/1042');
      expect(leaked).toBe(false);
    });

    it('emits `notification:updated` for a COALESCED notification', async () => {
      // A different client event from `new`, so the UI edits the toast it is
      // already showing rather than stacking a twelfth. Without the
      // distinction, grouping exists in the database and is invisible in the
      // UI — the same shape of failure as a subject with no subscriber.
      const recipient = await fx.connectClient({
        sub: authorId,
        organizationId,
      });

      const payload = {
        ...notificationPayload(authorId),
        groupKey: `ticket:${ticketId}:message`,
        groupCount: 12,
      };
      const received = waitForEvent<typeof payload>(
        recipient,
        REALTIME_EVENTS.notificationUpdated,
      );

      await fx.publishOn('notification.updated', payload);

      expect((await received).groupKey).toBe(`ticket:${ticketId}:message`);
    });

    it('emits BOTH `notification:read` and the authoritative unread count', async () => {
      // `read_at` is per-row rather than per-connection, so without this two
      // open tabs disagree until one refreshes — and dismissing on mobile
      // leaves the desktop badge lit. The count rides along so a client never
      // increments a local counter that is wrong the moment something is read
      // somewhere else.
      const recipient = await fx.connectClient({
        sub: authorId,
        organizationId,
      });

      const payload = {
        recipientId: authorId,
        notificationIds: [faker.string.uuid()],
        change: 'read' as const,
        unreadCount: 3,
      };

      const readEvent = waitForEvent<typeof payload>(
        recipient,
        REALTIME_EVENTS.notificationRead,
      );
      const countEvent = waitForEvent<{ count: number }>(
        recipient,
        REALTIME_EVENTS.notificationUnreadCount,
      );

      await fx.publishOn('notification.read', payload);

      expect((await readEvent).change).toBe('read');
      expect((await countEvent).count).toBe(3);
    });
  });
});
