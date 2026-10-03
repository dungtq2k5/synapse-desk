/**
 * @file **Constraints Node enforces that the published document does not describe.**
 *
 * Node validates request fields with `class-validator` decorators, and the document
 * expresses only some of them (a `format`, a bound, an enum). A password's strength, a
 * phone number's shape, an OTP's digits, a date's ISO form, a slug's pattern are
 * enforced by Node and published nowhere, so a gateway implemented from the document
 * has none of them, and a client generated from it never learns they exist. Nothing
 * behind the gateway checks either: auth-service validates no password or phone.
 *
 * **Found from the SOURCE, not the document.** A scan from the document outward finds
 * only the constraints it already has, which is the set that is empty here. The DTO
 * sources are scanned (`validator-scan.ts`, held to a hostile fixture and a floor), and
 * every decorator whose constraint the schema does not carry becomes a row: the field
 * set to a value that breaks it must be refused, with 400, naming the field, before any
 * peer is called. Each row first requires the SAME request with a VALID value to reach
 * the peer, so a refusal for another reason cannot satisfy it.
 *
 * **A stated limit.** A row pins the FIELD, not the validator: it requires the refusal to
 * name the field, and each invalid sample is chosen to break only the validator under
 * test, but nothing checks that mechanically, so a sample that broke two at once would
 * still pass. The mechanical fix, asserting the refusal's message mentions the
 * constraint, is not available: that wording is class-validator's on one side and the
 * Java gateway's on the other, and the parity rule holds two implementations equal only
 * on text this repository writes. Careful samples and this note are the trade.
 *
 * **Throttling.** An authenticated caller is throttled per user and the export routes
 * allow 5 a minute, so every row acts as its own fresh subject ({@link freshSubject}).
 * A PUBLIC route is throttled per address, which a row cannot vary: its rows send two
 * requests each and rely on the suite not spending that budget elsewhere.
 *
 * Porting a constraint closes the behaviour gap; PUBLISHING it closes the document
 * gap. They are separate changes, and this file holds only the first: when a row goes
 * green the document may still describe nothing.
 */

import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  bodySender,
  bodyWith,
  freshSubject,
  hasSchema,
  jsonRequests,
  pathsTo,
  schemaProperty,
} from './request-bodies';
import { readRunState } from './run-state';
import { scanDtoDirectory } from './validator-scan';
import { join } from 'node:path';
import { REPO_ROOT } from './gateway';

type Sample = { valid: string; invalid: string };

const ISO_VALID = '2026-01-01T00:00:00.000Z';

/** A value that satisfies the constraint and one that breaks it, by validator. */
const KINDS: Record<string, { sample: Sample; expressedBy?: string[] }> = {
  IsStrongPassword: { sample: { valid: 'Str0ng!Passw0rd', invalid: 'weak' } },
  IsPhoneNumber: { sample: { valid: '+14155552671', invalid: 'abc' } },
  // A code carries a length range too (4 to 10), so the bad value is the right length.
  IsNumberString: {
    sample: { valid: '123456', invalid: 'abcdef' },
    expressedBy: ['pattern'],
  },
  IsFutureDate: {
    sample: {
      valid: '2999-01-01T00:00:00.000Z',
      invalid: '2000-01-01T00:00:00.000Z',
    },
  },
  IsISO8601: {
    sample: { valid: ISO_VALID, invalid: 'not-a-date' },
    expressedBy: ['format'],
  },
  IsDate: {
    sample: { valid: ISO_VALID, invalid: 'not-a-date' },
    expressedBy: ['format'],
  },
  Matches: { sample: { valid: '', invalid: '' }, expressedBy: ['pattern'] },
};

/** `@Matches` carries a different pattern on each field, so its samples are per field. */
const MATCHES: Record<string, Sample> = {
  slug: { valid: 'acme-co', invalid: 'Bad Slug!' },
  domain: { valid: 'acme.com', invalid: 'not a domain!' },
  stripePriceId: { valid: 'price_123', invalid: 'bad id!' },
  stripeProductId: { valid: 'prod_123', invalid: 'bad id!' },
};

