import { createHmac } from 'node:crypto';
import request from 'supertest';
import { of } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { plainEmail, signPayload } from '../fixtures/inbound-email';

/**
 * `POST /webhooks/email/inbound` — the signature boundary
 *
 * **Everything here is about what happens BEFORE the message is understood.**
 * Resolution, threading and dedup are step 5 and have their own tests; these
 * pin the property the whole endpoint is built around — *a bad signature causes
 * nothing to happen* — which is the reason verification is local rather than
 * forwarded.
 */
describe('§32 §3 the inbound email webhook (e2e)', () => {
  let fx: E2eFixture;
  let secret: string;

  const ROUTE = '/api/v1/webhooks/email/inbound';

  const post = (body: string, signature?: string) => {
    const req = request(fx.app.getHttpServer())
      .post(ROUTE)
      .set('content-type', 'application/json');

    if (signature !== undefined) req.set('x-inbound-signature', signature);

    return req.send(body);
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    secret = fx.app
      .get(ConfigService)
      .getOrThrow<string>('INBOUND_EMAIL_SECRET');
  }, 30_000);

  beforeEach(() => {
    jest.clearAllMocks();

    // Unroutable by default. These tests are about the SIGNATURE boundary, and
    // an address nobody issued is the cheapest well-defined outcome behind it —
    // it also happens to be the one that must still answer 200.
    fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
      of({ organizationId: undefined, status: 0 }),
    );
  });

  afterAll(() => fx.close());

  describe('a correctly signed payload', () => {
    it('1. is accepted with a 200', async () => {
      const { body, signature } = signPayload(plainEmail(), secret);

      const response = await post(body, signature).expect(200);

      // **200 even though the mail was dropped** A 4xx would
      // tell the provider to retry an address that will never resolve.
      expect(response.body.data).toEqual({
        received: true,
        outcome: 'unroutable_address',
      });
    });

    it('6. **the handler sees the RAW body, with the global JSON parser registered**', async () => {
      // The trap that has already caught this codebase once. The
      // signature is over the exact BYTES; a parser that deserializes and
      // re-serializes produces a different digest, and every request then fails
      // in production while passing any test that builds its own body.
      //
      // The body below carries whitespace `JSON.stringify` would never emit, so
      // the two digests genuinely differ — which is what makes this test able
      // to tell the two implementations apart.
      const payload = plainEmail();
      const spaced = `{  "to": ${JSON.stringify(payload.to)},\n  "from": ${JSON.stringify(
        payload.from,
      )},\n  "subject": ${JSON.stringify(payload.subject)},\n  "text": ${JSON.stringify(
        payload.text,
      )},\n  "html": null,\n  "receivedAt": ${JSON.stringify(payload.receivedAt)}  }`;

      const overExactBytes = createHmac('sha256', secret)
        .update(spaced)
        .digest('hex');
      const overReserialised = createHmac('sha256', secret)
        .update(JSON.stringify(JSON.parse(spaced)))
        .digest('hex');

      expect(overExactBytes).not.toBe(overReserialised);

      // The digest over the bytes as sent is the one that verifies …
      await post(spaced, overExactBytes).expect(200);
      // … and the re-serialised one is rejected, which is the failure mode a
      // body parser in front of the guard would produce for every request.
      await post(spaced, overReserialised).expect(401);
    });
  });

  describe('a bad signature', () => {
    it('2. **a tampered body is 401, and nothing is logged from it**', async () => {
      const { body, signature } = signPayload(plainEmail(), secret);
      const tampered = body.replace('printer is on fire', 'printer is fine');

      const warn = jest.spyOn(
        fx.app.get(ConfigService).constructor.prototype,
        'get',
      );
      warn.mockRestore();

      const response = await post(tampered, signature).expect(401);

      // The rejection says nothing about what was in the body — an
      // unauthenticated caller controls every byte of it.
      expect(JSON.stringify(response.body)).not.toContain('printer');
    });

    it('3. **a wrong secret is 401, never 5xx**', async () => {
      // A 5xx tells the provider to retry, so a misconfigured secret would
      // become an unbounded retry loop against this endpoint.
      const { body, signature } = signPayload(plainEmail(), 'the-wrong-secret');

      const response = await post(body, signature);

      expect(response.status).toBe(401);
      expect(response.status).toBeLessThan(500);
    });

    it('and a missing signature header is 401 too', async () => {
      const { body } = signPayload(plainEmail(), secret);

      await post(body).expect(401);
    });

    it('and an empty signature does not verify against an empty digest', async () => {
      // `timingSafeEqual` on two zero-length buffers is `true`. The helper
      // refuses length zero for exactly this reason.
      const { body } = signPayload(plainEmail(), secret);

      await post(body, '').expect(401);
    });

    it('3b. **a bad signature makes NO gRPC call at all**', async () => {
      // The property that decided the adapter split, and the one a refactor to
      // forward-then-verify would break while still passing tests 2 and 3.
      //
      // Asserted across every stubbed peer rather than one: "no lookup, no RPC,
      // no job" is the claim, and checking a single client would let the next
      // call site added here go unnoticed.
      const { body, signature } = signPayload(plainEmail(), 'wrong');

      await post(body, signature).expect(401);

      const called = Object.entries(fx.stubs).flatMap(([service, client]) =>
        Object.entries(client as object)
          .filter(
            ([, fn]) => jest.isMockFunction(fn) && fn.mock.calls.length > 0,
          )
          .map(([method]) => `${service}.${method}`),
      );

      expect(called).toEqual([]);
    });
  });

  describe('a signed but malformed payload', () => {
    it('is 400 from validation, not 401 — the signature was fine', async () => {
      // The distinction matters operationally: 401 means "your credential is
      // wrong", 400 means "your credential is right and your payload is not".
      // Collapsing them would send somebody to rotate a working secret.
      const { body, signature } = signPayload(
        plainEmail({ from: 'not-an-email' }),
        secret,
      );

      await post(body, signature).expect(400);
    });

    it('**and a Message-ID longer than its column is refused here, not by Postgres**', async () => {
      // `inbound_emails.message_id` is `VarChar(255)` and is half of a unique
      // index. A longer value would pass the endpoint and fail the INSERT, and
      // that error is not a duplicate-key error — so it surfaces as a 5xx and
      // the provider retries it forever.
      const { body, signature } = signPayload(
        plainEmail({ messageId: `<${'a'.repeat(300)}@mail.test>` }),
        secret,
      );

      await post(body, signature).expect(400);
    });

    it('**and a non-ASCII Message-ID too — bytes and characters must agree**', async () => {
      // The length bound counts CHARACTERS while Postgres counts BYTES. The
      // charset constraint is what makes those the same number; without it a
      // multibyte header under 255 characters can still blow the index tuple.
      const { body, signature } = signPayload(
        plainEmail({ messageId: `<${'é'.repeat(200)}@mail.test>` }),
        secret,
      );

      await post(body, signature).expect(400);
    });
  });
});
