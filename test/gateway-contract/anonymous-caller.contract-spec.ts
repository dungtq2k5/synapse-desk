/**
 * @file **A route's published security is what it does to a caller with no session.**
 *
 * The published document says which routes need a session (`security`) and which are
 * public (`security: []`). A gateway generated from, or described by, that document
 * is only as safe as the two agree with what the routes DO, and the Java gateway
 * publishes no `security` at all today: its document describes the whole API as open.
 * Before that is published, the behaviour it will describe has to be held.
 *
 * **Every operation, anonymous.** A secured route must refuse a caller with no session,
 * with 401, before any peer is asked. A public route must not refuse for lack of one.
 * The expectation is Node's guard truth, not the document alone: a route is secured
 * when Node's `JwtAuthGuard` runs on it (the route table `OrgAccessRoutesTest` already
 * holds against Node) OR the document names a scheme, so the routes Node's document
 * forgets to mark are still expected to refuse.
 *
 * Each request is otherwise VALID (a minimal body, every required query parameter), so
 * a 400 for a malformed body cannot stand in for the 401 a guard would have given first.
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
} from './request-bodies';
import { readRunState } from './run-state';

type TableRow = [string, string, string, boolean, boolean];

/** Node's guard truth for every route: `[METHOD, path, kind, jwtGuarded, superAdminOnly]`. */
const table = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      'apps/api-gateway/test/fixtures/lifecycle/org-access-routes.json',
    ),
    'utf8',
  ),
) as TableRow[];
const guarded = new Set(
  table.filter((row) => row[3]).map((row) => `${row[0]} ${row[1]}`),
);

/**
 * Public routes whose 401 is NOT a missing session, with why: a webhook intake refuses
 * a request whose signature does not verify with 401, and the tenant-login step refuses
 * one without the tenant-selection token a first login hands back. An anonymous probe
 * is exactly that request, so for these a 401 says nothing about a session.
 */
const REFUSES_FOR_ANOTHER_REASON = new Set([
  'POST /api/v1/webhooks/email/resend',
  'POST /api/v1/auth/login/tenant',
]);

/**
 * Routes whose document says a session is needed and whose code does not ask for one.
 * `logout` publishes `access-cookie` and answers 200 to a caller with no session (there
 * is nothing to revoke), so the document is wrong for it: measured on Node, 200 with
 * `revokedSessionCount: 0`. Held as what it DOES, so the divergence is a row and not a
 * comment.
 */
const OPEN_DESPITE_THE_DOCUMENT = new Set(['POST /api/v1/auth/logout']);

const operations = allOperations().map((operation) => ({
  ...operation,
  key: `${operation.method} ${operation.path}`,
  secured:
    !OPEN_DESPITE_THE_DOCUMENT.has(`${operation.method} ${operation.path}`) &&
    (guarded.has(`${operation.method} ${operation.path}`) ||
      (operation.security?.length ?? 0) > 0),
  public:
    operation.security?.length === 0 ||
    OPEN_DESPITE_THE_DOCUMENT.has(`${operation.method} ${operation.path}`),
}));

describe('the operations list', () => {
  it('covers the whole API, and every route is exactly one of secured or public', () => {
    expect(operations.length).toBeGreaterThan(200);
    expect(operations.filter((o) => o.secured && o.public)).toEqual([]);
    expect(
      operations.filter((o) => !o.secured && !o.public).map((o) => o.key),
    ).toEqual([]);
  });
});

describe('an anonymous caller', () => {
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

  for (const operation of operations) {
    const request = {
      method: operation.method,
      path: operation.query
        ? `${operation.path}?${operation.query}`
        : operation.path,
      // The sender sends no cookie for a request it is told is public.
      public: true,
    };
    const body = operation.body ? minimalValue(operation.body) : undefined;

    if (operation.secured) {
      rowFor('Ops')(
        `**\`${operation.key}\` refuses a caller with no session: 401, before any peer is asked**`,
        async () => {
          const outcome = await send(request, body, freshSubject());

          expect(outcome.status).toBe(401);
          expect(outcome.asked).toEqual([]);
        },
      );
    } else if (!REFUSES_FOR_ANOTHER_REASON.has(operation.key)) {
      rowFor('Ops')(
        `**\`${operation.key}\` is public: an anonymous caller is not refused for lack of a session**`,
        async () => {
          const outcome = await send(request, body, freshSubject());

          expect(outcome.status).not.toBe(401);
        },
      );
    }
  }
});
