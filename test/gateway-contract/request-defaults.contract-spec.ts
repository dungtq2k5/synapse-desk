/**
 * @file **A request field the document gives a `default` behaves as that default when it
 * is left out.**
 *
 * Node's published document gives 21 optional request properties a `default`: six
 * booleans (`isPrimary` false, `isActive` true), thirteen lists (`[]`), a search `limit`
 * of 0. A client generated from it fills the value in, and a client that reads the
 * document believes that leaving the field out and sending the default are the same
 * request. The Java document published none of them, so nothing told a client that, and
 * nothing held it either: every other row sends a minimal body, so no row ever compared
 * "absent" with "the default".
 *
 * **One rule, one row per field, generated from the document.** For each optional
 * property with a `default`, the request with the field ABSENT and the request with the
 * field sent AS its default must get the same status and ask the peer the same thing. The
 * baseline must reach the peer, or the row would compare two refusals and pass. The
 * direction is from the document toward the gateway: it proves a published default is
 * true, not that the document lists every default that is.
 *
 * **Where the rule does not reach, it says so.** A property inside an OPTIONAL container
 * is not generated (a row would have to invent the container), and a route this
 * arrangement cannot reach is named with why, never dropped.
 */

import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  type KeyPath,
  bodySender,
  freshSubject,
  jsonRequests,
  minimalValue,
  optionalPaths,
  resolve,
  setAt,
} from './request-bodies';
import { readRunState } from './run-state';

/** Routes the rows cannot reach the peer on, with why: the cookie or token they need. */
const UNREACHABLE: Record<string, string> = {
  'POST /api/v1/auth/2fa/authenticate':
    'needs the 2FA-pending cookie, which this identity does not carry',
};

type Schema = Parameters<typeof resolve>[0];

/** The property schema at a key path inside a body, as the document wrote it. */
const propertyAt = (raw: Schema, path: KeyPath): Schema => {
  let current = raw;
  for (const key of path) {
    const schema = resolve(current);
    current =
      typeof key === 'number'
        ? (schema.items ?? {})
        : ((schema.properties ?? {})[key] ?? {});
  }

  return current;
};

type Field = {
  method: string;
  path: string;
  field: KeyPath;
  key: string;
  public: boolean;
  schema: Schema;
  value: unknown;
};

const fields: Field[] = jsonRequests().flatMap((request) =>
  optionalPaths(request.schema).flatMap((field) => {
    const property = propertyAt(request.schema, field) as { default?: unknown };

    return 'default' in property
      ? [
          {
            method: request.method,
            path: request.path,
            field,
            key: `${request.method} ${request.path} ${field.join('.')}`,
            public: request.public,
            schema: request.schema,
            value: property.default,
          },
        ]
      : [];
  }),
);

const reachable = fields.filter(
  (field) => !(`${field.method} ${field.path}` in UNREACHABLE),
);

describe('the properties with a default', () => {
  it('are found in the document, and the unreachable ones are named', () => {
    expect(fields.length).toBeGreaterThanOrEqual(15);
    expect(
      fields.filter((f) => `${f.method} ${f.path}` in UNREACHABLE).length,
    ).toBeLessThan(fields.length);
  });
});

describe('a request field with a published default', () => {
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

  const sender = bodySender(
    () => gateway,
    () => peers,
  );

  rowFor('Ops').each(reachable.map((f) => [f.key] as const))(
    '**`%s` behaves, left out, as its published default: the same status, and the peer is asked the same**',
    async (key) => {
      const field = fields.find((f) => f.key === key)!;
      const subject = freshSubject();
      const absent = minimalValue(field.schema);
      const withDefault = JSON.parse(JSON.stringify(absent)) as unknown;
      setAt(withDefault, field.field, field.value);

      const before = await sender(field, absent, subject);
      if (before.asked.length === 0) {
        throw new Error(
          `${key}: the baseline (field absent) never reached the peer: ${before.status} ${JSON.stringify(before.body)}`,
        );
      }
      const after = await sender(field, withDefault, subject);

      expect({ status: after.status, asked: after.asked }).toEqual({
        status: before.status,
        asked: before.asked,
      });
    },
  );
});
