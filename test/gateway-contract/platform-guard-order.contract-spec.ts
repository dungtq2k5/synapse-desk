/**
 * @file **A caller who is not a super admin is refused a `/platform` route with 403 BEFORE
 * the body is read, however invalid the body is.**
 *
 * Node guards the whole `/platform` surface with `SuperAdminGuard`, which runs ahead of
 * the validation pipe. A tenant member who sends an invalid body to one of these routes
 * is told they are not allowed, not what is wrong with a body they have no right to send.
 * Java checked the claim inline in each handler, AFTER Spring had bound and validated the
 * body, so the same caller got a 400 naming the missing fields on 7 of the 25 routes
 * (measured by sending `{}` as a member to every secured route with a required body field
 * on both gateways: 58 routes, 51 agreed, and these were the 7 that did not).
 *
 * **The route set is Node's own.** The 25 `superAdminOnly` rows of the route table
 * `OrgAccessRoutesTest` already holds against Node are exactly the routes under
 * `/platform`; the rows are that set intersected with the document's operations that take a
 * body with a required field, so a route that is all-optional is not a row it could pass
 * for the wrong reason.
 *
 * **Both requests, and why.** The member sends the invalid body (the row) and a VALID one
 * (the control): the control shows the refusal is for authorization, so a route that
 * refuses every member for another reason cannot satisfy the row. Neither may reach a peer.
 * The status 403 is promised; the wording is not asserted (the parity rule).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Gateway, REPO_ROOT, startGateway } from './gateway';
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

type TableRow = [string, string, string, boolean, boolean];

const table = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      'apps/api-gateway/test/fixtures/lifecycle/org-access-routes.json',
    ),
    'utf8',
  ),
) as TableRow[];

const superAdminOnly = new Set(
  table.filter((row) => row[4]).map((row) => `${row[0]} ${row[1]}`),
);

const routes = allOperations().filter(
  (operation) =>
    superAdminOnly.has(`${operation.method} ${operation.path}`) &&
    operation.body &&
    (resolve(operation.body).required?.length ?? 0) > 0,
);

describe('the super-admin routes with a required body', () => {
  it('are found, and are all under /platform', () => {
    // A floor, not the exact set: the count moves with the API, but it must not be 0.
    expect(routes.length).toBeGreaterThanOrEqual(7);
    expect(routes.filter((route) => !route.path.includes('/platform'))).toEqual(
      [],
    );
  });
});

describe('a tenant member on a /platform route', () => {
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

  const rows = routes.map(
    (route) => [route.method, route.path, route.body] as const,
  );

  rowFor('Ops').each(rows)(
    '**`%s %s` refuses a tenant member with 403, before reading an invalid body**',
    async (method, path, schema) => {
      const subject = freshSubject();
      // The backfill route names a job; the other path variables are ids.
      const request = {
        method,
        path: path.replace('{name}', 'analytics-daily'),
        public: false,
        member: true,
      };

      const control = await send(request, minimalValue(schema!), subject);
      expect(control.status).toBe(403);
      expect(control.asked).toEqual([]);

      const refused = await send(request, {}, subject);
      expect(refused.status).toBe(403);
      expect(refused.asked).toEqual([]);
    },
  );
});
