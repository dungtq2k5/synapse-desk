/**
 * @file **A constraint a request field carries beyond its JSON type is published, and
 * enforced at the door.**
 *
 * A password's strength, a phone number's shape, an OTP's digits, a date's ISO form, a
 * slug's pattern: the JSON type of each is `string`, and the field accepts far less than
 * any string. Two things have to be true of every such constraint, and this holds both:
 *
 * - **Published.** The document says so: a `pattern`, a `format: date-time`, or, where
 *   no keyword can say it (a valid phone number, a date in the future), the fixed
 *   sentence `ConstraintPublishingCustomizer` appends to the description. A client
 *   generated from the document learns the rule instead of discovering it as a 400.
 * - **Enforced.** The field set to a value that breaks it is refused with 400, naming
 *   the field, before any peer is called. Each row first sends the SAME request with a
 *   valid value, which must reach the peer, so a refusal for another reason cannot
 *   satisfy it.
 *
 * **Found from the SOURCE, not the document.** The Java gateway's sources are scanned
 * (`java-constraint-scan.ts`, held to a hostile fixture and a floor), so a constraint
 * added to a DTO gets rows, and fails the first half until it is published. A scan from
 * the document outward could only find what is already published.
 *
 * **A stated limit.** A row pins the FIELD, not the constraint: it requires the refusal to
 * name the field, and each invalid sample is chosen to break only the constraint under
 * test, but nothing checks that mechanically. Asserting the message names the
 * constraint is not available: its wording is the validator's, and the parity rule holds
 * text equal only where this repository writes it. Careful samples and this note are
 * the trade.
 *
 * **Throttling.** An authenticated caller is throttled per user and the export routes
 * allow 5 a minute, so every row acts as its own fresh subject ({@link freshSubject}).
 * A PUBLIC route is throttled per address, which a row cannot vary: its rows send two
 * requests each and rely on the suite not spending that budget elsewhere.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Gateway, REPO_ROOT, startGateway } from './gateway';
import { type Kind, scanJavaDirectory } from './java-constraint-scan';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  bodySender,
  bodyWith,
  freshSubject,
  hasSchema,
  jsonRequests,
  pathsTo,
  resolve,
  type Schema,
} from './request-bodies';
import { readRunState } from './run-state';

type Sample = { valid: string; invalid: string };

const ISO_VALID = '2026-01-01T00:00:00.000Z';

/** A value that satisfies the constraint and one that breaks it, by kind. */
const KINDS: Record<Kind, Sample> = {
  // Long enough, so only the character classes are broken: a short value would also fail a
  // length check, and a port that kept only that check would still pass.
  StrongPassword: { valid: 'Str0ng!Passw0rd', invalid: 'alllowercaseletters' },
  ValidPhoneNumber: { valid: '+14155552671', invalid: 'abc' },
  // A code carries a length range too (4 to 10), so the bad value is the right length.
  NumberString: { valid: '123456', invalid: 'abcdef' },
  FutureDate: {
    valid: '2999-01-01T00:00:00.000Z',
    invalid: '2000-01-01T00:00:00.000Z',
  },
  StrictIso8601: { valid: ISO_VALID, invalid: 'not-a-date' },
  OffsetDateTime: { valid: ISO_VALID, invalid: 'not-a-date' },
  Matches: { valid: '', invalid: '' },
};

/** `@Matches` carries a different pattern on each field, so its samples are per field. */
const MATCHES: Record<string, Sample> = {
  slug: { valid: 'acme-co', invalid: 'Bad Slug!' },
  domain: { valid: 'acme.com', invalid: 'not a domain!' },
  stripePriceId: { valid: 'price_123', invalid: 'bad id!' },
  stripeProductId: { valid: 'prod_123', invalid: 'bad id!' },
};

/** The sentence `ConstraintPublishingCustomizer` publishes for a rule no keyword can state. */
const sentence = (name: string): string => {
  const source = readFileSync(
    join(
      REPO_ROOT,
      'apps/api-gateway/src/main/java/com/synapsedesk/gateway/openapi/ConstraintPublishingCustomizer.java',
    ),
    'utf8',
  );
  const found = new RegExp(String.raw`${name} =\s*"([^"]+)"`, 'u').exec(source);
  if (!found)
    throw new Error(`no ${name} sentence in ConstraintPublishingCustomizer`);

  return found[1];
};

