/**
 * @file `FeedbackApi` — the rating round trip, the tenant-wide permission
 * gate, and the 204 an upsert-delete answers with.
 *
 * **The rating round trip is the reason this file exists.** `rating` was
 * silently absent from the published OpenAPI document until this module's
 * doc review caught it (`FeedbackRating` is a numeric literal union the
 * Swagger plugin cannot map, the same trap `SubmitFeedbackDto.rating`'s own
 * comment already named) — an undocumented REQUIRED-in-practice field that a
 * generated client, Java's included, had no property to put it in at all.
 * `-1`, not `1`, is asserted below: the generated `RatingEnum`'s first member
 * is whichever proto integer sorts first, and `1` alone would not catch the
 * two members swapped.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('feedback', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';
  const MESSAGE = '33333333-3333-4333-8333-333333333333';

  const accessToken = (permissionCodes: string[] = []) =>
    sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const wireFeedback = (rating: -1 | 1) => ({
    id: '44444444-4444-4444-8444-444444444444',
    ticketMessageId: MESSAGE,
    userId: USER,
    organizationId: ORGANIZATION,
    rating,
    feedbackText: null,
    citationAccurate: null,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Feedback')(
    '**a thumbs-down round-trips as `-1`**, not the more easily faked `1`',
    async () => {
      peers.ticket.on('FeedbackService/SubmitFeedback').reply(wireFeedback(-1));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/messages/${MESSAGE}/feedback`,
        { rating: -1 },
        { cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}` },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { rating: -1 } });

      const [call] = peers.ticket.calls('FeedbackService/SubmitFeedback');
      expect(call.request).toMatchObject({
        ticketMessageId: MESSAGE,
        rating: -1,
      });
    },
  );

  rowFor('Feedback')(
    '**own feedback is `null`, not a 404**, when the caller has not rated the message',
    async () => {
      peers.ticket.on('FeedbackService/GetFeedback').reply({});

      const response = await new Session(gateway.baseUrl).get(
        `${API}/messages/${MESSAGE}/feedback`,
        { cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}` },
      );

      expect(response.status).toBe(200);
      expect((response.body as { data: unknown }).data).toBeNull();
    },
  );

  rowFor('Feedback')(
    '**withdraw is a real 204** — no envelope in the body',
    async () => {
      peers.ticket.on('FeedbackService/WithdrawFeedback').reply({});

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/messages/${MESSAGE}/feedback`,
        {
          headers: {
            cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
          },
        },
      );

      expect(response.status).toBe(204);
      // Not `{}`, not `null` parsed from `"null"` — NO body at all. A framework
      // that serialises an envelope onto a 204 would leave `response.text`
      // non-empty even though the status line says there is nothing to read.
      expect(response.text).toBe('');
      expect(response.body).toBeUndefined();
    },
  );

  rowFor('Feedback')(
    '**the tenant feedback stream refuses a caller without `analytics.read`**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/feedback`,
        {
          cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken([])}`,
        },
      );

      expect(response.status).toBe(403);
      expect(peers.ticket.calls('FeedbackService/ListFeedback')).toHaveLength(
        0,
      );
    },
  );

  rowFor('Feedback')(
    'a caller WITH `analytics.read` sees the tenant feedback stream, sorted params forwarded',
    async () => {
      peers.ticket.on('FeedbackService/ListFeedback').reply({
        items: [wireFeedback(1)],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/feedback?citationAccurate=true`,
        {
          cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken(['analytics.read'])}`,
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ rating: 1 }], meta: { totalItems: 1 } },
      });

      const [call] = peers.ticket.calls('FeedbackService/ListFeedback');
      expect(call.request).toMatchObject({ citationAccurate: true });
    },
  );
});
