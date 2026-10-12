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

import { connect, JSONCodec, type NatsConnection } from 'nats';
import { io, type Socket } from 'socket.io-client';
import { sign } from 'jsonwebtoken';
import {
  CLIENT_EVENTS,
  orgRoom,
  OrgStatus,
  REALTIME_EVENTS,
  REALTIME_SOCKET,
  TICKET_PATTERNS,
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
