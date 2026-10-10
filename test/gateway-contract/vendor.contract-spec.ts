/**
 * @file The HTTP-vendor fake, proven through the client the gateway really uses.
 *
 * A fake is only worth what a row can safely infer from it. What a row infers
 * here is not "the fake answered 429" but "the Resend SDK, given that answer,
 * reports what `isRetryableResendError` classifies as retryable" — because that
 * classification is the 503-versus-200 split, and a fake whose failure shapes
 * the SDK reads differently would let a wrong split pass.
 *
 * So every row drives the stock `resend` SDK at the fake and feeds the error it
 * returns through the repository's own classifier.
 */

import { isRetryableResendError } from '@synapsedesk/core';
import { Resend } from 'resend';
import { FakeVendor } from './vendor';

describe('the HTTP vendor fake, through the real Resend SDK', () => {
  const MAIL = '11111111-1111-4111-8111-111111111111';
  const KEY = 're_contract_key';
  let vendor: FakeVendor;
  let resend: Resend;

  beforeAll(async () => {
    vendor = new FakeVendor('resend');
    await vendor.start();

    // The SDK reads its base URL when it is constructed.
    const previous = process.env.RESEND_BASE_URL;
    process.env.RESEND_BASE_URL = vendor.baseUrl;
    resend = new Resend(KEY);
    if (previous === undefined) delete process.env.RESEND_BASE_URL;
    else process.env.RESEND_BASE_URL = previous;
  });

  afterAll(async () => {
    await vendor.stop();
  });

  beforeEach(() => {
    vendor.reset();
    // The SDK logs every error response it receives; here they are the point.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const fetchMail = () => resend.emails.receiving.get(MAIL);

  it('**a programmed reply reaches the SDK as data, with the credential it sent**', async () => {
    vendor.on('GET', `/emails/receiving/${MAIL}`).reply(200, {
      id: MAIL,
      subject: 'Hello',
    });

    const { data, error } = await fetchMail();

    expect(error).toBeNull();
    expect(data).toMatchObject({ id: MAIL, subject: 'Hello' });
    expect(vendor.calls(`/emails/receiving/${MAIL}`)).toHaveLength(1);
    expect(vendor.calls()[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it.each([
    [429, 'rate_limit_exceeded'],
    [500, 'internal_server_error'],
    [503, 'application_error'],
  ])(
    '**a %i is retryable** — the one failure that must answer the webhook 503',
    async (statusCode, name) => {
      vendor
        .on('GET', `/emails/receiving/${MAIL}`)
        .reply(statusCode, { statusCode, name, message: 'try later' });

      const { data, error } = await fetchMail();

      expect(data).toBeNull();
      expect(error).toMatchObject({ statusCode });
      expect(isRetryableResendError(error!)).toBe(true);
    },
  );

  it.each([
    [404, 'not_found'],
    [401, 'restricted_api_key'],
  ])(
    '**a %i is NOT retryable** — a retry fails identically, so the webhook answers 200',
    async (statusCode, name) => {
      vendor
        .on('GET', `/emails/receiving/${MAIL}`)
        .reply(statusCode, { statusCode, name, message: 'no' });

      const { error } = await fetchMail();

      expect(error).toMatchObject({ statusCode });
      expect(isRetryableResendError(error!)).toBe(false);
    },
  );

  it('**a connection dropped with no answer is retryable** — a null status is the vendor never answering, not a verdict on the mail', async () => {
    vendor.on('GET', `/emails/receiving/${MAIL}`).dropConnection();

    const { data, error } = await fetchMail();

    expect(data).toBeNull();
    expect(error).toMatchObject({
      name: 'application_error',
      statusCode: null,
    });
    expect(isRetryableResendError(error!)).toBe(true);
  });

  it("**a proxy's HTML error page is NOT retryable at 403** — non-JSON must not be mistaken for the vendor's own shape", async () => {
    vendor
      .on('GET', `/emails/receiving/${MAIL}`)
      .replyRaw(403, '<html>Forbidden</html>');

    const { error } = await fetchMail();

    expect(error).toMatchObject({ statusCode: 403 });
    expect(isRetryableResendError(error!)).toBe(false);
  });

  it('**an unprogrammed route is loud and recorded**, and is not a status a gateway acts on as "no such mail"', async () => {
    const { error } = await fetchMail();

    expect(error).toMatchObject({ statusCode: 501 });
    expect(vendor.unprogrammed()).toEqual([`GET /emails/receiving/${MAIL}`]);

    // The SDK reads the error from the BODY, so it cannot tell a 501 from a 404
    // sent with the same JSON. A client that reads the HTTP status can.
    const raw = await fetch(`${vendor.baseUrl}/emails/receiving/${MAIL}`);
    expect(raw.status).toBe(501);
  });

  it('**sends the status it was programmed with on the wire**, for a client that reads the HTTP status and not the body', async () => {
    vendor.on('GET', '/wire').reply(429, { name: 'rate_limit_exceeded' });

    const raw = await fetch(`${vendor.baseUrl}/wire`);

    expect(raw.status).toBe(429);
  });

  it("**an error reply with no `statusCode` still reaches the SDK with one**, as the real API's always does", async () => {
    vendor
      .on('GET', `/emails/receiving/${MAIL}`)
      .reply(429, { name: 'rate_limit_exceeded', message: 'slow down' });

    const { error } = await fetchMail();

    expect(error).toMatchObject({ statusCode: 429 });
    expect(isRetryableResendError(error!)).toBe(true);
  });

  it('answers a one-shot first, then the standing reply for every call after it', async () => {
    // Its own mail: a standing reply survives `reset()` by design, so on the
    // shared route it would answer every row that runs after this one.
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const route = vendor.on('GET', `/emails/receiving/${OTHER}`);
    route.reply(500, { statusCode: 500, name: 'a', message: 'a' });
    route.always(404, { statusCode: 404, name: 'b', message: 'b' });

    const statuses = [
      (await resend.emails.receiving.get(OTHER)).error?.statusCode,
      (await resend.emails.receiving.get(OTHER)).error?.statusCode,
      (await resend.emails.receiving.get(OTHER)).error?.statusCode,
    ];

    expect(statuses).toEqual([500, 404, 404]);
  });

  it('records the query the client sent — the attachment list asks for the SDK maximum', async () => {
    vendor.on('GET', `/emails/receiving/${MAIL}/attachments`).reply(200, {
      object: 'list',
      has_more: false,
      data: [],
    });

    const { error } = await resend.emails.receiving.attachments.list({
      emailId: MAIL,
      limit: 100,
    });

    expect(error).toBeNull();
    expect(vendor.calls()[0].query).toContain('limit=100');
  });

  it('forgets one-shots and the log on reset, but keeps a standing reply', async () => {
    const route = vendor.on('GET', `/emails/receiving/${MAIL}`);
    route.reply(500, { statusCode: 500, name: 'a', message: 'a' });
    vendor.on('GET', '/standing').always(200, { ok: true });
    await fetchMail();

    vendor.reset();

    expect(vendor.calls()).toEqual([]);
    expect((await fetchMail()).error).toMatchObject({ statusCode: 501 });
    expect(await fetch(`${vendor.baseUrl}/standing`)).toHaveProperty(
      'status',
      200,
    );
  });
});
