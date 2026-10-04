/**
 * @file **A body that does not fit its declared shape is refused at the door**, on
 * every JSON route: a key the shape does not declare, and a number, a boolean or an
 * object where it declares a string.
 *
 * Each is a 400 before any peer is asked: that is what distinguishes "refused at the
 * door" from "refused somewhere downstream", so every row asserts that NO peer was
 * called, not only the status. The message must name the field and must not name a
 * Java type: the parser's own text for these does (`java.lang.String`,
 * `JsonToken.START_OBJECT`), and that is an implementation detail leaking to a caller.
 * The rest of the wording is each gateway's own and is not asserted.
 *
 * **Only what both gateways do uniformly.** A string where the shape declares a number,
 * a boolean or a date is NOT covered: Node decides that per field (a `@Type(() =>
 * Number)` accepts `"5"`, and turns `true` into `1`), so there is no one rule to hold.
 *
 * **Generated from the document**, from the minimal valid body `request-bodies.ts`
 * builds, so a new route or field gets rows without anyone remembering. Each row first
 * requires that minimal body to be ACCEPTED and to reach a peer; otherwise it would
 * compare one refusal with another and pass.
 */

import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  bodySender,
  freshSubject,
  type JsonRequest,
  jsonRequests,
  type KeyPath,
  minimalValue,
  type Outcome,
  resolve,
  type Schema,
  setAt,
} from './request-bodies';
import { readRunState } from './run-state';

/**
 * Secured routes whose minimal body this arrangement cannot get past the door, with
 * why. Named, never dropped: a route here is one these rows do NOT cover.
 *
 * **No public route is generated.** Each is throttled per ADDRESS (forgot-password
 * allows three an hour), a row cannot vary its address, and every suite on one Redis
 * shares the budget, so generated rows would spend another suite's. The strict reader
 * is one converter for every route; the two login rows below hold it on a public one.
 */
const UNREACHABLE: Record<string, string> = {
  'POST /api/v1/auth/logout':
    'asks its peer only when a refresh cookie is present',
  'PATCH /api/v1/auth/password':
    'the minimal body fails the password-strength rule',
  'POST /api/v1/auth/2fa/authenticate':
    'needs the 2FA-pending cookie, which this identity does not carry',
  'POST /api/v1/auth/email/verify': 'the minimal code fails its format rule',
  'POST /api/v1/auth/phone/verify/request':
    'the minimal phone number is not a valid one',
  'POST /api/v1/auth/phone/verify': 'the minimal code fails its format rule',
  'POST /api/v1/platform/jobs/{name}/backfill':
    'the filled path names no job that exists',
};

const UNKNOWN = 'zzUnknown';

/** Text naming an implementation type rather than anything the caller sent. */
const JAVA_TYPE_NAME =
  /\b(java|javax|jakarta|com\.synapsedesk)\.|tools\.jackson|JsonToken|START_OBJECT|VALUE_(TRUE|FALSE|NUMBER_\w+|STRING)/u;

/**
 * A field read from a JSON string: a plain string of any format but a date, or a string
 * enum. The schema is `resolve`d, so an optional field's `null` is already set aside.
 */
const isStringLike = (schema: Schema): boolean =>
  schema.enum
    ? schema.enum
        .filter((value) => value !== null)
        .every((value) => typeof value === 'string')
    : schema.type === 'string' && schema.format !== 'date-time';

/** Every field of the minimal body (and every optional one beside them), with its schema. */
function fieldsOf(raw: Schema, prefix: KeyPath = []): [KeyPath, Schema][] {
  const schema = resolve(raw);
  if (schema.type === 'array') {
    return fieldsOf(schema.items ?? {}, [...prefix, 0]);
  }
  if (schema.type !== 'object') return [];

  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).flatMap(([key, value]) => {
    const own: [KeyPath, Schema] = [[...prefix, key], resolve(value)];
    return required.has(key)
      ? [own, ...fieldsOf(value, [...prefix, key])]
      : [own];
  });
}

/** Where, in the minimal body, an object sits that could carry an unknown key. */
function objectsIn(body: unknown, prefix: KeyPath = []): KeyPath[] {
  if (Array.isArray(body)) {
    return body.flatMap((item, index) => objectsIn(item, [...prefix, index]));
  }
  if (body === null || typeof body !== 'object') return [];

  return [
    prefix,
    ...Object.entries(body).flatMap(([key, value]) =>
      objectsIn(value, [...prefix, key]),
    ),
  ];
}

