import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PERMISSION_CODES } from '@synapsedesk/contracts';
import {
  CLEAN,
  controllerCall,
  type IdTakingMethod,
  idTakingMethods,
  probeCall,
  superAdminReach,
  snapshot,
  tenantIdentifiers,
  wireRequest,
} from '@synapsedesk/grpc-proto/testing/tenant-probe';
import { memberContext, superAdminContext } from '@synapsedesk/testing/context';
import { E2eFixture, bootstrapE2eTest } from '../utils/bootstrap';
import { NotificationsGrpcController } from '../../src/modules/feed/notifications-grpc.controller';

/**
 * **The cross-tenant probe**: every RPC that takes an id, called by tenant
 * B's most privileged member on tenant A's ids, answers as it does for an id
 * that doesn't exist, names nothing of A's, and leaves A's rows as they were.
 *
 * The RPC list comes from the proto files (`idTakingMethods`), and the first
 * row holds this table to it: a new id-taking RPC fails here until it says
 * how to call it.
 */
describe('Cross-tenant probe: notification-service (e2e)', () => {
  let fx: E2eFixture;
  let controller: NotificationsGrpcController;

  const B = { organizationId: randomUUID(), user: randomUUID() };
  const asB = memberContext({ id: B.user, organizationId: B.organizationId }, [
    ...PERMISSION_CODES,
  ]);

  type A = Awaited<ReturnType<typeof seedA>>;

  /** Tenant A with one of everything this service stores. */
  async function seedA() {
    const organizationId = randomUUID();
    const user = randomUUID();
    const ticket = randomUUID();
    const notification = await fx.prisma.notification.create({
      data: {
        organizationId,
        recipientId: user,
        type: 'TICKET_ASSIGNED',
        title: 'Assigned',
        resourceType: 'TICKET',
        resourceId: ticket,
      },
    });
    const providerMessageId = `<${randomUUID()}@mail.test>`;
    await fx.prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: 'EMAIL',
        status: 'SENT',
        providerMessageId,
      },
    });
    await fx.prisma.notificationPreference.create({
      data: {
        organizationId,
        userId: user,
        type: 'TICKET_ASSIGNED',
        channel: 'EMAIL',
      },
    });
    const device = await fx.prisma.deviceToken.create({
      data: {
        organizationId,
        userId: user,
        token: randomUUID(),
        platform: 'ANDROID',
      },
    });
    const endpoint = await fx.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: 'https://hooks.example.test/a',
        eventTypes: ['ticket.created'],
        secret: 'whsec_a',
      },
    });
    await fx.prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventId: randomUUID(),
        eventType: 'ticket.created',
        payload: {},
        occurredAt: new Date(),
      },
    });
    await fx.prisma.inboundAutoReply.create({
      data: { organizationId, email: 'a@example.test', lastSentAt: new Date() },
    });

    return {
      organizationId,
      user,
      ticket,
      notification: notification.id,
      providerMessageId,
      device: device.id,
      endpoint: endpoint.id,
    };
  }

  type Row = { build: (a: A) => Record<string, unknown> } | { exempt: string };

  /** How to call each id-taking RPC with A's ids. */
  const PROBE: Record<string, Row> = {
    'NotificationService/ResolveTicketByMessageId': {
      // Service-to-service: the tenant is the request field. B naming its own
      // tenant must not resolve A's mail.
      build: (a) => ({
        providerMessageId: a.providerMessageId,
        organizationId: B.organizationId,
      }),
    },
    'NotificationService/MarkRead': { build: (a) => ({ id: a.notification }) },
    'NotificationService/Archive': { build: (a) => ({ id: a.notification }) },
    'NotificationService/MarkManyRead': {
      build: (a) => ({
        ids: [a.notification],
        resourceId: a.ticket,
        resourceType: 1,
      }),
    },
    'NotificationService/ForgetDevice': { build: (a) => ({ id: a.device }) },
    'NotificationService/GetWebhookEndpoint': {
      build: (a) => ({ endpointId: a.endpoint }),
    },
    'NotificationService/UpdateWebhookEndpoint': {
      build: (a) => ({
        endpointId: a.endpoint,
        description: 'B was here',
        isActive: false,
      }),
    },
    'NotificationService/DeleteWebhookEndpoint': {
      build: (a) => ({ endpointId: a.endpoint }),
    },
    'NotificationService/RotateWebhookSecret': {
      build: (a) => ({ endpointId: a.endpoint }),
    },
    'NotificationService/TestWebhookEndpoint': {
      build: (a) => ({ endpointId: a.endpoint }),
    },
    'NotificationService/ListWebhookDeliveries': {
      build: (a) => ({ endpointId: a.endpoint, limit: 50 }),
    },
  };

  const methods = idTakingMethods('notification');

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    controller = fx.moduleRef.get(NotificationsGrpcController);
  });

  afterAll(async () => fx.close());

  beforeEach(async () => fx.reset());

  /** A's world for one row: A seeded, A's identifiers, and the request on A's ids. */
  const setUp = async (name: string, method: IdTakingMethod) => {
    const a = await seedA();
    // A's rows here, plus values that are A's data without being ids.
    const local = new Set([
      ...tenantIdentifiers(await snapshot(fx.prisma), a.organizationId),
      a.providerMessageId,
    ]);
    const foreign = new Set([a.user, a.ticket]);
    const row = PROBE[name] as { build: (a: A) => Record<string, unknown> };

    return { local, foreign, request: wireRequest(method, row.build(a)) };
  };

  it('**no row is a known failure**: every cross-tenant reach found here is closed', () => {
    expect(
      Object.keys(PROBE).filter((name) => 'knownFailure' in PROBE[name]),
    ).toEqual([]);
  });

  it('**every id-taking RPC has a row**, and no row names an RPC that is gone', () => {
    expect(Object.keys(PROBE).sort()).toEqual(
      methods.map((m) => m.name).sort(),
    );
  });

  it.each(
    methods
      .filter((method) => 'build' in PROBE[method.name])
      .map((method) => [method.name, method] as const),
  )(
    '**%s** as tenant B on A’s ids: answers as for a missing id, names nothing of A’s, changes nothing of A’s',
    async (name, method) => {
      const { request, local, foreign } = await setUp(name, method);

      const report = await probeCall({
        request,
        call: controllerCall({ NotificationService: controller }, name, asB),
        local,
        foreign,
        prisma: fx.prisma,
      });

      expect(report).toEqual({
        ...CLEAN,
        onA: report.onA,
        onMissing: report.onMissing,
      });
    },
  );
  /**
   * **What a Super Admin reaches** on each id-taking RPC, called through the
   * tenant route with no tenant, as the gateway lets a Super Admin do. The
   * expectation is the behavior before the scoped client, recorded by running
   * these rows against `a53b7797`. A change to who a Super Admin reaches fails
   * a row; one that reaches A's data says why.
   *
   * `PROBE_RECORD=<file>` writes each outcome to the file instead.
   */
  const SUPER_ADMIN: Record<string, string> = {
    'NotificationService/Archive': 'refused NOT_FOUND',
    'NotificationService/DeleteWebhookEndpoint': 'refused FAILED_PRECONDITION',
    'NotificationService/ForgetDevice': 'refused NOT_FOUND',
    'NotificationService/GetWebhookEndpoint': 'refused FAILED_PRECONDITION',
    'NotificationService/ListWebhookDeliveries': 'refused FAILED_PRECONDITION',
    'NotificationService/MarkManyRead': 'answers',
    'NotificationService/MarkRead': 'refused NOT_FOUND',
    'NotificationService/ResolveTicketByMessageId': 'answers',
    'NotificationService/RotateWebhookSecret': 'refused FAILED_PRECONDITION',
    'NotificationService/TestWebhookEndpoint': 'refused FAILED_PRECONDITION',
    'NotificationService/UpdateWebhookEndpoint': 'refused FAILED_PRECONDITION',
  };
  const asSuperAdmin = () => superAdminContext();

  it('**every id-taking RPC has a Super Admin expectation**', () => {
    if (process.env.PROBE_RECORD) return;
    expect(Object.keys(SUPER_ADMIN).sort()).toEqual(
      methods
        .filter((method) => 'build' in PROBE[method.name])
        .map((method) => method.name)
        .sort(),
    );
  });

  it.each(
    methods
      .filter((method) => 'build' in PROBE[method.name])
      .map(
        (method) =>
          [
            method.name,
            SUPER_ADMIN[method.name] ?? 'unrecorded',
            method,
          ] as const,
      ),
  )(
    '**%s** as a Super Admin on A’s ids: %s',
    async (name, expected, method) => {
      const { request, local, foreign } = await setUp(name, method);

      const reached = await superAdminReach({
        request,
        call: controllerCall(
          { NotificationService: controller },
          name,
          asSuperAdmin(),
        ),
        local,
        foreign,
        prisma: fx.prisma,
      });

      if (process.env.PROBE_RECORD) {
        appendFileSync(
          process.env.PROBE_RECORD,
          `${JSON.stringify([name, reached])}\n`,
        );
        return;
      }
      expect(reached).toBe(expected.split(':')[0]);
    },
  );
});