type Unpublished = { schema: string; property: string; kind: string };

type Found = Unpublished & { role: 'body' | 'response' | 'other' };

const requests = jsonRequests();
const reachedFromARequest = (schema: string) =>
  requests.some((request) => pathsTo(request.schema, schema).length > 0);

/**
 * Every decorated property whose constraint the published schema does not carry, and
 * what its class is: a request BODY (reachable from a request), a RESPONSE (a schema no
 * request reaches, whose validators nothing runs), or OTHER (no component schema at
 * all: a query-string DTO or the inbound-mail DTO, whose fields these rows do not send).
 */
const found: Found[] = scanDtoDirectory(
  join(REPO_ROOT, 'apps/api-gateway/src/modules'),
).flatMap((dto) =>
  dto.properties.flatMap((property) =>
    property.decorators
      .filter((decorator) => decorator in KINDS)
      .filter((decorator) => {
        const published = schemaProperty(dto.name, property.name);
        const keywords = KINDS[decorator].expressedBy ?? [];

        return !(published && keywords.some((keyword) => keyword in published));
      })
      .map((kind) => ({
        schema: dto.name,
        property: property.name,
        kind,
        role: reachedFromARequest(dto.name)
          ? 'body'
          : hasSchema(dto.name)
            ? 'response'
            : 'other',
      })),
  ),
);
const unpublished = found.filter((item) => item.role === 'body');

/**
 * Unpublished validators on fields these rows CANNOT send, named so they are not
 * mistaken for covered: query-string DTOs (`from`/`to` ranges) and the inbound-mail
 * DTO. They are part of the same gap and need rows of their own.
 */
const NOT_A_BODY = found
  .filter((item) => item.role === 'other')
  .map((item) => `${item.schema}.${item.property} (${item.kind})`);

const sampleFor = (item: Unpublished): Sample | undefined =>
  item.kind === 'Matches' ? MATCHES[item.property] : KINDS[item.kind].sample;

/**
 * A value that satisfies EVERY validator on the field, not only the one a row breaks:
 * `lockedUntil` is an ISO date AND in the future, so a past date is refused for the
 * second reason and would make the first row prove nothing. The most restrictive
 * validator wins.
 */
const MOST_RESTRICTIVE = [
  'IsFutureDate',
  'IsStrongPassword',
  'IsPhoneNumber',
  'IsNumberString',
  'Matches',
  'IsISO8601',
  'IsDate',
];
const validFor = (item: Unpublished): string => {
  const kinds = unpublished
    .filter((u) => u.schema === item.schema && u.property === item.property)
    .map((u) => u.kind);
  const strongest =
    MOST_RESTRICTIVE.find((kind) => kinds.includes(kind)) ?? item.kind;

  return sampleFor({ ...item, kind: strongest })!.valid;
};

type Row = {
  request: ReturnType<typeof jsonRequests>[number];
  path: (string | number)[];
  item: Unpublished;
};

const rows: Row[] = unpublished.flatMap((item) =>
  requests.flatMap((request) =>
    pathsTo(request.schema, item.schema).map((path) => ({
      request,
      path,
      item,
    })),
  ),
);

/**
 * Measured on Java when these rows were written: the fields whose constraint the Java
 * gateway does not yet enforce. A field leaves this set in the commit that ports it.
 */