type Case = { key: string; route: string; body: unknown; field: string };

const routes = jsonRequests().filter(
  (request) =>
    !request.public && !(`${request.method} ${request.path}` in UNREACHABLE),
);
const byRoute = new Map(routes.map((r) => [`${r.method} ${r.path}`, r]));

const unknownKeys: Case[] = routes.flatMap((request) => {
  const route = `${request.method} ${request.path}`;
  const minimal = minimalValue(request.schema);

  return objectsIn(minimal).map((at) => {
    const body = structuredClone(minimal);
    if (at.length === 0) (body as Record<string, unknown>)[UNKNOWN] = true;
    else setAt(body, [...at, UNKNOWN], true);
    const where = [...at, UNKNOWN].join('.');

    return { key: `${route} ${where}`, route, body, field: UNKNOWN };
  });
});

const WRONG: [string, unknown][] = [
  ['a number', 5],
  ['a boolean', true],
  ['an object', { a: 1 }],
];

const wrongTypes: Case[] = routes.flatMap((request) => {
  const route = `${request.method} ${request.path}`;
  const minimal = minimalValue(request.schema);

  return fieldsOf(request.schema)
    .filter(([, schema]) => isStringLike(schema))
    .flatMap(([path]) =>
      WRONG.map(([kind, value]) => {
        const body = structuredClone(minimal);
        setAt(body, path, value);

        return {
          key: `${route} ${path.join('.')} as ${kind}`,
          route,
          body,
          field: String(path[path.length - 1]),
        };
      }),
    );
});

describe('a body that does not fit its declared shape', () => {
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

  /** Whether the minimal body reaches a peer, asked once per route. */
  const baselines = new Map<string, Promise<Outcome>>();
  const baseline = (request: JsonRequest) => {
    const route = `${request.method} ${request.path}`;
    if (!baselines.has(route)) {
      baselines.set(
        route,
        send(request, minimalValue(request.schema), freshSubject()),
      );
    }

    return baselines.get(route)!;
  };

  const refusedAtTheDoor = async (testCase: Case) => {
    const request = byRoute.get(testCase.route)!;
    const before = await baseline(request);
    // The row compares an accepted request with a refused one, or it proves nothing.
    if (before.asked.length === 0) {
      throw new Error(
        `${testCase.route}: the minimal body never reached a peer: ${before.status} ${JSON.stringify(before.body)}`,
      );
    }

    const after = await send(request, testCase.body, freshSubject());
    const error = (after.body as { error?: string }).error ?? '';

    expect({ status: after.status, asked: after.asked }).toEqual({
      status: 400,
      asked: [],
    });
    expect(error).toContain(testCase.field);
    expect(error).not.toMatch(JAVA_TYPE_NAME);
  };

  rowFor('Ops').each(unknownKeys.map((c) => [c.key] as const))(
    '**`%s`, a key the shape does not declare, is refused before any peer is asked**',
    async (key) => {
      await refusedAtTheDoor(unknownKeys.find((c) => c.key === key)!);
    },
  );

  rowFor('Ops').each(wrongTypes.map((c) => [c.key] as const))(
    '**`%s`, where the shape declares a string, is refused before any peer is asked**',
    async (key) => {
      await refusedAtTheDoor(wrongTypes.find((c) => c.key === key)!);
    },
  );

  rowFor('Auth')(
    '**login refuses a key the shape does not declare, before auth-service is asked**',
    async () => {
      const outcome = await send(
        { method: 'POST', path: '/api/v1/auth/login', public: true },
        { email: 'a@example.com', password: 'Passw0rd!', [UNKNOWN]: true },
      );
      const error = (outcome.body as { error: string }).error;

      expect({ status: outcome.status, asked: outcome.asked }).toEqual({
        status: 400,
        asked: [],
      });
      expect(error).toContain(UNKNOWN);
      expect(error).not.toMatch(JAVA_TYPE_NAME);
    },
  );

  rowFor('Auth')(
    '**login refuses a password that is not a string, naming the field and no Java type**',
    async () => {
      const outcome = await send(
        { method: 'POST', path: '/api/v1/auth/login', public: true },
        { email: 'a@example.com', password: { a: 1 } },
      );
      const error = (outcome.body as { error: string }).error;

      expect({ status: outcome.status, asked: outcome.asked }).toEqual({
        status: 400,
        asked: [],
      });
      expect(error).toContain('password');
      expect(error).not.toMatch(JAVA_TYPE_NAME);
    },
  );
});
