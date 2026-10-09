/**
 * @file **A date range in the query string is refused, before any peer, when it is not
 * the date the route's validator accepts.**
 *
 * Eight analytics routes and the finance-events route take a REQUIRED `from` and `to`
 * as query parameters. The published document types them as bare strings, and the
 * gateway validates them anyway, with a different rule on each family:
 *
 *   - the analytics routes use `@IsISO8601({ strict: true })`, which accepts a calendar
 *     date (`2026-01-01`), a full timestamp, and the basic form (`20260101`), and refuses
 *     a date that does not exist (`2026-02-30`) and anything else;
 *   - the finance route takes a calendar date in the `YYYY-MM-DD` form only: it refuses
 *     a timestamp, the basic form and a date that does not exist (`2026-02-30`).
 *
 * Neither rule is in the document, and a gateway taking the parameter as a plain
 * string would forward `not-a-date` to the peer on every one of these routes. The
 * second rule is narrower than the first, so a reading that treated the finance route
 * as "an ISO date too" would accept what it refuses.
 *
 * **Generated from the document, bound to a rule by name.** The routes are every GET
 * with a required `from` and `to` and no published format; each must be named below,
 * so a new range route fails here until someone decides which rule it follows.
 *
 * Each refusal row first requires the same request with a valid value NOT to be refused,
 * so a refusal for another reason cannot satisfy it, and a refusal must name the field
 * and ask no peer. "Valid" is "not a 400", not "reached a peer": two of these routes are
 * cached, so a valid request an earlier row already made is answered from Redis and asks
 * nothing. The field name is promised; the wording after it is not asserted (the parity
 * rule).
 */

import { ISO, PATTERN, type Rule } from './date-rules';
import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import { allOperations, bodySender, freshSubject } from './request-bodies';
import { readRunState } from './run-state';

const RULE_BY_ROUTE: Record<string, Rule> = {
  ...Object.fromEntries(
    [
      'overview',
      'deflection',
      'response-times',
      'volume',
      'satisfaction',
      'ai-usage',
      'agents',
      'knowledge-gaps',
    ].map((name) => [`/api/v1/analytics/${name}`, ISO]),
  ),
  '/api/v1/platform/finance/events': PATTERN,
};

const routes = allOperations().filter(
  (operation) =>
    operation.method === 'GET' &&
    /(^|&)from=/u.test(operation.query ?? '') &&
    /(^|&)to=/u.test(operation.query ?? ''),
);

describe('the range routes', () => {
  it('are exactly the ones named here, so a new one needs a decision', () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      Object.keys(RULE_BY_ROUTE).sort(),
    );
  });
});

describe('a date range in the query string', () => {
  let gateway: Gateway;
  let peers: Peers;

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

  const send = bodySender(
    () => gateway,
    () => peers,
  );

  const ask = (path: string, param: string, value: string, subject: string) => {
    const other = param === 'from' ? 'to=2026-01-31' : 'from=2026-01-01';

    return send(
      {
        method: 'GET',
        path: `${path}?${param}=${encodeURIComponent(value)}&${other}`,
        public: false,
      },
      undefined,
      subject,
    );
  };

  const rows = routes.flatMap((route) =>
    ['from', 'to'].flatMap((param) => {
      const rule = RULE_BY_ROUTE[route.path];

      return [
        ...rule.refused.map(
          (value) => [route.path, 'refuses', param, value] as const,
        ),
        ...rule.accepted.map(
          (value) => [route.path, 'accepts', param, value] as const,
        ),
      ];
    }),
  );

  rowFor('Ops').each(rows)(
    '**`GET %s` %s a `%s` of %j, before any peer is called**',
    async (path, verdict, param, value) => {
      const subject = freshSubject();

      if (verdict === 'refuses') {
        const valid = await ask(path, param, '2026-01-01', subject);
        if (valid.status === 400) {
          throw new Error(
            `${path}: the VALID ${param} was itself refused (${JSON.stringify(valid.body)}), so the row would prove nothing`,
          );
        }
        const refused = await ask(path, param, value, subject);

        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain(param);
        expect(refused.asked).toEqual([]);

        return;
      }

      const accepted = await ask(path, param, value, subject);

      expect(accepted.status).not.toBe(400);
    },
  );
});
