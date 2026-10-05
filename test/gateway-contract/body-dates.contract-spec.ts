/**
 * @file **A date range in a request BODY is refused, before any peer, when it is not a
 * date Node's `@IsISO8601({ strict: true })` accepts, and accepted when it is.**
 *
 * Four POST routes take a `from` and `to` in the body (the analytics, ticket and audit
 * exports, and the platform job backfill). All four are validated with the same rule
 * (see `date-rules.ts`), and it accepts more than a calendar date and a timestamp with an
 * offset: an offset-less timestamp, the basic form, a space for the `T`, `+0700`, a week
 * date, an ordinal date. Each form is a row, because a hand-written approximation of the
 * rule refuses exactly these, and a client that sends one would get a 400.
 *
 * **Both directions are rows.** A refusal row alone would pass a gateway that refused
 * everything; each accepted form is its own row and must not be a 400.
 *
 * **Generated from the document**: every non-GET with a body that has a `from` and a
 * `to`. A new one needs a decision (a different rule is named in `date-rules.ts`), so
 * the route list is checked against the four named here. The query-string counterpart is
 * `query-dates.contract-spec.ts`. The field name is promised in a refusal; the wording
 * after it is not asserted (the parity rule).
 *
 * **A stated limit, found by sabotage.** On the backfill route a `to` that sorts BEFORE the
 * other side as a string (the empty string, a leading space) is also refused by that
 * route's own "from must not be after to" rule, and its message names `to`, so those two
 * refusal rows pin that the value is refused but not that the DATE FORMAT refused it.
 * Dropping the annotation from `BackfillJobDto.to` fails the other three refusals and
 * not these two. The mechanical fix, asserting the message says why, is the wording the
 * parity rule forbids; the other fields have no such second rule.
 */

import { ISO } from './date-rules';
import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  allOperations,
  bodySender,
  freshSubject,
  minimalValue,
  resolve,
} from './request-bodies';
import { readRunState } from './run-state';

const NAMED = [
  'POST /api/v1/analytics/export',
  'POST /api/v1/audit-logs/export',
  'POST /api/v1/platform/jobs/{name}/backfill',
  'POST /api/v1/tickets/export',
];

const routes = allOperations().filter((operation) => {
  if (operation.method === 'GET' || !operation.body) return false;
  const properties = resolve(operation.body).properties ?? {};

  return 'from' in properties && 'to' in properties;
});

describe('the routes with a date range in the body', () => {
  it('are exactly the ones named here, so a new one needs a decision', () => {
    expect(
      routes.map((route) => `${route.method} ${route.path}`).sort(),
    ).toEqual(NAMED);
  });
});

describe('a date range in a request body', () => {
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

  const ask = (
    route: (typeof routes)[number],
    param: string,
    value: string,
    subject: string,
  ) => {
    const body = minimalValue(route.body!) as Record<string, unknown>;
    // The side NOT under test is far enough out that no form compares the wrong way:
    // the backfill route refuses `from > to` as STRINGS, so `20260101` as a `from` sorts
    // after `2026-01-31` and would be a 400 for ordering, not for its format.
    body.from = '2000-01-01';
    body.to = '2999-12-31';
    body[param] = value;

    return send(
      {
        method: route.method,
        // The backfill route names a job, and an unknown one is a 400 before the dates are
        // read, which would make every row there pass or fail for the wrong reason.
        path: route.path.replace('{name}', 'analytics-daily'),
        public: false,
      },
      body,
      subject,
    );
  };

  const rows = routes.flatMap((route) =>
    ['from', 'to'].flatMap((param) => [
      ...ISO.refused.map(
        (value) => [route.path, 'refuses', param, value] as const,
      ),
      ...ISO.accepted.map(
        (value) => [route.path, 'accepts', param, value] as const,
      ),
    ]),
  );

  rowFor('Ops').each(rows)(
    '**`POST %s` %s a `%s` of %j, before any peer is called**',
    async (path, verdict, param, value) => {
      const route = routes.find((candidate) => candidate.path === path)!;
      const subject = freshSubject();

      if (verdict === 'refuses') {
        const valid = await ask(route, param, '2026-01-01', subject);
        if (valid.status === 400) {
          throw new Error(
            `${path}: the VALID ${param} was itself refused (${JSON.stringify(valid.body)}), so the row would prove nothing`,
          );
        }
        const refused = await ask(route, param, value, subject);

        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain(param);
        expect(refused.asked).toEqual([]);

        return;
      }

      expect((await ask(route, param, value, subject)).status).not.toBe(400);
    },
  );
});
