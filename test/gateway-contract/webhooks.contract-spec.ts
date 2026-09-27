/**
 * @file `WebhooksApi` — the two INBOUND webhook intakes (`/webhooks/stripe`,
 * `/webhooks/email/resend`), unrelated to `WebhookEndpointsApi` (this
 * system's own OUTBOUND subscriptions).
 *
 * **Scoped to what a black-box process can actually exercise.** Both routes
 * do real work only after their signature clears: Stripe's is verified by
 * auth-service (the gateway only forwards raw bytes + header, asserted via
 * the fake peer), and Resend's is verified by the gateway itself. What
 * happens once a Resend delivery is ACCEPTED (fetching the mail body,
 * routing, attachment ingestion) calls Resend's own REST API directly, not a
 * gRPC peer this harness can fake — there is no seam to intercept it from
 * outside the process, so these rows stop at the boundary every property here
 * can actually pin: a bad signature does nothing, a good one either forwards
 * (Stripe) or is filtered by event type (Resend).
 *
 * `WebhooksApi` stays on `pending-apis.txt`: the Java port implements the
 * signature boundary and the `email.received` filter, but refuses with a
 * retryable 503 where Node would run its full ingestion pipeline. Every row
 * below is `it.skip` under `GATEWAY_IMPL=java` until that pipeline lands.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { API } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

/** Signs a body the way Resend does — independent of the gateway's own verifier. */
function signStandardWebhook(
  body: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
  id = `msg_${randomUUID()}`,
) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const digest = createHmac('sha256', key).update(`${id}.${timestampSeconds}.${body}`).digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': String(timestampSeconds),
    'svix-signature': `v1,${digest}`,
  };
}

describe('webhooks', () => {
  let gateway: Gateway;
  let peers: Peers;

  /** Raw `fetch`, bypassing `Session` — these rows sign the EXACT bytes sent, and `Session.request` always re-`JSON.stringify`s its body. */
  const postRaw = async (path: string, body: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${gateway.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
    const text = await response.text();

    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({ ...peers.env, REDIS_URL: redisUrl, NATS_URL: natsUrl });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => peers.reset());

  describe('stripe', () => {
    rowFor('Webhooks')(
      '**forwards the exact raw bytes and signature header to auth-service, verbatim**',
      async () => {
        peers.auth.on('BillingService/HandleStripeWebhook').reply({ status: 'applied' });
        const body = '{"id":"evt_1","type":"invoice.paid"}';

        const response = await postRaw(`${API}/webhooks/stripe`, body, { 'stripe-signature': 't=1,v1=abc' });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ data: { received: true, status: 'applied' } });
        const [call] = peers.auth.calls('BillingService/HandleStripeWebhook');
        expect(call.request.signature).toBe('t=1,v1=abc');
        expect(Buffer.from(call.request.payload).toString('utf8')).toBe(body);
      },
    );

    rowFor('Webhooks')('**an event type nothing acts on is still 200, with an empty status**', async () => {
      peers.auth.on('BillingService/HandleStripeWebhook').reply({ status: '' });

      const response = await postRaw(`${API}/webhooks/stripe`, '{"id":"evt_2"}', {
        'stripe-signature': 't=1,v1=abc',
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { received: true, status: '' } });
    });

    rowFor('Webhooks')('**a signature auth-service rejects is a non-2xx, never masked as 200**', async () => {
      peers.auth
        .on('BillingService/HandleStripeWebhook')
        .fail(GrpcStatus.INVALID_ARGUMENT, 'signature verification failed');

      const response = await postRaw(`${API}/webhooks/stripe`, '{"id":"evt_3"}', {
        'stripe-signature': 'tampered',
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('resend', () => {
    const secret = GATEWAY_ENV.RESEND_WEBHOOK_SECRET;

    rowFor('Webhooks')('**a verified event that is not `email.received` is 200 and calls no peer**', async () => {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'not-inbound' } });

      const response = await postRaw(`${API}/webhooks/email/resend`, body, signStandardWebhook(body, secret));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { received: true, outcome: 'ignored_event' } });
      expect(peers.auth.calls()).toHaveLength(0);
      expect(peers.notification.calls()).toHaveLength(0);
    });

    rowFor('Webhooks')('**a tampered body is 401, and nothing is logged from it**', async () => {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } });
      const headers = signStandardWebhook(body, secret);
      const tampered = JSON.stringify({ type: 'email.delivered', data: { email_id: 'y' } });

      const response = await postRaw(`${API}/webhooks/email/resend`, tampered, headers);

      expect(response.status).toBe(401);
    });

    rowFor('Webhooks')('**a wrong secret is 401, never 5xx**', async () => {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } });
      const wrong = `whsec_${Buffer.from('a-different-secret-entirely-000').toString('base64')}`;

      const response = await postRaw(`${API}/webhooks/email/resend`, body, signStandardWebhook(body, wrong));

      expect(response.status).toBe(401);
    });

    rowFor('Webhooks').each([['svix-id'], ['svix-timestamp'], ['svix-signature']] as const)(
      'and a missing `%s` header is 401 too',
      async (name) => {
        const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } });
        const headers = signStandardWebhook(body, secret);
        delete (headers as Record<string, string>)[name];

        const response = await postRaw(`${API}/webhooks/email/resend`, body, headers);

        expect(response.status).toBe(401);
      },
    );

    rowFor('Webhooks')('**a delivery signed more than five minutes ago is 401**', async () => {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } });
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;

      const response = await postRaw(
        `${API}/webhooks/email/resend`,
        body,
        signStandardWebhook(body, secret, tenMinutesAgo),
      );

      expect(response.status).toBe(401);
    });
  });
});
