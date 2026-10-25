import { Logger } from '@nestjs/common';
import { faker } from '@faker-js/faker';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';

/**
 * `POST /client-errors`: a browser error becomes one WARN line,
 * `"event":"client_error"`, and nothing else.
 */
describe('Client errors (e2e)', () => {
  let fx: E2eFixture;
  let warn: jest.SpyInstance;

  const report = (overrides: Record<string, unknown> = {}) => ({
    kind: 'error',
    message: 'Cannot read properties of undefined',
    stack: 'TypeError: Cannot read…\n    at render (page.js:1:1)',
    path: '/tickets/42?tab=notes&q=secret#reply',
    buildId: 'abc1234',
    ...overrides,
  });

  /** The client_error lines written since the spy was reset, parsed. */
  const lines = (): Record<string, unknown>[] =>
    warn.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('"event":"client_error"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  /** A fresh address per test: the limit is per address. */
  const from = () => faker.internet.ipv4();

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    warn = jest.spyOn(Logger.prototype, 'warn');
  });

  afterEach(() => warn.mockRestore());

  afterAll(() => fx.close());

  it('**1. signed out: 204, one line, the path without its query or fragment**', async () => {
    const res = await anonymousAgent(fx.app)
      .post(`${API}/client-errors`)
      .set('X-Forwarded-For', from())
      .set('User-Agent', 'Mozilla/5.0 test')
      .send(report());

    expect(res.status).toBe(204);
    expect(lines()).toEqual([
      {
        event: 'client_error',
        kind: 'error',
        message: 'Cannot read properties of undefined',
        stack: 'TypeError: Cannot read…\n    at render (page.js:1:1)',
        path: '/tickets/42',
        userAgent: 'Mozilla/5.0 test',
        buildId: 'abc1234',
      },
    ]);
  });

  it('2. signed in: the user and organization ids too', async () => {
    const sub = faker.string.uuid();
    const organizationId = faker.string.uuid();

    const res = await authenticatedAgent(fx.app, { sub, organizationId })
      .post(`${API}/client-errors`)
      .set('X-Forwarded-For', from())
      .send(report({ kind: 'boundary' }));

    expect(res.status).toBe(204);
    expect(lines()[0]).toMatchObject({
      kind: 'boundary',
      userId: sub,
      organizationId,
    });
  });

  it('3. over 8 KB is refused with 413, and nothing is logged', async () => {
    const res = await anonymousAgent(fx.app)
      .post(`${API}/client-errors`)
      .set('X-Forwarded-For', from())
      .send(report({ stack: 'x'.repeat(9 * 1024) }));

    expect(res.status).toBe(413);
    expect(lines()).toEqual([]);
  });

  it('4. an unknown kind is a 400', async () => {
    const res = await anonymousAgent(fx.app)
      .post(`${API}/client-errors`)
      .set('X-Forwarded-For', from())
      .send(report({ kind: 'everything' }));

    expect(res.status).toBe(400);
  });

  it('5. rate-limited per address: the eleventh report in a minute is a 429', async () => {
    const address = from();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      statuses.push(
        (
          await anonymousAgent(fx.app)
            .post(`${API}/client-errors`)
            .set('X-Forwarded-For', address)
            .send(report())
        ).status,
      );
    }

    expect(statuses).toEqual([...Array<number>(10).fill(204), 429]);
    // Another address is not affected.
    expect(
      (
        await anonymousAgent(fx.app)
          .post(`${API}/client-errors`)
          .set('X-Forwarded-For', from())
          .send(report())
      ).status,
    ).toBe(204);
  });
});
