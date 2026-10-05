/**
 * @file **A request that arrives with no body, and no Content-Type, is treated as an empty
 * JSON object.**
 *
 * The body parser never asks a bodiless request for a Content-Type: it leaves the body as
 * `{}`. So a route whose body is all-optional is SERVED a bare `POST` (resolve a ticket,
 * mark one read, close it, patch a record with nothing to change), and a route with a
 * required field answers 400 for the field. A server that matched a route's content type
 * at routing time would answer 415 to all of them, before any guard runs, and break every
 * client that calls an all-optional route without a body.
 *
 * **Generated from the document: every operation that takes a body.** Required fields
 * decide which rule a route follows, and both are rows:
 *
 *   - a required field: 400, naming no peer;
 *   - an all-optional body: neither a 415 nor a 400 (it reaches whatever the route does,
 *     which here is a peer, or another guard's own refusal).
 *
 * The caller is fully permitted and verified, or no caller at all where the route is
 * public, so a guard's refusal is not what these rows read. The wording is not asserted
 * (the parity rule).
 */

import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  allOperations,
  bodySender,
  freshSubject,
  resolve,
} from './request-bodies';
import { readRunState } from './run-state';

const operations = allOperations().filter(
  (operation) => operation.body && operation.method !== 'GET',
);

const requiresAField = (operation: (typeof operations)[number]): boolean =>
  (resolve(operation.body!).required?.length ?? 0) > 0;

describe('the routes that take a body', () => {
  it('are found, with both kinds present', () => {
    expect(operations.length).toBeGreaterThan(70);
    expect(operations.some(requiresAField)).toBe(true);
    expect(operations.some((operation) => !requiresAField(operation))).toBe(
      true,
    );
  });
});

describe('a request with no body and no Content-Type', () => {
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

  const rows = operations.map(
    (operation) =>
      [
        operation.method,
        operation.path,
        requiresAField(operation)
          ? 'is refused with 400'
          : 'is not refused as a body error',
        operation.security?.length === 0,
      ] as const,
  );

  rowFor('Ops').each(rows)(
    '**`%s %s` with no body %s**',
    async (method, path, expectation, isPublic) => {
      const outcome = await send(
        {
          method,
          path: path.replace('{name}', 'analytics-daily'),
          public: isPublic,
        },
        undefined,
        freshSubject(),
      );

      if (expectation === 'is refused with 400') {
        expect(outcome.status).toBe(400);
        expect(outcome.asked).toEqual([]);

        return;
      }

      expect(outcome.status).not.toBe(415);
      expect(outcome.status).not.toBe(400);
    },
  );
});
