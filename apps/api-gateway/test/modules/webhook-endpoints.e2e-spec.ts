import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_VALUES,
  WEBHOOK_DELIVERY_LIMIT,
} from '@synapsedesk/common';
import {
  NotificationType as ProtoNotificationType,
  WebhookDeliveryStatus as ProtoDeliveryStatus,
  toProtoNotificationType,
} from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { grpcError, timestamp } from '../fixtures/wire';

/**
 * The outbound-webhook management surface at the HTTP boundary.
 *
 * **Nine routes that `docs/webhooks.md` publishes to integrators, and nothing
 * covered them.** That doc is a contract with people outside this repository:
 * it names the routes, promises the list "never includes secrets", and tells a
 * reader the catalogue endpoint lists "the same strings" the `type` field
 * carries. None of those three was asserted anywhere, so all three were true
 * only by inspection.
 *
 * **The peer is stubbed, the gateway is real.** Everything between the request
 * and `NotificationServiceClient` runs — guards, `ParseUUIDPipe`, the
 * `ValidationPipe`, the response envelope and the enum bridge — which is the
 * layer this module actually consists of. It owns no storage and makes no
 * decisions the peer could make instead; what it owns is the narrowing and the
 * gating, and those are what these tests are about.
 */
describe('Webhook endpoints at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const endpointId = faker.string.uuid();

  /** `organization.*`, never a notification permission — see the controller. */
  const reader = () =>
    authenticatedAgent(fx.app, { permissionCodes: ['organization.read'] });
  const writer = () =>
    authenticatedAgent(fx.app, { permissionCodes: ['organization.update'] });

  /**
   * An endpoint as notification-service puts it on the wire.
   *
   * `eventTypes` goes through `toProtoNotificationType` rather than being
   * written as integers: a literal `[1, 4]` here would keep passing if the
   * bridge's mapping changed underneath it, which is the one thing these
   * assertions exist to notice.
   */
  const wireEndpoint = (overrides: Record<string, unknown> = {}) => ({
    id: endpointId,
    url: 'https://example.test/hooks',
    description: 'Ops channel',
    eventTypes: [
      toProtoNotificationType(NOTIFICATION_TYPES.ticketAssigned),
      toProtoNotificationType(NOTIFICATION_TYPES.ticketEscalated),
    ],
    isActive: true,
    disabledReason: undefined,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  });

  const wireDelivery = (overrides: Record<string, unknown> = {}) => ({
    id: faker.string.uuid(),
    eventId: faker.string.uuid(),
    eventType: NOTIFICATION_TYPES.ticketAssigned,
    status: ProtoDeliveryStatus.WEBHOOK_DELIVERY_STATUS_DELIVERED,
    attempts: 1,
    responseStatus: 200,
    lastError: undefined,
    occurredAt: timestamp(),
    deliveredAt: timestamp(),
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  // --------------------------------------------------------- the catalogue

  describe('GET /webhook-endpoints/event-types', () => {
    it('**1. answers the published vocabulary, exactly**', async () => {
      // `docs/webhooks.md`: the catalogue lists "the same strings" a delivery's
      // `type` carries. `NOTIFICATION_TYPE_VALUES` is that vocabulary, so this
      // compares against the constant rather than a list retyped here — a
      // hand-written copy would agree with the doc on the day it was written
      // and drift the first time a type is added.
      fx.stubs.notification.listWebhookEventTypes.mockReturnValue(
        of({ types: NOTIFICATION_TYPE_VALUES.map(toProtoNotificationType) }),
      );

      const res = await reader().get(`${API}/webhook-endpoints/event-types`);

      expect(res.status).toBe(200);
      expect(res.body.data.types).toEqual(NOTIFICATION_TYPE_VALUES);
      // A floor, so a bridge that mapped everything to null could not pass by
      // comparing two empty arrays.
      expect(NOTIFICATION_TYPE_VALUES.length).toBeGreaterThan(5);
    });

    it('**2. is a route, not an `:id` — the `by-number` collision**', async () => {
      // The controller declares this BEFORE `@Get(':id')` and says why. Order
      // is invisible in a diff and silently reversible, and the failure is not
      // a 404: `event-types` reaches `ParseUUIDPipe` and 400s, so the symptom
      // is "the catalogue rejects itself as a malformed id".
      fx.stubs.notification.listWebhookEventTypes.mockReturnValue(
        of({ types: [] }),
      );

      const res = await reader().get(`${API}/webhook-endpoints/event-types`);

      expect(res.status).toBe(200);
      expect(fx.stubs.notification.getWebhookEndpoint).not.toHaveBeenCalled();
    });

    it('**3. DROPS a type this build cannot name rather than surfacing it**', async () => {
      // `toNotificationTypes`'s filter, at the boundary that proves it. The
      // owning service re-validates a subscription on every write, so an
      // unmappable value means the vocabulary was retired under a live
      // subscription — and a `null` in a published JSON array is worse than a
      // shorter array: a consumer iterating it gets `undefined.startsWith`.
      fx.stubs.notification.listWebhookEventTypes.mockReturnValue(
        of({
          types: [
            toProtoNotificationType(NOTIFICATION_TYPES.ticketAssigned),
            // Not in this build's enum. `fromProto` answers null for it.
            9_999 as ProtoNotificationType,
            ProtoNotificationType.NOTIFICATION_TYPE_UNSPECIFIED,
          ],
        }),
      );

      const res = await reader().get(`${API}/webhook-endpoints/event-types`);

      expect(res.status).toBe(200);
      expect(res.body.data.types).toEqual([NOTIFICATION_TYPES.ticketAssigned]);
      expect(res.body.data.types).not.toContain(null);
    });
  });

  // ------------------------------------------------------------- reading

  describe('reading endpoints', () => {
    it('1. GET / maps the wire shape onto the response DTO', async () => {
      fx.stubs.notification.listWebhookEndpoints.mockReturnValue(
        of({ items: [wireEndpoint()] }),
      );

      const res = await reader().get(`${API}/webhook-endpoints`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({
        id: endpointId,
        url: 'https://example.test/hooks',
        isActive: true,
        // Narrowed back to the domain strings, not the wire integers.
        eventTypes: [
          NOTIFICATION_TYPES.ticketAssigned,
          NOTIFICATION_TYPES.ticketEscalated,
        ],
      });
    });

    it('**2. …and NEVER a secret, which is a published promise**', async () => {
      // `docs/webhooks.md`: "List your endpoints. Never includes secrets."
      // The wire type has no secret field, so the guarantee holds by
      // construction today — this is what makes adding one to the proto a
      // failing test rather than a silent leak into a tenant-readable list.
      fx.stubs.notification.listWebhookEndpoints.mockReturnValue(
        of({
          items: [
            { ...wireEndpoint(), secret: 'whsec_should_never_be_forwarded' },
          ],
        }),
      );

      const res = await reader().get(`${API}/webhook-endpoints`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('whsec_');
      expect(res.body.data.items[0].secret).toBeUndefined();
    });

    it('3. GET /:id forwards the id and answers one endpoint', async () => {
      fx.stubs.notification.getWebhookEndpoint.mockReturnValue(
        of(wireEndpoint()),
      );

      const res = await reader().get(`${API}/webhook-endpoints/${endpointId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(endpointId);

      const [[request]] = fx.stubs.notification.getWebhookEndpoint.mock.calls;
      expect(request).toMatchObject({ endpointId });
    });

    it('4. a 404 from the peer stays a 404', async () => {
      // The gateway owns no storage here, so "does this endpoint exist" is the
      // peer's answer — this asserts it is passed through rather than
      // flattened into a 500 by the client wrapper.
      fx.stubs.notification.getWebhookEndpoint.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'not found')),
      );

      await reader().get(`${API}/webhook-endpoints/${endpointId}`).expect(404);
    });

    it('5. a non-UUID id never reaches the peer', async () => {
      await reader().get(`${API}/webhook-endpoints/not-a-uuid`).expect(400);

      expect(fx.stubs.notification.getWebhookEndpoint).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------- writing

  describe('creating and editing', () => {
    it('**1. POST / returns the secret — the one response that carries it**', async () => {
      fx.stubs.notification.createWebhookEndpoint.mockReturnValue(
        of({ endpoint: wireEndpoint(), secret: 'whsec_shown_once' }),
      );

      const res = await writer()
        .post(`${API}/webhook-endpoints`)
        .send({
          url: 'https://example.test/hooks',
          eventTypes: [NOTIFICATION_TYPES.ticketAssigned],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.secret).toBe('whsec_shown_once');
      expect(res.body.data.endpoint.id).toBe(endpointId);

      // The domain strings go out as wire integers.
      const [[request]] =
        fx.stubs.notification.createWebhookEndpoint.mock.calls;
      expect(request).toMatchObject({
        url: 'https://example.test/hooks',
        eventTypes: [
          toProtoNotificationType(NOTIFICATION_TYPES.ticketAssigned),
        ],
      });
    });

    it('2. POST / fails loudly when the peer answers without an endpoint', async () => {
      // `requireEndpoint`. The proto marks the nested message optional, so the
      // alternative is a 200 whose `endpoint` is undefined — a response the
      // caller cannot act on and cannot distinguish from success.
      fx.stubs.notification.createWebhookEndpoint.mockReturnValue(
        of({ endpoint: undefined, secret: 'whsec_orphan' }),
      );

      await writer()
        .post(`${API}/webhook-endpoints`)
        .send({
          url: 'https://example.test/hooks',
          eventTypes: [NOTIFICATION_TYPES.ticketAssigned],
        })
        .expect(500);
    });

    it('**3. PATCH distinguishes "leave the types" from "replace them"**', async () => {
      // proto3 cannot tell an empty repeated field from an absent one, which
      // is why the wrapper exists. Without it, every PATCH that edits only a
      // description would arrive looking like "unsubscribe from everything".
      fx.stubs.notification.updateWebhookEndpoint.mockReturnValue(
        of(wireEndpoint()),
      );

      await writer()
        .patch(`${API}/webhook-endpoints/${endpointId}`)
        .send({ description: 'renamed' })
        .expect(200);

      const [[absent]] = fx.stubs.notification.updateWebhookEndpoint.mock.calls;
      expect(absent.eventTypes).toBeUndefined();

      jest.clearAllMocks();
      fx.stubs.notification.updateWebhookEndpoint.mockReturnValue(
        of(wireEndpoint()),
      );

      await writer()
        .patch(`${API}/webhook-endpoints/${endpointId}`)
        .send({ eventTypes: [NOTIFICATION_TYPES.ticketEscalated] })
        .expect(200);

      const [[present]] =
        fx.stubs.notification.updateWebhookEndpoint.mock.calls;
      expect(present.eventTypes).toEqual({
        values: [toProtoNotificationType(NOTIFICATION_TYPES.ticketEscalated)],
      });
    });

    it('4. DELETE /:id answers the peer’s verdict', async () => {
      fx.stubs.notification.deleteWebhookEndpoint.mockReturnValue(
        of({ deleted: true }),
      );

      const res = await writer().delete(
        `${API}/webhook-endpoints/${endpointId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  // ----------------------------------------------------------- operating

  describe('operating an endpoint', () => {
    it('1. POST /:id/rotate-secret returns the NEW secret', async () => {
      fx.stubs.notification.rotateWebhookSecret.mockReturnValue(
        of({ endpoint: wireEndpoint(), secret: 'whsec_rotated' }),
      );

      const res = await writer().post(
        `${API}/webhook-endpoints/${endpointId}/rotate-secret`,
      );

      expect(res.status).toBe(201);
      expect(res.body.data.secret).toBe('whsec_rotated');
    });

    it('2. POST /:id/test reports a FAILED delivery as a 2xx result', async () => {
      // The route asks the peer to try; a delivery that failed is the honest
      // ANSWER to that question, not an error on this request. Turning it into
      // a 502 would make "your endpoint is down" indistinguishable from "the
      // test route is down".
      fx.stubs.notification.testWebhookEndpoint.mockReturnValue(
        of({ delivered: false, responseStatus: 503, error: 'upstream down' }),
      );

      const res = await writer().post(
        `${API}/webhook-endpoints/${endpointId}/test`,
      );

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        delivered: false,
        responseStatus: 503,
        error: 'upstream down',
      });
    });

    it('3. GET /:id/deliveries sends the DEFAULT limit when none is given', async () => {
      fx.stubs.notification.listWebhookDeliveries.mockReturnValue(
        of({ items: [wireDelivery()] }),
      );

      const res = await reader().get(
        `${API}/webhook-endpoints/${endpointId}/deliveries`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.items[0]).toMatchObject({
        attempts: 1,
        responseStatus: 200,
        status: 'DELIVERED',
      });

      const [[request]] =
        fx.stubs.notification.listWebhookDeliveries.mock.calls;
      expect(request).toMatchObject({
        endpointId,
        limit: WEBHOOK_DELIVERY_LIMIT.DEFAULT,
      });
    });

    it('4. …and REFUSES a limit over the cap before reaching the peer', async () => {
      await reader()
        .get(`${API}/webhook-endpoints/${endpointId}/deliveries`)
        .query({ limit: WEBHOOK_DELIVERY_LIMIT.MAX + 1 })
        .expect(400);

      expect(
        fx.stubs.notification.listWebhookDeliveries,
      ).not.toHaveBeenCalled();
    });

    it('5. an unmappable delivery status stays a visible null', async () => {
      // The opposite rule from the catalogue's filter, and deliberately so: a
      // delivery is one row a person is reading, so a status this build cannot
      // name is a fact worth showing rather than one worth hiding.
      fx.stubs.notification.listWebhookDeliveries.mockReturnValue(
        of({
          items: [
            wireDelivery({
              status: ProtoDeliveryStatus.WEBHOOK_DELIVERY_STATUS_UNSPECIFIED,
            }),
          ],
        }),
      );

      const res = await reader().get(
        `${API}/webhook-endpoints/${endpointId}/deliveries`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].status).toBeNull();
    });
  });

  // --------------------------------------------------------- the gating

  describe('the guard matrix', () => {
    // Tenant CONFIGURATION, so `organization.*` gates it — the same pair
    // billing and settings use. A notification permission here would let
    // anyone who can read their own feed rewrite where the tenant's events go.
    it('**1. reading needs `organization.read`, and a writer permission is not it**', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/webhook-endpoints`);

      expect(res.status).toBe(403);
      expect(fx.stubs.notification.listWebhookEndpoints).not.toHaveBeenCalled();
    });

    it('**2. `organization.read` is NOT enough to register an endpoint**', async () => {
      // The escalation that matters: reading where events go is a report;
      // adding a destination is exfiltration with a friendly name.
      const res = await reader()
        .post(`${API}/webhook-endpoints`)
        .send({
          url: 'https://attacker.test/hooks',
          eventTypes: [NOTIFICATION_TYPES.ticketAssigned],
        });

      expect(res.status).toBe(403);
      expect(
        fx.stubs.notification.createWebhookEndpoint,
      ).not.toHaveBeenCalled();
    });

    it('3. …nor to rotate a secret, test, or delete', async () => {
      await reader()
        .post(`${API}/webhook-endpoints/${endpointId}/rotate-secret`)
        .expect(403);
      await reader()
        .post(`${API}/webhook-endpoints/${endpointId}/test`)
        .expect(403);
      await reader()
        .delete(`${API}/webhook-endpoints/${endpointId}`)
        .expect(403);

      expect(fx.stubs.notification.rotateWebhookSecret).not.toHaveBeenCalled();
      expect(fx.stubs.notification.testWebhookEndpoint).not.toHaveBeenCalled();
      expect(
        fx.stubs.notification.deleteWebhookEndpoint,
      ).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------- what is refused

  describe('what the edge refuses', () => {
    const create = (body: Record<string, unknown>) =>
      writer().post(`${API}/webhook-endpoints`).send(body);

    it('**1. a non-HTTPS URL, before the peer is called**', async () => {
      // A courtesy rather than the control — the sender re-resolves and
      // re-checks on every delivery — but it puts the error at save time
      // instead of on the tenant's first missed event.
      await create({
        url: 'http://example.test/hooks',
        eventTypes: [NOTIFICATION_TYPES.ticketAssigned],
      }).expect(400);

      expect(
        fx.stubs.notification.createWebhookEndpoint,
      ).not.toHaveBeenCalled();
    });

    it('**2. an EMPTY subscription list — it never means "all"**', async () => {
      // An endpoint subscribed to nothing is silently useless: it would sit in
      // the list looking configured and receive nothing forever.
      await create({
        url: 'https://example.test/hooks',
        eventTypes: [],
      }).expect(400);

      expect(
        fx.stubs.notification.createWebhookEndpoint,
      ).not.toHaveBeenCalled();
    });

    it('3. an event type outside the catalogue', async () => {
      await create({
        url: 'https://example.test/hooks',
        eventTypes: ['ticket.invented_by_a_client'],
      }).expect(400);

      expect(
        fx.stubs.notification.createWebhookEndpoint,
      ).not.toHaveBeenCalled();
    });

    it('4. …and the same list rules apply to PATCH', async () => {
      await writer()
        .patch(`${API}/webhook-endpoints/${endpointId}`)
        .send({ eventTypes: [] })
        .expect(400);

      expect(
        fx.stubs.notification.updateWebhookEndpoint,
      ).not.toHaveBeenCalled();
    });
  });
});
