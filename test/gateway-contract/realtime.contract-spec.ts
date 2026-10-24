/**
 * @file Realtime across TWO gateway processes, and the response cache.
 *
 * **Two instances, deliberately.** One replica delivers each relayed event
 * once whatever the relay does, which is why 965 in-process tests never saw
 * gap 36 and why this row exists: the property is "one frame per client,
 * however many gateways run", and it only has an expression with more than one
 * of them. The Java gateway inherits the same rule, so this is the row that
 * will catch a Java relay that broadcasts cluster-wide.
 *
 * The cache rows use the peer RECORDING rather than a header: nothing on the
 * wire marks a cached read (the `x-cache` extension is in the OpenAPI
 * document, not the response), so "served from cache" means "the peer was not
 * called again".
 */

import { randomUUID } from 'node:crypto';
import { connect, JSONCodec, type NatsConnection } from 'nats';
import { io, type Socket } from 'socket.io-client';
import { sign } from 'jsonwebtoken';
import {
  NOTIFICATION_REALTIME_PATTERNS,
  CLIENT_EVENTS,
  orgRoom,
  OrgStatus,
  REALTIME_EVENTS,
  REALTIME_SOCKET,
  TICKET_PATTERNS,
  type TicketViewersPayload,
} from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('realtime across replicas, and the cache', () => {
  const ORGANIZATION = '55555555-5555-4555-8555-555555555555';
  const ALICE = '66666666-6666-4666-8666-666666666666';
  const BOB = '77777777-7777-4777-8777-777777777777';
  const CAROL = '99999999-9999-4999-8999-999999999999';
  /** An agent by ticket-service's definition; `role.read` alone is an end user. */
  const AGENT = ['ticket.read.all'];
  const WINDOW_MS = 1_000;

  let peers: Peers;
  let first: Gateway;
  let second: Gateway;
  let nats: NatsConnection;
  const sockets: Socket[] = [];

  const token = (sub: string, permissionCodes = ['role.read']) =>
    sign(
      {
        sub,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  /** A connected client, as a browser connects: websocket, cookie, `/ws`. */
  const connectClient = async (
    gateway: Gateway,
    sub: string,
    permissionCodes?: string[],
  ) => {
    const socket = io(`${gateway.wsUrl}${REALTIME_SOCKET.namespace}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: {
        cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${token(sub, permissionCodes)}`,
      },
    });
    sockets.push(socket);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no connection:ready')),
        10_000,
      );
      socket.once(REALTIME_EVENTS.connectionReady, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    return socket;
  };

  const counter = (socket: Socket, event: string) => {
    let frames = 0;
    socket.on(event, () => (frames += 1));

    return () => frames;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, WINDOW_MS));

  /**
   * `ticket.created` as a Nest `ClientProxy` publishes it: the `{pattern,
   * data}` envelope. A raw publish of the event itself reaches the handler as
   * `undefined` — the rule `nats.config.ts` states.
   */
  const publishCreated = async (authorId: string) => {
    const event = {
      pattern: TICKET_PATTERNS.created,
      organizationId: ORGANIZATION,
      ticketId: '88888888-8888-4888-8888-888888888888',
      occurredAt: new Date().toISOString(),
      ticketNumber: 42,
      authorId,
      source: 1,
      title: 'Printer is on fire',
    };
    nats.publish(
      TICKET_PATTERNS.created,
      JSONCodec().encode({ pattern: TICKET_PATTERNS.created, data: event }),
    );
    await nats.flush();
    await settle();
  };

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });

    const env = { ...peers.env, REDIS_URL: redisUrl, NATS_URL: natsUrl };
    first = await startGateway(env);
    second = await startGateway(env);
    nats = await connect({ servers: natsUrl });
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await nats?.drain();
    await first?.stop();
    await second?.stop();
    await peers?.stop();
  });

  rowFor('Tickets')(
    '**a relayed `ticket.*` event reaches a client on EACH replica exactly once**',
    async () => {
      // Both agents; ALICE also wrote it, and is in both rooms it goes to.
      const onFirst = await connectClient(first, ALICE, AGENT);
      const onSecond = await connectClient(second, BOB, AGENT);
      const seenFirst = counter(onFirst, REALTIME_EVENTS.ticketCreated);
      const seenSecond = counter(onSecond, REALTIME_EVENTS.ticketCreated);

      await publishCreated(ALICE);

      expect([seenFirst(), seenSecond()]).toEqual([1, 1]);
    },
  );

  rowFor('Notifications')(
    '**a read event reaches the user as `notification:unread-count` with its `countedAt`**',
    async () => {
      const socket = await connectClient(first, ALICE);
      const received = new Promise<unknown>((resolve) =>
        socket.once(REALTIME_EVENTS.notificationUnreadCount, resolve),
      );

      const event = {
        recipientId: ALICE,
        notificationIds: ['99999999-9999-4999-8999-999999999999'],
        change: 'read',
        unreadCount: 3,
        countedAt: '2026-10-24T10:00:00.123456Z',
      };
      nats.publish(
        NOTIFICATION_REALTIME_PATTERNS.read,
        JSONCodec().encode({
          pattern: NOTIFICATION_REALTIME_PATTERNS.read,
          data: event,
        }),
      );
      await nats.flush();

      await expect(received).resolves.toEqual({
        count: 3,
        countedAt: '2026-10-24T10:00:00.123456Z',
      });
    },
  );

  rowFor('Tickets')(
    '**`ticket:created` reaches the agents and the author, never a colleague**',
    async () => {
      const author = await connectClient(first, CAROL);
      const colleague = await connectClient(second, BOB);
      const agent = await connectClient(second, ALICE, AGENT);
      const seen = [author, colleague, agent].map((socket) =>
        counter(socket, REALTIME_EVENTS.ticketCreated),
      );

      await publishCreated(CAROL);

      expect(seen.map((frames) => frames())).toEqual([1, 0, 1]);
    },
  );

  rowFor('Tickets')(
    '**`ticket:viewers` names the agents in a ticket across replicas, never to an end user**',
    async () => {
      // A fresh ticket per run: the set lives in the run's Redis.
      const ticketId = randomUUID();
      peers.ticket.on('TicketService/GetTicket').always({
        id: ticketId,
        ticketNumber: 7,
        organizationId: ORGANIZATION,
        authorId: CAROL,
        source: 2,
        status: 1,
        priority: 2,
        title: 'Printer is on fire',
        description: 'It is genuinely on fire',
        unreadCount: 0,
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
        updatedAt: { seconds: 1_756_684_800, nanos: 0 },
      });
      peers.auth.on('UserService/ListUsersByIds').always({
        summaries: [
          { userId: ALICE, fullName: 'Alice Agent' },
          { userId: BOB, fullName: 'Bob Agent' },
        ],
      });

      const alice = await connectClient(first, ALICE, AGENT);
      const bob = await connectClient(second, BOB, AGENT);
      const carol = await connectClient(first, CAROL);
      const lists = (socket: Socket) => {
        const seen: string[][] = [];
        socket.on(
          REALTIME_EVENTS.ticketViewers,
          (frame: { data: TicketViewersPayload }) =>
            seen.push(frame.data.viewers.map((viewer) => viewer.id).sort()),
        );
        return seen;
      };
      const [toAlice, toBob, toCarol] = [alice, bob, carol].map(lists);
      const join = async (socket: Socket) => {
        const joined = new Promise((resolve) =>
          socket.once(REALTIME_EVENTS.ticketJoined, resolve),
        );
        socket.emit(CLIENT_EVENTS.ticketJoin, { ticketId });
        await joined;
      };

      for (const socket of [alice, bob, carol]) await join(socket);
      await settle();

      const both = [ALICE, BOB].sort();
      expect([toAlice.at(-1), toBob.at(-1), toCarol]).toEqual([both, both, []]);

      bob.close();
      await settle();

      expect(toAlice.at(-1)).toEqual([ALICE]);
    },
  );

  rowFor('Tickets')(
    '**presence still CROSSES replicas** — the row that fails if `local` is over-applied',
    async () => {
      const watcher = await connectClient(second, BOB);
      const changer = await connectClient(first, ALICE);

      let seen = 0;
      watcher.on(
        REALTIME_EVENTS.presence,
        (frame: { data: { userId: string; state: string } }) => {
          if (frame.data.userId === ALICE && frame.data.state === 'busy') {
            seen += 1;
          }
        },
      );

      await changer.emitWithAck(CLIENT_EVENTS.presenceUpdate, {
        state: 'busy',
      });
      await settle();

      expect(seen).toBe(1);
      // And the room it was addressed to is the tenant's, not a ticket's.
      expect(orgRoom(ORGANIZATION)).toBe(`org:${ORGANIZATION}`);
    },
  );

  rowFor('Permissions')(
    '**a cached read does not reach the peer twice**',
    async () => {
      // Half the cache class: the eviction rows — a mutation, and the NATS
      // event — are still to write, and they assert the opposite (the peer IS
      // called again).
      const session = new Session(first.baseUrl);
      const headers = {
        cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${token(ALICE)}`,
      };
      peers.auth.on('RoleService/ListPermissions').always({
        items: [
          { id: '1', code: 'role.read', name: 'Read roles', group: 'role' },
        ],
      });

      const firstRead = await session.get(`${API}/permissions`, headers);
      const secondRead = await session.get(`${API}/permissions`, headers);

      expect([firstRead.status, secondRead.status]).toEqual([200, 200]);
      expect(peers.auth.calls('RoleService/ListPermissions')).toHaveLength(1);
    },
  );
});