const descriptionOf = (property: Record<string, unknown>): string =>
  typeof property.description === 'string' ? property.description : '';

/** Whether the published property says what `kind` requires of it. */
const PUBLISHED: Record<
  Kind,
  (property: Schema & Record<string, unknown>) => boolean
> = {
  Matches: (p) => typeof p.pattern === 'string',
  StrictIso8601: (p) => typeof p.pattern === 'string',
  NumberString: (p) => typeof p.pattern === 'string',
  StrongPassword: (p) => typeof p.pattern === 'string',
  OffsetDateTime: (p) => p.format === 'date-time',
  ValidPhoneNumber: (p) => descriptionOf(p).includes(sentence('PHONE')),
  FutureDate: (p) => descriptionOf(p).includes(sentence('FUTURE')),
};

type Found = {
  schema: string;
  property: string;
  kind: Kind;
  role: 'body' | 'response' | 'other';
};

const requests = jsonRequests();
const reachedFromARequest = (schema: string) =>
  requests.some((request) => pathsTo(request.schema, schema).length > 0);

/**
 * Every constraint the Java sources declare, and what its class is: a request BODY (a
 * schema reachable from a request), a RESPONSE (a schema no request reaches, whose
 * validators nothing runs, and whose dates are only dates), or OTHER (a query
 * parameter, or a class that is no published schema).
 */
const found: Found[] = scanJavaDirectory(
  join(REPO_ROOT, 'apps/api-gateway/src/main/java'),
).map((constraint) => ({
  schema: constraint.className,
  property: constraint.property,
  kind: constraint.kind,
  role:
    constraint.on === 'parameter'
      ? 'other'
      : reachedFromARequest(constraint.className)
        ? 'body'
        : hasSchema(constraint.className)
          ? 'response'
          : 'other',
}));
/**
 * Constraints enforced in service code rather than by an annotation, so the scan cannot
 * see them, each with the rule its description must state. Named, so they keep their
 * rows and their publication: the platform `slug` is trimmed and lowercased BEFORE the
 * pattern applies (Node's order, so `ACME-Corp` succeeds), which no annotation or
 * `pattern` keyword can state, and a pattern would wrongly refuse the uppercase input.
 */
const ENFORCED_IN_CODE: (Found & { publishedAs: string })[] = [
  'CreatePlatformOrganizationDto',
  'UpdatePlatformOrganizationDto',
].map((schema) => ({
  schema,
  property: 'slug',
  kind: 'Matches',
  role: 'body',
  publishedAs: 'lowercase letters, digits and hyphens only',
}));

const constraints = [
  ...found.filter((item) => item.role === 'body'),
  ...ENFORCED_IN_CODE,
];

/**
 * Constraints on values these rows CANNOT send, named so they are not mistaken for
 * covered: query parameters (`query-dates.contract-spec.ts` holds the analytics ranges)
 * and the inbound-mail record the webhook intake builds.
 */
const NOT_A_BODY = [
  ...new Set(
    found
      .filter((item) => item.role === 'other')
      .map((item) => `${item.schema}.${item.property} (${item.kind})`),
  ),
];

const sampleFor = (item: Found): Sample | undefined =>
  item.kind === 'Matches' ? MATCHES[item.property] : KINDS[item.kind];

/**
 * A value that satisfies EVERY constraint on the field, not only the one a row breaks:
 * `lockedUntil` is an ISO date AND in the future, so a past date is refused for the
 * second reason and would make the first row prove nothing. The most restrictive wins.
 */
const MOST_RESTRICTIVE: Kind[] = [
  'FutureDate',
  'StrongPassword',
  'ValidPhoneNumber',
  'NumberString',
  'Matches',
  'StrictIso8601',
  'OffsetDateTime',
];
const validFor = (item: Found): string => {
  const kinds = constraints
    .filter((c) => c.schema === item.schema && c.property === item.property)
    .map((c) => c.kind);
  const strongest =
    MOST_RESTRICTIVE.find((kind) => kinds.includes(kind)) ?? item.kind;

  return sampleFor({ ...item, kind: strongest })!.valid;
};

type Row = {
  request: ReturnType<typeof jsonRequests>[number];
  path: (string | number)[];
  item: Found;
};

