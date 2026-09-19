import { faker } from '@faker-js/faker';
import {
  DOCUMENT_PATTERNS,
  TICKET_PATTERNS,
  TicketSource,
} from '@synapsedesk/common';
import { of } from 'rxjs';
import type { Socket as ClientSocket } from 'socket.io-client';
import { RealtimeFixture, bootstrapRealtimeTest } from '../utils';
import { timestamp } from '../fixtures/wire';
import {
  CLIENT_EVENTS,
  REALTIME_EVENTS,
} from '../../src/modules/realtime/realtime.config';

/**
 * Two gateway replicas, one Redis, one NATS: every realtime frame arrives once.
 *
 * **What a single-gateway suite cannot see.** Every replica holds its own core
 * NATS subscription, so every replica receives every event, and the Redis
 * adapter carries a broadcast to every replica's sockets. A relay that
 * broadcast cluster-wide delivered each event once PER REPLICA — two frames
 * per client under production's `replicas: 2` — and one gateway in-process
 * shows exactly one. So this suite boots two, each with its own subscription
 * and adapter, one client on each, and counts frames over a fixed window.
 *
 * The rows split along the rule `RealtimeGateway.relayToRoom` states:
 *
 * - an event that arrived over NATS is relayed to each replica's own sockets
 *   — once per client, however many replicas run;
 * - an event that started on one replica (presence, typing) must still cross
 *   to clients on the other — the rows that fail if `local` is over-applied.
 */
