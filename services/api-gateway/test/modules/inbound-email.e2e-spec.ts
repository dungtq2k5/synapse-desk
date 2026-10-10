import request from 'supertest';
import { of } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InboundOutcome } from '../../src/modules/inbound-email/inbound-email.service';
import { MetricsRegistry } from '../../src/modules/metrics/metrics.registry';
import {
  RESEND_INBOUND_CLIENT,
  type ResendInboundClient,
} from '../../src/modules/inbound-email/resend-inbound.client';
import { ResendWebhookOutcome } from '../../src/modules/inbound-email/resend-inbound.service';
import {
  API,
  E2eFixture,
  bootstrapE2eTest,
  signStandardWebhook,
  type StandardWebhookHeaders,
} from '../utils';
import { plainEmail, resendDelivery } from '../fixtures/inbound-email';

/**
 * `POST /webhooks/email/resend` — the signature boundary, and every exit
 * before `accept()`.
 *
 * **Everything here is about what happens BEFORE the message is understood.**
 * Resolution, threading and dedup have their own suite; these pin the property
 * the endpoint is built around — *a bad signature causes nothing to happen*, no
 * Resend call and no gRPC call — and the status each other exit answers, since
 * any non-2xx makes Resend redeliver for hours.
 */
describe('The inbound email webhook (e2e)', () => {
  let fx: E2eFixture;
  let webhookSecret: string;
  let receivingGet: jest.SpyInstance;

  const ROUTE = `${API}/webhooks/email/resend`;

  const post = (body: string, headers?: Partial<StandardWebhookHeaders>) =>
    request(fx.app.getHttpServer())
      .post(ROUTE)
      .set('content-type', 'application/json')
      .set(headers ?? {})
      .send(body);

  /** A signed delivery of `fields`, with `receiving.get` answering the same mail. */
  const deliver = (fields: Record<string, unknown> = plainEmail()) => {
    const { event, email } = resendDelivery(fields);
    receivingGet.mockResolvedValue({ data: email, error: null, headers: null });
    const body = JSON.stringify(event);

    return { body, headers: signStandardWebhook(body, webhookSecret) };
  };

  /** Every stubbed gRPC method that was called, as `service.method`. */
  const grpcCalls = () =>
    Object.entries(fx.stubs).flatMap(([service, client]) =>
      Object.entries(client as object)
        .filter(([, fn]) => jest.isMockFunction(fn) && fn.mock.calls.length > 0)
        .map(([method]) => `${service}.${method}`),
    );

  const counted = async (outcome: string) => {
    const metric = await fx.app.get(MetricsRegistry).inboundEmailWebhook.get();
    return (
      metric.values.find((value) => value.labels.outcome === outcome)?.value ??
      0
    );
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    webhookSecret = fx.app
      .get(ConfigService)
      .getOrThrow<string>('RESEND_WEBHOOK_SECRET');
    // The fetch is replaced; the signature verifier stays the SDK's own.
    receivingGet = jest.spyOn(
      fx.app.get<ResendInboundClient>(RESEND_INBOUND_CLIENT, { strict: false })
        .emails.receiving,
      'get',
    );
  }, 30_000);

  beforeEach(() => {
    jest.clearAllMocks();

    // Unroutable by default. These tests are about the boundary, and an address
    // nobody issued is the cheapest well-defined outcome behind it — it also
    // happens to be the one that must still answer 200.
    fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
      of({ organizationId: undefined, status: 0, maxAttachmentBytes: 0 }),
    );
  });

  afterAll(() => fx.close());

  describe('a correctly signed delivery', () => {
    it('1. is fetched, accepted, and answered 200 with the outcome', async () => {
      const { body, headers } = deliver();

      const response = await post(body, headers).expect(200);

      // **200 even though the mail was dropped**. A non-2xx would tell Resend
      // to retry an address that will never resolve.
      expect(response.body.data).toEqual({
        received: true,
        outcome: InboundOutcome.UNROUTABLE,
      });
      expect(receivingGet).toHaveBeenCalledTimes(1);
    });

    it('6. **the signature is over the RAW body, with the global JSON parser registered**', async () => {
      // The signature covers the exact BYTES. A handler that verified a
      // re-serialized body would fail every real delivery while passing any
      // test that builds its own. The body below carries whitespace
      // `JSON.stringify` would never emit, so the two signatures differ.
      const { body } = deliver();
      const spaced = body.replace('{', '{  ').replaceAll(',"', ',\n  "');

      expect(JSON.stringify(JSON.parse(spaced))).toBe(body);
      expect(spaced).not.toBe(body);

      // Signed over the bytes as sent: verifies …
      await post(spaced, signStandardWebhook(spaced, webhookSecret)).expect(
        200,
      );
      // … signed over the re-serialized copy: refused.
      await post(spaced, signStandardWebhook(body, webhookSecret)).expect(401);
    });

    it('7. **a verified event that is not `email.received` is 200 and does nothing**', async () => {
      // The webhook may be subscribed to more than inbound mail; a delivery
      // event must not be fetched as though it were one.
      const body = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: { email_id: 'not-inbound' },
      });

      const response = await post(
        body,
        signStandardWebhook(body, webhookSecret),
      ).expect(200);

      expect(response.body.data.outcome).toBe(
        ResendWebhookOutcome.IGNORED_EVENT,
      );
      expect(receivingGet).not.toHaveBeenCalled();
      expect(grpcCalls()).toEqual([]);
    });
  });

  describe('a bad signature', () => {
    it('2. **a tampered body is 401, and nothing is logged from it**', async () => {
      const { body, headers } = deliver();
      const tampered = body.replace('printer is on fire', 'printer is fine');

      const response = await post(tampered, headers).expect(401);

      // The rejection says nothing about what was in the body — an
      // unauthenticated caller controls every byte of it.
      expect(JSON.stringify(response.body)).not.toContain('printer');
    });

    it('3. **a wrong secret is 401, never 5xx**', async () => {
      // A 5xx tells Resend to retry, so a misconfigured secret would become
      // hours of redelivery for every mail.
      const { body } = deliver();
      const wrong = `whsec_${Buffer.from('a-different-secret-entirely-000').toString('base64')}`;

      const response = await post(body, signStandardWebhook(body, wrong));

      expect(response.status).toBe(401);
    });

    it.each([['svix-id'], ['svix-timestamp'], ['svix-signature']] as const)(
      'and a missing `%s` header is 401 too',
      async (name) => {
        const { body, headers } = deliver();
        const rest = Object.fromEntries(
          Object.entries(headers).filter(([header]) => header !== name),
        );

        await post(body, rest).expect(401);
      },
    );

    it('and a delivery signed more than five minutes ago is 401', async () => {
      // The timestamp is inside the signed content, so a captured delivery
      // cannot be replayed later with its signature intact.
      const { body } = deliver();
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;

      await post(
        body,
        signStandardWebhook(body, webhookSecret, tenMinutesAgo),
      ).expect(401);
    });

    it('3b. **a bad signature makes NO Resend call and NO gRPC call**', async () => {
      // The property the whole ordering exists for, and the one a
      // fetch-then-verify refactor would break while still passing tests 2
      // and 3. Asserted across every stubbed peer: "nothing happens" is the
      // claim, and checking one client would miss the next call site.
      const { body } = deliver();
      const before = await counted(ResendWebhookOutcome.REJECTED_SIGNATURE);

      await post(body, {
        ...signStandardWebhook(body, webhookSecret),
        'svix-signature': 'v1,bm90IGEgc2lnbmF0dXJl',
      }).expect(401);

      expect(receivingGet).not.toHaveBeenCalled();
      expect(grpcCalls()).toEqual([]);
      expect(await counted(ResendWebhookOutcome.REJECTED_SIGNATURE)).toBe(
        before + 1,
      );
    });
  });

  describe('a verified delivery whose mail cannot be fetched', () => {
    it('**a 429 is 503, so Resend redelivers later**', async () => {
      const { body, headers } = deliver();
      receivingGet.mockResolvedValue({
        data: null,
        error: {
          name: 'rate_limit_exceeded',
          statusCode: 429,
          message: 'slow down',
        },
        headers: null,
      });

      await post(body, headers).expect(503);

      expect(grpcCalls()).toEqual([]);
    });

    it('**a 404 is 200 `fetch_failed` — a retry would fail identically**', async () => {
      const { body, headers } = deliver();
      receivingGet.mockResolvedValue({
        data: null,
        error: { name: 'not_found', statusCode: 404, message: 'gone' },
        headers: null,
      });

      const response = await post(body, headers).expect(200);

      expect(response.body.data.outcome).toBe(
        ResendWebhookOutcome.FETCH_FAILED,
      );
      expect(grpcCalls()).toEqual([]);
    });
  });

  describe('a verified delivery whose mail fails validation', () => {
    // The mail is BUILT by the handler, so the global ValidationPipe never sees
    // it; these prove the explicit validation runs. Each is a 200 drop — a 4xx
    // or 5xx would have Resend redeliver a mail that can never pass.

    it('an unparseable sender is 200 `invalid_payload`, and nothing else runs', async () => {
      const { body, headers } = deliver(plainEmail({ from: 'not-an-email' }));

      const response = await post(body, headers).expect(200);

      expect(response.body.data.outcome).toBe(
        ResendWebhookOutcome.INVALID_PAYLOAD,
      );
      expect(grpcCalls()).toEqual([]);
    });

    it('**a Message-ID longer than its column is refused here, not by Postgres**', async () => {
      // `inbound_emails.message_id` is `VarChar(255)` and half of a unique
      // index. A longer value would pass the endpoint and fail the INSERT with
      // an error that is not a duplicate-key error — a 5xx, retried for hours.
      const { body, headers } = deliver(
        plainEmail({ messageId: `<${'a'.repeat(300)}@mail.test>` }),
      );

      const response = await post(body, headers).expect(200);

      expect(response.body.data.outcome).toBe(
        ResendWebhookOutcome.INVALID_PAYLOAD,
      );
      expect(grpcCalls()).toEqual([]);
    });

    it('**and a non-ASCII Message-ID too — bytes and characters must agree**', async () => {
      // The length bound counts CHARACTERS while Postgres counts BYTES. The
      // charset constraint is what makes those the same number.
      const { body, headers } = deliver(
        plainEmail({ messageId: `<${'é'.repeat(200)}@mail.test>` }),
      );

      const response = await post(body, headers).expect(200);

      expect(response.body.data.outcome).toBe(
        ResendWebhookOutcome.INVALID_PAYLOAD,
      );
    });
  });
});