const rows: Row[] = constraints.flatMap((item) =>
  requests.flatMap((request) =>
    pathsTo(request.schema, item.schema).map((path) => ({
      request,
      path,
      item,
    })),
  ),
);

/**
 * A path variable the generic filler cannot invent: a backfill is accepted only for a
 * job that can be triggered by hand, and `ledger-daily` sends its range to the peer.
 */
const FILLED_PATHS: Record<string, string> = {
  '/api/v1/platform/jobs/{name}/backfill':
    '/api/v1/platform/jobs/ledger-daily/backfill',
};
const routeOf = (row: Row) => ({
  ...row.request,
  path: FILLED_PATHS[row.request.path] ?? row.request.path,
});

const keyOf = (row: Row) =>
  `${row.request.method} ${row.request.path} ${row.item.property} ${row.item.kind}`;

const document = JSON.parse(
  readFileSync(join(REPO_ROOT, 'docs/reference/openapi.json'), 'utf8'),
) as { components: { schemas: Record<string, Schema> } };

describe('the constraints the Java sources declare', () => {
  it('include at least the 25 request fields measured when this was written, across all 7 kinds', () => {
    // A result of 19 is a finding about the scan, not a tidier number.
    const fields = new Set(constraints.map((c) => `${c.schema}.${c.property}`));
    const kinds = new Set(constraints.map((c) => c.kind));

    expect(fields.size).toBeGreaterThanOrEqual(25);
    expect(kinds.size).toBe(7);
  });

  it('are each PUBLISHED: a pattern, a date-time format, or the fixed sentence', () => {
    const unpublished = constraints.filter((c) => {
      const property = resolve(
        document.components.schemas[c.schema]?.properties?.[c.property] ?? {},
      ) as Schema & Record<string, unknown>;

      const inCode = ENFORCED_IN_CODE.find(
        (e) => e.schema === c.schema && e.property === c.property,
      );

      return inCode
        ? !descriptionOf(property).includes(inCode.publishedAs)
        : !PUBLISHED[c.kind](property);
    });

    expect(
      unpublished.map((c) => `${c.schema}.${c.property} (${c.kind})`),
    ).toEqual([]);
  });

  it('names the constraints on values these rows cannot send, so they are not mistaken for covered', () => {
    expect(NOT_A_BODY.sort()).toEqual([
      'AnalyticsController.from (StrictIso8601)',
      'AnalyticsController.to (StrictIso8601)',
      'InboundEmail.receivedAt (StrictIso8601)',
      'PlatformController.from (Matches)',
      'PlatformController.to (Matches)',
    ]);
  });

  it('has a sample for every constrained field, so none is silently uncovered', () => {
    expect(
      constraints
        .filter((c) => !sampleFor(c))
        .map((c) => `${c.schema}.${c.property} (${c.kind})`),
    ).toEqual([]);
  });

  it('reaches every constrained field from a route the rows can send', () => {
    const reached = new Set(
      rows.map((r) => `${r.item.schema}.${r.item.property}`),
    );

    expect(
      constraints
        .filter((c) => !reached.has(`${c.schema}.${c.property}`))
        .map((c) => `${c.schema}.${c.property}`),
    ).toEqual([]);
  });
});

describe('a constraint a body field carries beyond its JSON type', () => {
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

  // One row per field and route, each with a LITERAL title, so a row a gateway does not
  // enforce can be named.
  for (const row of rows) {
    rowFor('Ops')(
      `**\`${row.request.method} ${row.request.path}\` refuses a \`${row.item.property}\` that breaks \`@${row.item.kind}\`, before any peer is called**`,
      async () => {
        const sample = sampleFor(row.item)!;
        const { body, target } = bodyWith(row.request.schema, row.path);
        const subject = freshSubject();

        target[row.item.property] = validFor(row.item);
        const accepted = await send(routeOf(row), body, subject);
        if (accepted.asked.length === 0) {
          throw new Error(
            `${keyOf(row)}: the VALID value was itself refused (${accepted.status} ${JSON.stringify(accepted.body)}), so the row would prove nothing`,
          );
        }

        target[row.item.property] = sample.invalid;
        const refused = await send(routeOf(row), body, subject);

        expect(refused.status).toBe(400);
        // Which refusal: this field's. The field name is promised; the wording is not.
        expect(JSON.stringify(refused.body)).toContain(row.item.property);
        expect(refused.asked).toEqual([]);
      },
    );
  }
});
