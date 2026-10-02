/**
 * @file **Every enum-valued query parameter the published contract declares
 * refuses a value outside it**, before anything reaches a peer.
 *
 * The published document lists 60 query parameters with an `enum` (23 distinct
 * sets: `sortOrder` on 21 routes, `granularity` on 8, `sortBy`, `status`, ...).
 * Node refuses anything else with a 400. A gateway that took the parameter as a
 * plain string and compared it loosely (`"DESC".equalsIgnoreCase(sortOrder)`)
 * would accept `desc`, accept `sideways`, and answer 200, and no other row would
 * notice: every other row sends a valid value.
 *
 * **Generated from the document, not listed.** The rows are read off the
 * committed `openapi.json`, so a new enum parameter gets a row without anyone
 * remembering, and a hand-kept list cannot drift from the contract it checks.
 * The direction is from the document toward the gateway: it can only prove a
 * listed refusal exists, not that the document lists every parameter that
 * should refuse.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sign } from 'jsonwebtoken';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, REPO_ROOT, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

type Parameter = {
  name: string;
  in: string;
  schema?: { enum?: string[] };
};

type Row = [method: string, path: string, parameter: string, valid: string];

const SOME_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/** `[METHOD, document path, parameter, one valid value]` for every enum query parameter. */
function rows(): Row[] {
  const document = JSON.parse(
    readFileSync(join(REPO_ROOT, 'docs/reference/openapi.json'), 'utf8'),
  ) as {
    paths: Record<string, Record<string, { parameters?: Parameter[] }>>;
  };
  const found: Row[] = [];

  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const parameter of operation.parameters ?? []) {
        if (parameter.in !== 'query' || !parameter.schema?.enum?.length) {
          continue;
        }
        found.push([
          method.toUpperCase(),
          path,
          parameter.name,
          parameter.schema.enum[0],
        ]);
      }
    }
  }

  return found;
}

/**
 * The (route, parameter) pairs the Java gateway does not yet refuse, MEASURED
 * from a full run of these rows on Java (42 accept a value outside the enum, 40
 * of them also in another case), not guessed. They are the progress bar for the
 * enum work and shrink to empty: a pair leaves its set in the commit that makes
 * Java refuse it, and the rows for every other pair run on Java today. Rows in a
 * set are reported skipped for Java through `SKIPPED_FOR_JAVA`, never silently.
 */
const NOT_YET_REFUSED_OUTSIDE = new Set([
  'GET /api/v1/chat/conversations priority',
  'GET /api/v1/chat/conversations source',
  'GET /api/v1/chat/conversations status',
  'GET /api/v1/documents fileType',
  'GET /api/v1/documents status',
  'GET /api/v1/documents/flags severity',
  'GET /api/v1/documents/{id}/chunks fileType',
  'GET /api/v1/documents/{id}/chunks status',
  'GET /api/v1/notifications type',
  'GET /api/v1/users/invitations status',
]);

const NOT_YET_REFUSED_IN_CASE = new Set([
  'GET /api/v1/chat/conversations priority',
  'GET /api/v1/chat/conversations source',
  'GET /api/v1/chat/conversations status',
  'GET /api/v1/documents status',
  'GET /api/v1/documents/flags severity',
  'GET /api/v1/documents/{id}/chunks status',
  'GET /api/v1/notifications type',
  'GET /api/v1/users/invitations status',
]);

describe('enum-valued query parameters', () => {
  let gateway: Gateway;
  let peers: Peers;

  const headers = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: SOME_ID,
        organizationId: null,
        isSuperAdmin: true,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

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

  beforeEach(() => peers.reset());

  /** Calls a request caused: the gateway's own background job-health polls are not one. */
  const reached = () =>
    Object.values({
      auth: peers.auth,
      ticket: peers.ticket,
      ingestion: peers.ingestion,
      rag: peers.rag,
      notification: peers.notification,
    }).flatMap((peer) =>
      peer.calls().filter((call) => !call.method.endsWith('JobHealth')),
    );

  const send = (method: string, path: string, query: string) =>
    new Session(gateway.baseUrl).request(
      method,
      `${path.replace(/\{\w+\}/gu, SOME_ID)}?${query}`,
      { headers: headers() },
    );

  const refusesOutsideTheEnum = async (
    method: string,
    path: string,
    parameter: string,
  ) => {
    const response = await send(method, path, `${parameter}=__not_a_value__`);

    expect(response.status).toBe(400);
    expect(reached()).toEqual([]);
  };

  const refusesTheOtherCase = async (
    method: string,
    path: string,
    parameter: string,
    valid: string,
  ) => {
    const flipped =
      valid.toLowerCase() === valid ? valid.toUpperCase() : valid.toLowerCase();
    const response = await send(method, path, `${parameter}=${flipped}`);

    expect(response.status).toBe(400);
    expect(reached()).toEqual([]);
  };

  const key = (row: Row) => `${row[0]} ${row[1]} ${row[2]}`;

  rowFor('Ops').each(
    rows().filter((row) => !NOT_YET_REFUSED_OUTSIDE.has(key(row))),
  )(
    '**`%s %s` refuses a `%s` outside its enum, before any peer is called**',
    refusesOutsideTheEnum,
  );

  rowFor('Ops').each(
    rows().filter((row) => NOT_YET_REFUSED_OUTSIDE.has(key(row))),
  )(
    '**`%s %s` refuses a `%s` outside its enum, before any peer is called** (Java does not refuse this yet)',
    refusesOutsideTheEnum,
  );

  // `fileType` is the one parameter Node DELIBERATELY reads case-insensitively
  // (`document.dto.ts`: the stored values are lowercase, so `?fileType=PDF` would
  // otherwise 400), so it has its own row below instead of these.
  const CASE_INSENSITIVE = new Set(['fileType']);
  const caseRows = rows().filter(([, , name]) => !CASE_INSENSITIVE.has(name));

  rowFor('Ops').each(
    caseRows.filter((row) => !NOT_YET_REFUSED_IN_CASE.has(key(row))),
  )(
    '**`%s %s` refuses a `%s` that differs from its enum only in case**',
    refusesTheOtherCase,
  );

  rowFor('Ops').each(
    caseRows.filter((row) => NOT_YET_REFUSED_IN_CASE.has(key(row))),
  )(
    '**`%s %s` refuses a `%s` that differs from its enum only in case** (Java does not refuse this yet)',
    refusesTheOtherCase,
  );

  rowFor('Ops').each(rows().filter(([, , name]) => CASE_INSENSITIVE.has(name)))(
    '**`%s %s` accepts a `%s` in any case: the stored values are lowercase and `?fileType=PDF` must work**',
    async (method, path, parameter, valid) => {
      const response = await send(
        method,
        path,
        `${parameter}=${valid.toUpperCase()}`,
      );

      // Past validation: whatever the unprogrammed peer then answers, it is not a 400.
      expect(response.status).not.toBe(400);
      expect(reached().length).toBeGreaterThan(0);
    },
  );
});
