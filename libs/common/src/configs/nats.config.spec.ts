// Before the deserializer: loading it evaluates Nest's decorators.
import 'reflect-metadata';
import { NatsRequestJSONDeserializer } from '@nestjs/microservices/deserializers';
import { JSONCodec } from 'nats';
import {
  NOTIFICATION_REALTIME_PATTERNS,
  NotificationPriority,
  type NotificationReadPayload,
  type NotificationRealtimePayload,
} from '../contracts/notification.contract';
import {
  STORAGE_PATTERNS,
  SupersededReason,
  type ObjectSupersededEvent,
} from '../contracts/storage.contract';
import {
  TICKET_PATTERNS,
  type TicketAssignedEvent,
} from '../contracts/ticket.contract';
import { ConfigService } from '@nestjs/config';
import { assertDurableStore, createNatsTransport } from './nats.config';

/**
 * The check that keeps `-sd /data` from silently regressing.
 *
 * Worth unit-testing rather than trusting to a boot that "works on my machine":
 * the failure it guards is invisible until a container is recreated, which is
 * the one moment nobody is watching the logs.
 */
describe('assertDurableStore', () => {
  const varz = (body: unknown, ok = true) =>
    jest.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 503,
      json: () => Promise.resolve(body),
    });

  afterEach(() => {
    // @ts-expect-error — restoring the global we replaced per test.
    delete global.fetch;
  });

  it('1. accepts a store on a mounted volume', async () => {
    global.fetch = varz({
      jetstream: { config: { store_dir: '/data/jetstream' } },
    });

    await expect(
      assertDurableStore('http://nats:8222'),
    ).resolves.toBeUndefined();
  });

  it('2. **REFUSES a /tmp store, naming the flag that fixes it**', async () => {
    // The default, and the whole reason this function exists. An operator
    // reading this message should not have to find the doc.
    global.fetch = varz({
      jetstream: { config: { store_dir: '/tmp/nats/jetstream' } },
    });

    await expect(assertDurableStore('http://nats:8222')).rejects.toThrow(
      /-sd \/data/,
    );
  });

  it('3. **refuses a broker with no JetStream at all**', async () => {
    // `-js` missing entirely. Every publish falls back to core silently, which
    // is indistinguishable from success at the publisher.
    global.fetch = varz({ server_id: 'NABC' });

    await expect(assertDurableStore('http://nats:8222')).rejects.toThrow(
      /not running with -js/,
    );
  });

  it('4. refuses when the monitoring port cannot be read', async () => {
    // Not "assume it is fine": an unreadable broker is an unverified one, and
    // the whole point is to not start against an unverified store.
    global.fetch = varz({}, false);

    await expect(assertDurableStore('http://nats:8222')).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it('5. tolerates a trailing slash on the URL', async () => {
    const fetchMock = varz({
      jetstream: { config: { store_dir: '/data/jetstream' } },
    });
    global.fetch = fetchMock;

    await assertDurableStore('http://nats:8222/');

    expect(fetchMock).toHaveBeenCalledWith('http://nats:8222/varz');
  });
});

/**
 * What an `@EventPattern` handler receives from a NON-Nest publisher.
 *
 * Runs the deserializer `createNatsTransport` installs by leaving the pair
 * unset — the real symbol, because a reimplementation of its `isExternal`
 * rule here would only confirm itself. The rule, as the `nats.config.ts`
 * comment states it: a payload with a top-level `pattern` or `data` is taken
 * as Nest's own `{pattern, data}` record, and the handler gets its `.data`.
 */
describe('a raw NATS publish, as the transport decodes it', () => {
  const codec = JSONCodec();
  const deserializer = new NatsRequestJSONDeserializer();

  /** The `data` a handler subscribed to `channel` would be called with. */
  const handlerReceives = (channel: string, payload: unknown): unknown =>
    (
      deserializer.deserialize(codec.encode(payload), { channel }) as {
        data?: unknown;
      }
    ).data;

  it('0. the transport leaves both halves to Nest, so this IS the deserializer that runs', () => {
    const { options } = createNatsTransport(
      new ConfigService({ NATS_URL: 'nats://127.0.0.1:4222' }),
    );

    expect(options).not.toHaveProperty('deserializer');
    expect(options).not.toHaveProperty('serializer');
  });

  const assigned = {
    pattern: TICKET_PATTERNS.assigned,
    organizationId: 'org-1',
    ticketId: 'ticket-1',
    occurredAt: '2026-09-18T00:00:00.000Z',
    ticketNumber: 4211,
    assignedToId: 'user-2',
    departmentId: 'dept-1',
    assignedById: 'user-1',
  } satisfies TicketAssignedEvent;

  it('**1. a raw tagged event arrives as `undefined`** — its `pattern` reads as an envelope', () => {
    expect(handlerReceives(TICKET_PATTERNS.assigned, assigned)).toBeUndefined();
  });

  it('2. the same event in the `{pattern, data}` envelope a ClientProxy sends arrives whole', () => {
    expect(
      handlerReceives(TICKET_PATTERNS.assigned, {
        pattern: TICKET_PATTERNS.assigned,
        data: assigned,
      }),
    ).toEqual(assigned);
  });

  it('3. an untagged event arrives whole — mapped onto its subject', () => {
    const superseded = {
      objectPath: 'avatars/user-1/old.png',
      reason: SupersededReason.REPLACED,
    } satisfies ObjectSupersededEvent;

    expect(
      handlerReceives(STORAGE_PATTERNS.objectSuperseded, superseded),
    ).toEqual(superseded);
  });

  it('**4. a payload with its own `data` field arrives as that INNER field** — silently the wrong object', () => {
    const created = {
      organizationId: 'org-1',
      recipientId: 'user-2',
      notificationId: 'notification-1',
      type: 'ticket.assigned',
      priority: NotificationPriority.NORMAL,
      title: 'Ticket #4211 assigned to you',
      body: null,
      data: { ticketId: 'ticket-1' },
      actionUrl: null,
      groupKey: null,
      groupCount: 1,
      occurredAt: '2026-09-18T00:00:00.000Z',
    } satisfies NotificationRealtimePayload;

    expect(
      handlerReceives(NOTIFICATION_REALTIME_PATTERNS.created, created),
    ).toEqual({ ticketId: 'ticket-1' });
  });

  it('5. a payload with neither key arrives whole', () => {
    const read = {
      recipientId: 'user-2',
      notificationIds: ['notification-1'],
      change: 'read',
      unreadCount: 0,
    } satisfies NotificationReadPayload;

    expect(handlerReceives(NOTIFICATION_REALTIME_PATTERNS.read, read)).toEqual(
      read,
    );
  });
});
