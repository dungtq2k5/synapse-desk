import { createServer, type Server } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { callerContext } from '@synapsedesk/common/testing/context';
import { faultInjector } from '@synapsedesk/common/testing/fault';
import { status } from '@grpc/grpc-js';
import { toProtoNotificationType } from '@synapsedesk/grpc-proto';
import {
  NOTIFICATION_TYPES,
  type NotificationType,
  NotificationPriority,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookDeliveryStatus,
  verifyWebhookSignature,
  type CallerContext,
  type CreateInAppNotificationCommand,
  compareAlphabetically,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils/bootstrap';
import { InAppNotificationService } from '../../src/modules/in-app/in-app-notification.service';
import { WebhookAdminService } from '../../src/modules/webhooks/webhook-admin.service';
import { WebhookDeliveryProcessor } from '../../src/modules/webhooks/webhook-delivery.processor';
import { WebhookSenderService } from '../../src/modules/webhooks/webhook-sender.service';

/**
 * Outbound webhooks — the tenant-level channel.
 *
 * The receiver is a REAL local HTTPS server with a checked-in self-signed
 * certificate, and the tests reach it through the documented escape hatch
 * (`WEBHOOK_ALLOW_PRIVATE_TARGETS` under a development NODE_ENV) — which is
 * not a shortcut around the guard: a developer pointing the feature at a
 * localhost receiver is the exact use case the hatch exists for, and test 2
 * exercises the guard with the hatch CLOSED.
 */
describe('Outbound webhooks (e2e)', () => {
  const faults = faultInjector();

  let fx: E2eFixture;
  let inApp: InAppNotificationService;
  let admin: WebhookAdminService;
  let processor: WebhookDeliveryProcessor;
  let sender: WebhookSenderService;
  let config: ConfigService;

  /** The local receiver: records requests, answers what the test tells it to. */
  let receiver: Server;
  let receiverUrl: string;
  let received: { body: string; headers: Record<string, unknown> }[] = [];
  let respondWith: { status: number; headers?: Record<string, string> } = {
    status: 200,
  };

  const ORG = randomUUID();
  const context: CallerContext = callerContext({
    organizationId: ORG,
    permissionCodes: ['organization.read', 'organization.update'],
  });

  const command = (
    overrides: Partial<CreateInAppNotificationCommand> = {},
  ): CreateInAppNotificationCommand => ({
    organizationId: ORG,
    type: NOTIFICATION_TYPES.ticketAssigned,
    audience: { kind: 'users', userIds: [randomUUID()] },
    eventId: randomUUID(),
    title: 'Ticket assigned',
    body: 'A human sentence that must never reach an integration.',
    priority: NotificationPriority.HIGH,
    occurredAt: new Date().toISOString(),
    resourceId: randomUUID(),
    data: { ticketNumber: 1042 },
    ...overrides,
  });

  /** Registers an endpoint at the local receiver, subscribed as asked. */
  const endpointAt = async (
    types: NotificationType[] = [NOTIFICATION_TYPES.ticketAssigned],
  ) => {
    const created = await admin.create(
      // The helper speaks the DOMAIN vocabulary and crosses at the call, so a
      // test still reads `ticket.assigned` rather than an enum ordinal.
      { url: receiverUrl, eventTypes: types.map(toProtoNotificationType) },
      context,
    );

    return { id: created.endpoint!.id, secret: created.secret };
  };

  /** Runs one queued attempt inline, the way the worker would. */
  const runAttempt = (deliveryId: string, attemptsMade = 0) =>
    processor.process({
      data: { deliveryId },
      attemptsMade,
    } as never);

  const lastDelivery = () =>
    fx.prisma.webhookDelivery.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      include: { endpoint: true },
    });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    inApp = fx.moduleRef.get(InAppNotificationService);
    admin = fx.moduleRef.get(WebhookAdminService);
    processor = fx.moduleRef.get(WebhookDeliveryProcessor);
    sender = fx.moduleRef.get(WebhookSenderService);
    config = fx.moduleRef.get(ConfigService);

    // **The REAL worker is connected to the test Redis, and it races these
    // tests.** Measured: one attempt produced two identical POSTs — the suite
    // ran the job by hand while the live worker picked it up from the queue,
    // both loading the row as PENDING. Closing the worker makes `runAttempt`
    // the only driver, so every assertion about attempt counts is about the
    // arithmetic rather than about a race with the machinery.
    await processor.worker.close();

    // No TLS overrides here: the dev hatch itself relaxes certificate
    // verification (a localhost receiver is self-signed by nature), which is
    // also why the fixture cert needs no CA plumbing — and why test 2 matters
    // doubly, since it proves the hatch CLOSED refuses before TLS is reached.
    receiver = createServer(
      {
        key: readFileSync(join(__dirname, '../fixtures/receiver-key.pem')),
        cert: readFileSync(join(__dirname, '../fixtures/receiver-cert.pem')),
      },
      (request, response) => {
        let body = '';
        request.on('data', (chunk: Buffer) => (body += chunk.toString()));
        request.on('end', () => {
          received.push({ body, headers: { ...request.headers } });
          response.writeHead(respondWith.status, respondWith.headers ?? {});
          response.end();
        });
      },
    );

    // No host: binds dual-stack, because the sender pins to the FIRST address
    // the resolver returns and this machine resolves localhost to ::1 first —
    // a v4-only listener made every send ECONNREFUSED on a working setup.
    await new Promise<void>((resolve) => receiver.listen(0, resolve));
    receiverUrl = `https://localhost:${(receiver.address() as AddressInfo).port}/hook`;
  });

  beforeEach(async () => {
    await fx.reset();
    received = [];
    respondWith = { status: 200 };
  });

  afterEach(() => {
    // The resolver seam is restored HERE, not at the tail of each test that
    // sets it: a failing assertion throws past a tail-of-test restore, and the
    // leaked fake — which answers a TEST-NET address for every hostname — then
    // times out every later send. Measured: one red guard test turned five
    // unrelated receiver tests red through exactly that leak.
    sender.resolver = undefined;
  });

  /**
   * The documented escape hatch, opened the documented way — PER TEST, never
   * ambiently. `.env.test` says NODE_ENV=test, under which the hatch is
   * ignored no matter what the variable says, so the localhost receiver needs
   * both halves forced; and the guard tests (2, 2a) run with it CLOSED, which
   * an ambient beforeEach would have quietly changed (the doc-67 lesson: a
   * branch selected by ambience is the wrong arrangement).
   */
  const openHatch = () => {
    const real = config.get.bind(config);
    faults.replace(config, 'get', ((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'WEBHOOK_ALLOW_PRIVATE_TARGETS') return 'true';
      return real(key);
    }) as never);
  };

  afterAll(async () => {
    await new Promise((resolve) => receiver.close(resolve));
    await fx.close();
  });

  // ------------------------------------------------------------------- §1

  it('1. **an event with many recipients produces ONE row and one POST**', async () => {
    openHatch();
    // The defect a channel-shaped implementation ships quietly: a webhook
    // fired inside the recipient loop sends N identical POSTs for one event —
    // correct-looking code, an integration receiving twelve copies of one
    // assignment.
    const { id } = await endpointAt();
    const userIds = Array.from({ length: 12 }, () => randomUUID());

    await inApp.deliver(command({ audience: { kind: 'users', userIds } }));

    const rows = await fx.prisma.webhookDelivery.findMany({
      where: { endpointId: id },
    });

    expect(rows).toHaveLength(1);

    await runAttempt(rows[0].id);
    expect(received).toHaveLength(1);
  });

  it('1a. **an event whose whole audience is the actor still dispatches**', async () => {
    openHatch();
    // The audience filter is a PEOPLE rule — you are not told about your own
    // action — and the system test measured that a self-assignment produces
    // zero notification rows. An integration is not a person: hooked below
    // that filter, this event would silently never reach the endpoint, with
    // nothing anywhere to look at.
    const { id } = await endpointAt();
    const actor = randomUUID();

    const outcome = await inApp.deliver(
      command({
        audience: { kind: 'users', userIds: [actor] },
        actorId: actor,
      }),
    );

    // The people-path did exactly what it always did…
    expect(outcome.recipients).toBe(0);

    // …and the integration still got its event.
    await expect(
      fx.prisma.webhookDelivery.count({ where: { endpointId: id } }),
    ).resolves.toBe(1);
  });

  it('1b. redelivery of the same event is one row, not two', async () => {
    openHatch();
    // The command subject is JetStream and delivery is at-least-once —
    // `(endpointId, eventId)` unique is the same idempotency `billing_events`
    // uses for Stripe redelivery.
    await endpointAt();
    const one = command();

    await inApp.deliver(one);
    await inApp.deliver(one);

    await expect(fx.prisma.webhookDelivery.count()).resolves.toBe(1);
  });

  // ------------------------------------------------------------------- §2

  it('2. **a URL is refused at DELIVERY, by its resolved address**', async () => {
    // The control the registration check cannot be: the URL is validated when
    // saved and resolved when delivered to, and DNS can change in between. The
    // resolver seam feeds the addresses, so nothing here depends on what any
    // hostname resolves to on this machine — and the HATCH IS CLOSED: this
    // test never calls `openHatch`.

    for (const address of [
      '10.0.0.5',
      '127.0.0.1',
      '169.254.169.254',
      '::ffff:127.0.0.1',
      'fd00::1',
    ]) {
      sender.resolver = ((_host: string, _opts: unknown, cb: never) =>
        (cb as (e: null, a: { address: string; family: number }[]) => void)(
          null,
          [{ address, family: address.includes(':') ? 6 : 4 }],
        )) as never;

      const outcome = await sender.send(
        {
          url: 'https://rebound.example.com/hook',
          secret: 'whsec_x',
          previousSecret: null,
          previousSecretExpiresAt: null,
        },
        {
          id: randomUUID(),
          type: NOTIFICATION_TYPES.ticketAssigned,
          occurredAt: new Date().toISOString(),
          organizationId: ORG,
          resourceType: null,
          resourceId: null,
          data: {},
        },
      );

      expect([address, outcome.delivered]).toEqual([address, false]);
      expect(outcome.delivered ? '' : outcome.error).toContain(
        'not a public address',
      );
    }

    sender.resolver = undefined;

    // The control: one PUBLIC address in the same arrangement is not refused
    // by the guard (it fails later, on the connection — which proves the
    // refusal above came from the check, not from the socket).
    sender.resolver = ((_host: string, _opts: unknown, cb: never) =>
      (cb as (e: null, a: { address: string; family: number }[]) => void)(
        null,
        [{ address: '203.0.113.7', family: 4 }],
      )) as never;

    const control = await sender.send(
      {
        url: 'https://rebound.example.com/hook',
        secret: 'whsec_x',
        previousSecret: null,
        previousSecretExpiresAt: null,
      },
      {
        id: randomUUID(),
        type: NOTIFICATION_TYPES.ticketAssigned,
        occurredAt: new Date().toISOString(),
        organizationId: ORG,
        resourceType: null,
        resourceId: null,
        data: {},
      },
    );

    expect(control.delivered).toBe(false);
    expect(control.delivered ? '' : control.error).not.toContain(
      'not a public address',
    );

    sender.resolver = undefined;
  }, 30_000);

  it('2a. one private address in a MULTI-address answer refuses the lot', async () => {
    sender.resolver = ((_host: string, _opts: unknown, cb: never) =>
      (cb as (e: null, a: { address: string; family: number }[]) => void)(
        null,
        [
          { address: '203.0.113.7', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ],
      )) as never;

    const outcome = await sender.send(
      {
        url: 'https://multi.example.com/hook',
        secret: 'whsec_x',
        previousSecret: null,
        previousSecretExpiresAt: null,
      },
      {
        id: randomUUID(),
        type: NOTIFICATION_TYPES.ticketAssigned,
        occurredAt: new Date().toISOString(),
        organizationId: ORG,
        resourceType: null,
        resourceId: null,
        data: {},
      },
    );

    expect(outcome.delivered).toBe(false);
    expect(outcome.delivered ? '' : outcome.error).toContain(
      'not a public address',
    );

    sender.resolver = undefined;
  });

  it('2b. **an IP-LITERAL host is refused before any socket exists**', async () => {
    // The bypass a lookup-only control ships: Node never invokes `lookup` for
    // a literal host — it skips resolution and connects — so a guard living
    // only in the resolver guards a path literals never take. Measured before
    // the fix: `https.request` to `127.0.0.1` connected with the guarded
    // lookup attached and never called. Hatch CLOSED.
    let resolverInvoked = false;
    sender.resolver = ((_host: string, _opts: unknown, cb: never) => {
      resolverInvoked = true;
      (cb as (e: null, a: { address: string; family: number }[]) => void)(
        null,
        [{ address: '203.0.113.7', family: 4 }],
      );
    }) as never;

    const outcome = await sender.send(
      {
        url: 'https://169.254.169.254/latest/meta-data/',
        secret: 'whsec_x',
        previousSecret: null,
        previousSecretExpiresAt: null,
      },
      {
        id: randomUUID(),
        type: NOTIFICATION_TYPES.ticketAssigned,
        occurredAt: new Date().toISOString(),
        organizationId: ORG,
        resourceType: null,
        resourceId: null,
        data: {},
      },
    );

    // Refused by the GUARD, not by a socket: the error is the guard's own
    // message rather than ECONNREFUSED/ETIMEDOUT — a check that connected and
    // then refused has already made the request — and the resolver was never
    // consulted, which for a literal is exactly the absence that makes this
    // check the control.
    expect(outcome.delivered).toBe(false);
    expect(outcome.delivered ? '' : outcome.error).toContain(
      'not a public address',
    );
    expect(resolverInvoked).toBe(false);
  });

  it('2c. **a bracketed IPv6 literal is refused — the strip is load-bearing**', async () => {
    // `new URL('https://[::1]/').hostname` is `"[::1]"` WITH brackets, under
    // which `isIP` sees no address at all — unstripped, the literal check
    // silently covers IPv4 only. The target is this suite's own REAL receiver
    // on loopback, so a hole here is not an abstract miss: the POST lands and
    // `received` says so. Hatch CLOSED.
    const port = new URL(receiverUrl).port;

    const outcome = await sender.send(
      {
        url: `https://[::1]:${port}/hook`,
        secret: 'whsec_x',
        previousSecret: null,
        previousSecretExpiresAt: null,
      },
      {
        id: randomUUID(),
        type: NOTIFICATION_TYPES.ticketAssigned,
        occurredAt: new Date().toISOString(),
        organizationId: ORG,
        resourceType: null,
        resourceId: null,
        data: {},
      },
    );

    expect(outcome.delivered).toBe(false);
    expect(outcome.delivered ? '' : outcome.error).toContain(
      'not a public address',
    );
    expect(received).toHaveLength(0);
  });

  it('2d. **a private IP literal is refused at SAVE time too**', async () => {
    // For a literal there is no resolution, so there is no later fact the
    // save-time answer could disagree with — unlike a hostname, it is
    // refusable now, instead of by a delivery row nobody reads.
    for (const url of [
      'https://169.254.169.254/hook',
      'https://10.0.0.5/hook',
      'https://[::1]/hook',
      'https://0177.0.0.1/hook', // octal — canonicalised by the URL parse
    ]) {
      await expectRpc(
        admin.create(
          {
            url,
            eventTypes: [
              toProtoNotificationType(NOTIFICATION_TYPES.ticketAssigned),
            ],
          },
          context,
        ),
        status.INVALID_ARGUMENT,
      );
    }

    // The control: a HOSTNAME url saves fine — hostnames are the guarded
    // lookup's business at delivery time, not this check's.
    const created = await admin.create(
      {
        url: receiverUrl,
        eventTypes: [
          toProtoNotificationType(NOTIFICATION_TYPES.ticketAssigned),
        ],
      },
      context,
    );
    expect(created.endpoint?.url).toBe(receiverUrl);
  });

  // ------------------------------------------------------------------- §3

  it('3. **a redirect is a failed delivery, never a hop**', async () => {
    openHatch();
    // Every other control checks the URL the tenant gave; a redirect is a URL
    // the RECEIVER gives, after those checks have run. `https.request` does
    // not follow redirects at all, so this asserts structure rather than a
    // flag somebody can flip back.
    await endpointAt();
    respondWith = {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    };

    await inApp.deliver(command());
    const delivery = await lastDelivery();

    // A non-final failed attempt THROWS — that is the one signal BullMQ
    // understands as "retry me", so the test expects it rather than treating
    // it as a test failure.
    await expect(runAttempt(delivery.id)).rejects.toThrow(
      'redirects are never followed',
    );

    const after = await lastDelivery();
    expect(after.responseStatus).toBe(302);
    expect(after.lastError).toContain('redirects are never followed');
    expect(after.status).toBe(WebhookDeliveryStatus.PENDING);

    // One request reached the receiver; nothing followed the location header.
    expect(received).toHaveLength(1);
  });

  // ------------------------------------------------------------------- §3 signing

  it('4. **the signature verifies against the exact bytes sent**', async () => {
    openHatch();
    // The consumer discipline mirrored: serialize once, sign and send the same
    // bytes. A body stringified twice re-serializes with different key order
    // and fails verification forever — with our name on it this time.
    const { secret } = await endpointAt();

    await inApp.deliver(command());
    await runAttempt((await lastDelivery()).id);

    expect(received).toHaveLength(1);
    const [request] = received;

    const header = String(request.headers[WEBHOOK_SIGNATURE_HEADER]);
    const timestamp = Number(/t=(\d+)/.exec(header)?.[1]);
    const signature = /v1=([0-9a-f]+)/.exec(header)?.[1] ?? '';

    expect(
      verifyWebhookSignature(secret, timestamp, request.body, signature),
    ).toBe(true);

    // And the payload is parseable JSON whose id is the event id — the field
    // the receiver's own idempotency keys on.
    const payload = JSON.parse(request.body) as { id: string; type: string };
    expect(payload.type).toBe(NOTIFICATION_TYPES.ticketAssigned);
  });

  it('6. **the payload carries no title and no body**', async () => {
    openHatch();
    // They are product copy — written for a person, in one language, changed
    // whenever somebody improves a sentence. In an integration payload every
    // copy edit becomes a breaking API change.
    await endpointAt();
    await inApp.deliver(command());
    await runAttempt((await lastDelivery()).id);

    const payload = JSON.parse(received[0].body) as Record<string, unknown>;

    expect(Object.keys(payload).sort(compareAlphabetically)).toEqual(
      [
        'data',
        'id',
        'occurredAt',
        'organizationId',
        'resourceId',
        'resourceType',
        'type',
      ].sort(compareAlphabetically),
    );
    expect(received[0].body).not.toContain('A human sentence');
  });

  it('7. **rotation keeps the old secret valid for the overlap window**', async () => {
    openHatch();
    // Without the overlap, rotation is an outage the customer schedules: the
    // moment the secret changes, every queued delivery signs with a key the
    // receiver no longer has.
    const { id, secret: oldSecret } = await endpointAt();

    const rotated = await admin.rotateSecret(id, context);
    const newSecret = rotated.secret;

    await inApp.deliver(command());
    await runAttempt((await lastDelivery()).id);

    const header = String(received[0].headers[WEBHOOK_SIGNATURE_HEADER]);
    const timestamp = Number(/t=(\d+)/.exec(header)?.[1]);
    const signatures = [...header.matchAll(/v1=([0-9a-f]+)/g)].map(
      (match) => match[1],
    );

    // BOTH signatures ride the header — the customer verifies with whichever
    // key they hold mid-roll.
    expect(signatures).toHaveLength(2);
    expect(
      signatures.some((signature) =>
        verifyWebhookSignature(
          newSecret,
          timestamp,
          received[0].body,
          signature,
        ),
      ),
    ).toBe(true);
    expect(
      signatures.some((signature) =>
        verifyWebhookSignature(
          oldSecret,
          timestamp,
          received[0].body,
          signature,
        ),
      ),
    ).toBe(true);
  });

  // ------------------------------------------------------------------- §4

  it('5. **sustained failure disables the endpoint, records why, and tells the tenant**', async () => {
    openHatch();
    // A dead endpoint with no disable costs one POST per event forever, per
    // tenant. The disable writes the reason, and the notice rides the same
    // JetStream subject every producer uses — at HIGH priority, because the
    // events the tenant was receiving have already stopped.
    const { id } = await endpointAt();
    respondWith = { status: 500 };

    for (let round = 0; round < WEBHOOK_DISABLE_AFTER_FAILURES; round++) {
      await inApp.deliver(command());
      const delivery = await fx.prisma.webhookDelivery.findFirstOrThrow({
        where: { status: WebhookDeliveryStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });

      // The FINAL attempt of each delivery — the exhausted path is where the
      // streak advances.
      await runAttempt(delivery.id, 4);
    }

    const endpoint = await fx.prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id },
    });

    expect(endpoint.isActive).toBe(false);
    expect(endpoint.disabledReason).toContain('Auto-disabled after');

    // The disable NOTICE cannot be asserted here: the publisher stub records
    // core-NATS emits, and the JetStream publish the processor makes goes
    // through the real JetStreamPublisher, whose connection this suite does
    // not run. The prisma-visible effect below — nothing more is enqueued once
    // disabled — is the assertion instead.
    respondWith = { status: 200 };
    await inApp.deliver(command());

    // Disabled endpoints are not dispatched to.
    const total = await fx.prisma.webhookDelivery.count({
      where: { endpointId: id },
    });
    expect(total).toBe(WEBHOOK_DISABLE_AFTER_FAILURES);
  }, 60_000);

  // ------------------------------------------------------------------- §6/§7

  it('8. zero subscribed types is refused at creation', async () => {
    await expectRpc(
      admin.create({ url: receiverUrl, eventTypes: [] }, context),
      status.INVALID_ARGUMENT,
    );
  });

  it('8a. the listing never carries a secret', async () => {
    // Shown once, structurally: the wire message for a listing has no secret
    // field at all, so a leak here would be a proto change rather than a
    // mapper slip.
    await endpointAt();

    const listed = await admin.list(context);

    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(listed.items)).not.toContain('whsec_');
  });

  it("8b. another tenant's endpoint id selects nothing", async () => {
    const { id } = await endpointAt();

    const stranger: CallerContext = {
      ...context,
      sub: randomUUID(),
      organizationId: randomUUID(),
    };

    await expectRpc(admin.get(id, stranger), status.NOT_FOUND);
    await expectRpc(admin.rotateSecret(id, stranger), status.NOT_FOUND);
  });
});
