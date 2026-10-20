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
  required?: boolean;
  schema?: { enum?: (string | number)[] };
};

type Row = [
  method: string,
  path: string,
  parameter: string,
  valid: string | number,
  allValid: (string | number)[],
  required: string,
];

const SOME_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/**
 * A value that satisfies a REQUIRED, non-enum query parameter, so that what a row
 * refuses is the enum and not a missing date. Without it the analytics
 * `granularity` rows passed for the wrong reason: `from` and `to`
 * are required, and their absence is a 400 whatever `granularity` says.
 */
const REQUIRED_VALUE: Record<string, string> = {
  from: '2026-01-01',
  to: '2026-01-31',
};

/** `[METHOD, document path, parameter, one valid value, every valid value, required query]` for every enum query parameter. */
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
        const required = (operation.parameters ?? [])
          .filter(
            (other) =>
              other.in === 'query' && other.required && !other.schema?.enum,
          )
          .map((other) => `${other.name}=${REQUIRED_VALUE[other.name] ?? 'x'}`)
          .join('&');
        found.push([
          method.toUpperCase(),
          path,
          parameter.name,
          parameter.schema.enum[0],
          parameter.schema.enum,
          required,
        ]);
      }
    }
  }

  return found;
}

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

  const send = (method: string, path: string, query: string, required = '') =>
    new Session(gateway.baseUrl).request(
      method,
      `${path.replace(/\{\w+\}/gu, SOME_ID)}?${[query, required].filter(Boolean).join('&')}`,
      { headers: headers() },
    );

  const refusesOutsideTheEnum = async (
    method: string,
    path: string,
    parameter: string,
    _valid: string | number,
    _all: (string | number)[],
    required: string,
  ) => {
    const response = await send(
      method,
      path,
      `${parameter}=__not_a_value__`,
      required,
    );

    expect(response.status).toBe(400);
    // Which refusal: the one about THIS parameter. A 400 for any other cause (a
    // missing required parameter, a bad id) would otherwise pass. The field name
    // is promised by the parity rule; the wording after it is not asserted.
    expect(JSON.stringify(response.body)).toContain(parameter);
    expect(reached()).toEqual([]);
  };

  const refusesTheOtherCase = async (
    method: string,
    path: string,
    parameter: string,
    valid: string | number,
    _all: (string | number)[],
    required: string,
  ) => {
    const text = String(valid);
    const flipped =
      text.toLowerCase() === text ? text.toUpperCase() : text.toLowerCase();
    const response = await send(
      method,
      path,
      `${parameter}=${flipped}`,
      required,
    );

    expect(response.status).toBe(400);
    // Which refusal: the one about THIS parameter. A 400 for any other cause (a
    // missing required parameter, a bad id) would otherwise pass. The field name
    // is promised by the parity rule; the wording after it is not asserted.
    expect(JSON.stringify(response.body)).toContain(parameter);
    expect(reached()).toEqual([]);
  };

  rowFor('Ops').each(rows())(
    '**`%s %s` refuses a `%s` outside its enum, before any peer is called**',
    refusesOutsideTheEnum,
  );

  // `fileType` is the one parameter Node DELIBERATELY reads case-insensitively
  // (`document.dto.ts`: the stored values are lowercase, so `?fileType=PDF` would
  // otherwise 400), so it has its own row below instead of these.
  const CASE_INSENSITIVE = new Set(['fileType']);
  // A number has no case: `?rating=` is `1` or `-1`, and the rows above already
  // refuse anything else.
  const caseRows = rows().filter(
    ([, , name, valid]) =>
      !CASE_INSENSITIVE.has(name) && typeof valid === 'string',
  );

  rowFor('Ops').each(caseRows)(
    '**`%s %s` refuses a `%s` that differs from its enum only in case**',
    refusesTheOtherCase,
  );

  rowFor('Ops').each(rows().filter(([, , name]) => CASE_INSENSITIVE.has(name)))(
    '**`%s %s` accepts a `%s` in any case: the stored values are lowercase and `?fileType=PDF` must work**',
    async (method, path, parameter, valid, _all, required) => {
      const response = await send(
        method,
        path,
        `${parameter}=${String(valid).toUpperCase()}`,
        required,
      );

      // Past validation: whatever the unprogrammed peer then answers, it is not a 400.
      expect(response.status).not.toBe(400);
      expect(reached().length).toBeGreaterThan(0);
    },
  );

  // The refusal rows above send only values OUTSIDE the enum, so a gateway that
  // dropped a VALID value from its type would pass all of them and refuse a real
  // client. Every value the document lists is sent here, and none may be refused.
  rowFor('Ops').each(rows())(
    '**`%s %s` accepts every value of `%s` the contract lists, and the request reaches the peer**',
    async (method, path, parameter, _valid, allValid, required) => {
      for (const value of allValid) {
        peers.reset();
        const response = await send(
          method,
          path,
          `${parameter}=${value}`,
          required,
        );

        // Past validation: whatever the unprogrammed peer then answers, it is not a 400.
        expect({ value, status: response.status }).not.toEqual({
          value,
          status: 400,
        });
        expect(reached().length).toBeGreaterThan(0);
      }
    },
  );
});
