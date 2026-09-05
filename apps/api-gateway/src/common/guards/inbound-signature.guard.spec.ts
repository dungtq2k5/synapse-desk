import { createHmac } from 'node:crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MetricsRegistry } from '../../modules/metrics/metrics.registry';
import {
  INBOUND_SIGNATURE_HEADER,
  InboundSignatureGuard,
} from './inbound-signature.guard';

/**
 * The guard's three exits, and the counter each one writes.
 *
 * **The counter is the point, not the refusal.** That a bad signature is
 * refused was already covered; what was missing is that the refusal leaves a
 * trace on the only end of this exchange that retains one. The mail Worker has
 * no `console.*`, no `observability` block, no tail consumer and no logpush, so
 * a 401 it receives is recorded here or nowhere.
 *
 * **`accepted` is asserted for the same reason it is easy to omit.** A Worker
 * that has stopped calling entirely produces the same `rejected_signature`
 * count as a healthy system — zero — so the healthy series is what makes the
 * silence readable.
 */
describe('InboundSignatureGuard', () => {
  const SECRET = 'a-shared-secret-for-the-suite';
  const BODY = Buffer.from('{"messageId":"<abc@example.test>"}');

  const sign = (body: Buffer, secret: string): string =>
    createHmac('sha256', secret).update(body).digest('hex');

  let guard: InboundSignatureGuard;
  let metrics: MetricsRegistry;

  const contextFor = (request: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as ExecutionContext;

  /** A request whose header lookup behaves like Express's. */
  const requestWith = (rawBody: Buffer | undefined, signature?: string) => ({
    rawBody,
    header: (name: string) =>
      name === INBOUND_SIGNATURE_HEADER ? signature : undefined,
  });

  /** What the counter holds for one label, right now. */
  const countOf = async (outcome: string): Promise<number> => {
    const metric = await metrics.inboundEmailWebhook.get();
    const found = metric.values.find(
      (value) => value.labels.outcome === outcome,
    );

    return found?.value ?? 0;
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        InboundSignatureGuard,
        // The REAL registry, not a mock: the assertion is about a prom-client
        // counter's labelled values, and a jest.fn() would assert that the
        // guard called something rather than that the metric exists with the
        // label the alert will query.
        MetricsRegistry,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => SECRET },
        },
      ],
    }).compile();

    guard = moduleRef.get(InboundSignatureGuard);
    metrics = moduleRef.get(MetricsRegistry);
  });

  it('1. a valid signature passes and counts `accepted`', async () => {
    const context = contextFor(requestWith(BODY, sign(BODY, SECRET)));

    expect(guard.canActivate(context)).toBe(true);
    expect(await countOf('accepted')).toBe(1);
    expect(await countOf('rejected_signature')).toBe(0);
  });

  it('2. a bad signature is refused and counts `rejected_signature`', async () => {
    const context = contextFor(
      requestWith(BODY, sign(BODY, 'the-wrong-secret')),
    );

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(await countOf('rejected_signature')).toBe(1);
    // The healthy series must NOT move on a rejection, or "accepted == 0"
    // stops meaning "the Worker is not calling".
    expect(await countOf('accepted')).toBe(0);
  });

  it('3. a missing signature header is a rejection, not a crash', async () => {
    // `signature ?? ''` in the guard: absent and wrong are the same answer, and
    // neither may throw before the comparison.
    const context = contextFor(requestWith(BODY, undefined));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(await countOf('rejected_signature')).toBe(1);
  });

  it('4. **a missing raw body counts `no_raw_body`, not `rejected_signature`**', async () => {
    // The distinction the label exists for: this is OUR misconfiguration —
    // `rawBody: true` absent from `NestFactory.create` — and paging somebody
    // about a shared secret for it wastes the alert.
    const context = contextFor(requestWith(undefined, 'anything'));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(await countOf('no_raw_body')).toBe(1);
    expect(await countOf('rejected_signature')).toBe(0);
  });

  it('5. the counter is registered under the name the alert will query', async () => {
    // A rule file names the metric as a string. Renaming the property is a
    // compile error; renaming the metric is not, and this is what notices.
    const context = contextFor(requestWith(BODY, sign(BODY, SECRET)));
    guard.canActivate(context);

    expect(await metrics.scrape()).toContain(
      'inbound_email_webhook_total{outcome="accepted"} 1',
    );
  });
});