describe('Realtime across two gateway replicas (e2e)', () => {
  const organizationId = faker.string.uuid();
  const departmentId = faker.string.uuid();
  const ticketId = faker.string.uuid();
  const authorId = faker.string.uuid();
  const agentId = faker.string.uuid();

  /** Long enough for a second, duplicate frame to arrive if there is one. */
  const WINDOW_MS = 1_000;

  let a: RealtimeFixture;
  let b: RealtimeFixture | undefined;

  beforeAll(async () => {
    a = await bootstrapRealtimeTest();
  }, 30_000);

  afterAll(async () => {
    await b?.close();
    await a.close();
  });

  /** Frames of `event` a socket receives from now on, filtered by `match`. */
  const counter = <T>(
    socket: ClientSocket,
    event: string,
    match: (payload: T) => boolean = () => true,
  ) => {
    let frames = 0;
    socket.on(event, (payload: T) => {
      if (match(payload)) frames += 1;
    });

    return () => frames;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, WINDOW_MS));

  /** A member of the org and the department, as `user:{sub}`. */
  const member = (fx: RealtimeFixture, sub = faker.string.uuid()) =>
    fx.connectClient({
      sub,
      organizationId,
      departmentIds: [departmentId],
    });

  const ticketCreated = () => ({
    pattern: TICKET_PATTERNS.created,
    organizationId,
    ticketId: faker.string.uuid(),
    occurredAt: new Date().toISOString(),
    ticketNumber: 42,
    authorId,
    source: TicketSource.WEB,
    title: 'Printer is on fire',
  });

  const notificationCreated = (recipientId: string) => ({
    organizationId,
    recipientId,
    notificationId: faker.string.uuid(),
    type: 'ticket.assigned',
    priority: 'NORMAL',
    title: 'Ticket #42 assigned to you',
    body: null,
    data: { ticketId },
    actionUrl: null,
    groupKey: null,
    groupCount: 1,
    occurredAt: new Date().toISOString(),
  });

  const documentIndexed = (uploaderId: string) => ({
    pattern: DOCUMENT_PATTERNS.indexed,
    organizationId,
    documentId: faker.string.uuid(),
    occurredAt: new Date().toISOString(),
    chunkCount: 3,
    uploaderId,
    title: 'Q3 Redundancy Plan',
    isOrganizationWide: false,
    departmentIds: [departmentId],
  });

  it('control — ONE gateway delivers each relayed event once', async () => {
    // The floor under every row below: with one replica the counter reads 1,
    // so a 2 there is the second replica and not the harness.
    const client = await member(a);
    const ticket = counter(client, REALTIME_EVENTS.ticketCreated);

    await a.publish(ticketCreated());
    await settle();

    expect(ticket()).toBe(1);
  });

  describe('with a second gateway', () => {
    beforeAll(async () => {
      b = await bootstrapRealtimeTest();
    }, 30_000);

    it('**`ticket.created` reaches a client on EACH replica once** (`org:`)', async () => {
      const onA = await member(a);
      const onB = await member(b!);
      const seenOnA = counter(onA, REALTIME_EVENTS.ticketCreated);
      const seenOnB = counter(onB, REALTIME_EVENTS.ticketCreated);

      await a.publish(ticketCreated());
      await settle();

      expect([seenOnA(), seenOnB()]).toEqual([1, 1]);
    });

    it('**`notification.created` reaches its recipient once, on either replica** (`user:`)', async () => {
      const recipient = faker.string.uuid();
      const onA = await member(a, recipient);
      const onB = await member(b!, recipient);
      const seenOnA = counter(onA, REALTIME_EVENTS.notificationNew);
      const seenOnB = counter(onB, REALTIME_EVENTS.notificationNew);

      await a.publishOn('notification.created', notificationCreated(recipient));
      await settle();

      expect([seenOnA(), seenOnB()]).toEqual([1, 1]);
    });

    it('**`document.indexed` reaches an uploader in TWO of its rooms once** (`user:` + `dept:`, one emit)', async () => {
      // The `relayToRooms` case: the uploader is in `user:{uploader}` AND the
      // document's `dept:` room, so both the replica count and the room count
      // could double this frame.
      const uploader = faker.string.uuid();
      const onA = await member(a, uploader);
      const onB = await member(b!, uploader);
      const seenOnA = counter(onA, REALTIME_EVENTS.documentIndexed);
      const seenOnB = counter(onB, REALTIME_EVENTS.documentIndexed);

      await a.publishOn(DOCUMENT_PATTERNS.indexed, documentIndexed(uploader));
      await settle();

      expect([seenOnA(), seenOnB()]).toEqual([1, 1]);
    });

    it('**a presence change on A reaches a colleague on B once** — started on one replica, so it must cross', async () => {
      // A REAL change is the trigger: presence emits only when the stored
      // state changes, and both replicas share one Redis. So a fresh user sets
      // a state, and only frames about that user and that state are counted —
      // their connect-time `online` frame is a different frame (known gap #13).
      const changer = faker.string.uuid();
      const colleagueOnB = await member(b!);
      const onA = await member(a, changer);
      const seenOnB = counter<{ data: { userId: string; state: string } }>(
        colleagueOnB,
        REALTIME_EVENTS.presence,
        ({ data }) => data.userId === changer && data.state === 'busy',
      );

      await onA.emitWithAck(CLIENT_EVENTS.presenceUpdate, { state: 'busy' });
      await settle();

      expect(seenOnB()).toBe(1);
    });

    it('**typing on A reaches the other participant on B once, and never the typist**', async () => {
      // `ticket:join` authorizes through `getTicket`, and each replica has its
      // own stubbed peers — so both are programmed.
      const wireTicket = {
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
        currentDepartmentId: departmentId,
        unreadCount: 0,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      };
      a.stubs.ticket.getTicket.mockReturnValue(of(wireTicket));
      b!.stubs.ticket.getTicket.mockReturnValue(of(wireTicket));

      const join = async (fx: RealtimeFixture, sub: string) => {
        const socket = await fx.connectClient({ sub, organizationId });
        const joined = new Promise((resolve) =>
          socket.once(REALTIME_EVENTS.ticketJoined, resolve),
        );
        socket.emit(CLIENT_EVENTS.ticketJoin, ticketId);
        await joined;

        return socket;
      };

      const typist = await join(a, authorId);
      const watcherOnB = await join(b!, agentId);
      const seenOnB = counter(watcherOnB, REALTIME_EVENTS.typing);
      const echoed = counter(typist, REALTIME_EVENTS.typing);

      typist.emit(CLIENT_EVENTS.typingStart, ticketId);
      await settle();

      expect([seenOnB(), echoed()]).toEqual([1, 0]);
    });
  });
});