const NOT_YET_ENFORCED = new Set<string>([
  'PATCH /api/v1/auth/password newPassword IsStrongPassword',
  'PATCH /api/v1/organizations/current domain Matches',
  'PATCH /api/v1/organizations/current slug Matches',
  'PATCH /api/v1/platform/plans/{id} stripeProductId Matches',
  'PATCH /api/v1/users/me dob IsISO8601',
  'PATCH /api/v1/users/{id} dob IsISO8601',
  'PATCH /api/v1/users/{id} phoneNumber IsPhoneNumber',
  'POST /api/v1/analytics/export from IsISO8601',
  'POST /api/v1/analytics/export to IsISO8601',
  'POST /api/v1/auth/email/verify code IsNumberString',
  'POST /api/v1/auth/password/reset newPassword IsStrongPassword',
  'POST /api/v1/auth/phone/verify code IsNumberString',
  'POST /api/v1/auth/phone/verify/request phoneNumber IsPhoneNumber',
  'POST /api/v1/auth/register password IsStrongPassword',
  'POST /api/v1/platform/plans stripePriceId Matches',
  'POST /api/v1/platform/plans stripeProductId Matches',
  'POST /api/v1/users/{id}/lock lockedUntil IsFutureDate',
  'POST /api/v1/users/{id}/lock lockedUntil IsISO8601',
]);

const keyOf = (row: Row) =>
  `${row.request.method} ${row.request.path} ${row.item.property} ${row.item.kind}`;

describe('the scan itself', () => {
  it('finds at least the 22 fields measured when this was written, across at least 6 kinds', () => {
    // A result of 19 is a finding about the scan, not a tidier number.
    const fields = new Set(unpublished.map((u) => `${u.schema}.${u.property}`));
    const kinds = new Set(unpublished.map((u) => u.kind));

    expect(fields.size).toBeGreaterThanOrEqual(22);
    expect(kinds.size).toBeGreaterThanOrEqual(6);
  });

  it('names the unpublished validators on fields these rows cannot send, so they are not mistaken for covered', () => {
    // Query-string and inbound-mail DTOs. Each is a real instance of the same gap.
    expect(NOT_A_BODY.length).toBeGreaterThan(0);
    expect(NOT_A_BODY.sort()).toEqual([
      'AnalyticsRangeQueryDto.from (IsISO8601)',
      'AnalyticsRangeQueryDto.to (IsISO8601)',
      'FinanceEventsQueryDto.from (Matches)',
      'FinanceEventsQueryDto.to (Matches)',
      'InboundEmailDto.messageId (Matches)',
      'InboundEmailDto.receivedAt (IsISO8601)',
    ]);
  });

  it('has a sample for every unpublished field, so none is silently uncovered', () => {
    expect(
      unpublished
        .filter((u) => !sampleFor(u))
        .map((u) => `${u.schema}.${u.property} (${u.kind})`),
    ).toEqual([]);
  });

  it('reaches every unpublished field from a route the rows can send', () => {
    const reached = new Set(
      rows.map((r) => `${r.item.schema}.${r.item.property}`),
    );

    expect(
      unpublished
        .filter((u) => !reached.has(`${u.schema}.${u.property}`))
        .map((u) => `${u.schema}.${u.property}`),
    ).toEqual([]);
  });
});

describe('a constraint the document does not publish', () => {
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

  // One row per field and route, each with a LITERAL title, so `SKIPPED_FOR_JAVA` can name
  // the ones Java does not enforce yet by their suffix.
  for (const row of rows) {
    const pending = NOT_YET_ENFORCED.has(keyOf(row));
    rowFor('Ops')(
      `**\`${row.request.method} ${row.request.path}\` refuses a \`${row.item.property}\` that breaks \`@${row.item.kind}\`, before any peer is called**${pending ? ' (Java does not enforce this yet)' : ''}`,
      async () => {
        const sample = sampleFor(row.item)!;
        const { body, target } = bodyWith(row.request.schema, row.path);
        const subject = freshSubject();

        target[row.item.property] = validFor(row.item);
        const accepted = await send(row.request, body, subject);
        if (accepted.asked.length === 0) {
          throw new Error(
            `${keyOf(row)}: the VALID value was itself refused (${accepted.status} ${JSON.stringify(accepted.body)}), so the row would prove nothing`,
          );
        }

        target[row.item.property] = sample.invalid;
        const refused = await send(row.request, body, subject);

        expect(refused.status).toBe(400);
        // Which refusal: this field's. The field name is promised; the wording is not.
        expect(JSON.stringify(refused.body)).toContain(row.item.property);
        expect(refused.asked).toEqual([]);
      },
    );
  }
});
