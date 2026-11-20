/**
 * @file **An explicit `null` for an OPTIONAL request field**, on every JSON route.
 *
 * Refused, unless the field says what `null` means. A `null` is ambiguous ("clear
 * it", or "leave it"), and a gateway that guesses gets one of them silently wrong:
 * the client clears a value, the request succeeds, and nothing changed. So every
 * optional field answers a `null` with a 400 naming the field ("`<field>` can't be
 * null; leave it out instead"), before asking any peer, except the few that
 * declare a meaning for it.
 *
 * **Two kinds of row.** The refusal is a RULE, so one generated row per field holds
 * it. A meaning is a per-field contract, so each has its own row naming what the
 * peer must be asked.
 *
 * **Generated from the document.** The minimal valid body comes from
 * `request-bodies.ts`, so a new optional field gets a row without anyone remembering.
 * Each row first requires the BASELINE (field absent) to be accepted and to reach the
 * peer: otherwise the 400 could be for some other reason.
 */

import { type Gateway, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  bodySender,
  freshSubject,
  jsonRequests,
  minimalValue,
  optionalPaths,
  setAt,
} from './request-bodies';
import { readRunState } from './run-state';

/**
 * Fields where Node gives an explicit `null` a MEANING of its own, with what the
 * peer must then be asked. Each is measured on Node; none is derived.
 */
const MEANINGS: Record<
  string,
  { reason: string; asks: Record<string, unknown> }
> = {
  'PATCH /api/v1/users/me dob': {
    reason: 'clears the date of birth',
    asks: { dob: '' },
  },
  'PATCH /api/v1/users/me gender': {
    reason: 'clears the gender',
    asks: { gender: 0 },
  },
  'PATCH /api/v1/users/{id} dob': {
    reason: 'clears the date of birth',
    asks: { dob: '' },
  },
  'PATCH /api/v1/users/{id} phoneNumber': {
    reason: 'clears the phone number',
    asks: { phoneNumber: '' },
  },
  'PATCH /api/v1/users/{id} gender': {
    reason: 'clears the gender',
    asks: { gender: 0 },
  },
  'PATCH /api/v1/organizations/current/settings allowedEmailDomains': {
    reason: 'replaces the allowed domains with none',
    asks: { replaceAllowedEmailDomains: true },
  },
  'PATCH /api/v1/organizations/current/settings maxDocumentBytesOverride': {
    reason: 'clears the override',
    asks: { clearMaxDocumentBytesOverride: true },
  },
  'PATCH /api/v1/organizations/current/settings maxAttachmentBytesOverride': {
    reason: 'clears the override',
    asks: { clearMaxAttachmentBytesOverride: true },
  },
  'PATCH /api/v1/organizations/current/settings maxAttachmentsPerMessageOverride':
    {
      reason: 'clears the override',
      asks: { clearMaxAttachmentsPerMessageOverride: true },
    },
};

/**
 * Routes this arrangement cannot reach the peer on, by operation, with why. Named,
 * never dropped: a route here is one the rows do NOT cover.
 */
const UNREACHABLE: Record<string, string> = {
  'POST /api/v1/auth/2fa/authenticate':
    'needs the 2FA-pending cookie, which this identity does not carry',
  'POST /api/v1/auth/login/tenant':
    'needs the tenant-selection token a successful first login hands back',
  'POST /api/v1/auth/logout':
    'asks its peer only when a refresh cookie is present, and answers 200 without it',
  'POST /api/v1/client-errors':
    'has no peer: it writes a log line (client-errors.contract-spec.ts covers it)',
};

type Field = {
  method: string;
  path: string;
  field: (string | number)[];
  key: string;
  public: boolean;
};

const fields: Field[] = jsonRequests().flatMap((request) =>
  optionalPaths(request.schema).map((field) => ({
    method: request.method,
    path: request.path,
    field,
    key: `${request.method} ${request.path} ${field.join('.')}`,
    public: request.public,
  })),
);
const requests = new Map(
  jsonRequests().map((r) => [`${r.method} ${r.path}`, r]),
);

describe('an explicit null for an optional request field', () => {
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

  /** What one request did: its status, its error body, and every request it made of a peer. */
  const send = async (field: Field, body: unknown, subject: string) => {
    const outcome = await sender(field, body, subject);

    return {
      status: outcome.status,
      asked: outcome.asked,
      error: outcome.body,
    };
  };

  const bodies = (field: Field) => {
    const request = requests.get(`${field.method} ${field.path}`)!;
    const absent = minimalValue(request.schema);
    const withNull = JSON.parse(JSON.stringify(absent)) as unknown;
    setAt(withNull, field.field, null);

    return { absent, withNull };
  };

  const isGeneric = (field: Field) =>
    !(field.key in MEANINGS) &&
    !(`${field.method} ${field.path}` in UNREACHABLE);

  rowFor('Ops').each(fields.filter(isGeneric).map((f) => [f.key] as const))(
    '**`%s` refuses an explicit `null` with a 400 naming the field, before asking any peer**',
    async (key) => {
      const field = fields.find((f) => f.key === key)!;
      const { absent, withNull } = bodies(field);

      const subject = freshSubject();

      const before = await send(field, absent, subject);
      // The baseline is accepted, or the 400 below could be for another reason.
      if (before.asked.length === 0) {
        throw new Error(
          `${key}: the baseline (field absent) never reached the peer: ${before.status} ${JSON.stringify(before.error)}`,
        );
      }

      const after = await send(field, withNull, subject);

      expect(after.status).toBe(400);
      expect(after.asked).toEqual([]);
      expect(JSON.stringify(after.error)).toContain(
        `${field.field.join('.')} can't be null; leave it out instead`,
      );
    },
  );

  // One row per field, each with a LITERAL title, so a failure names the field.
  for (const [key, meaning] of Object.entries(MEANINGS)) {
    rowFor('Ops')(
      `**\`${key}\`: an explicit \`null\` ${meaning.reason}, and the peer is asked for exactly that**`,
      async () => {
        const field = fields.find((f) => f.key === key)!;
        const { absent, withNull } = bodies(field);

        const subject = freshSubject();

        const before = await send(field, absent, subject);
        expect(before.asked.length).toBeGreaterThan(0);

        const after = await send(field, withNull, subject);

        expect(after.asked.length).toBeGreaterThan(0);
        expect(after.asked[0].request).toMatchObject(meaning.asks);
        // And it is not what leaving the field out asks, or the row proves nothing.
        expect(after.asked[0].request).not.toEqual(before.asked[0].request);
      },
    );
  }
});
