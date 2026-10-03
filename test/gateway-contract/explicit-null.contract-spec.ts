/**
 * @file **An explicit `null` for an OPTIONAL request field**, on every JSON route.
 *
 * Measured on Node: of the optional fields a minimal request can reach, `null` is
 * accepted on all but two (those two are Node's own 500s, listed below). It means
 * ABSENT on most and a specific instruction on eleven. A document that says
 * "optional, not nullable" understates this, and a gateway that answers 500 to a
 * `null` the other one accepts breaks a client that serialises its model with
 * explicit nulls, which is common.
 *
 * **Two kinds of row, because the two kinds of answer are different contracts.**
 * "`null` is the same as absent" is a RULE, so one generated row per field holds it:
 * the request, and what the gateway then asks its peer, must be identical with the
 * field absent and with it `null`. "`null` means clear this value" is a per-field
 * contract that only an explicit row can hold, and a gateway that reads it as absent
 * fails SILENTLY (the client clears a date of birth and nothing happens), so each of
 * those eleven has its own row naming what the peer must be asked.
 *
 * **Generated from the document.** The minimal valid body comes from
 * `request-bodies.ts`, so a new optional field gets a row without anyone remembering.
 * Each row first requires the BASELINE (field absent) to be accepted and to reach the
 * peer: otherwise it would compare two refusals and pass.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { rowFor } from './pending';
import {
  fillPath,
  ID,
  jsonRequests,
  minimalValue,
  optionalPaths,
  PERMISSION_CODES,
  setAt,
} from './request-bodies';
import { readRunState } from './run-state';

const ORGANIZATION = 'a0490000-0000-4000-8000-000000000049';

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
  'POST /api/v1/documents/confirm isOrganizationWide': {
    reason: 'is false, not the default of true',
    asks: { isOrganizationWide: false },
  },
  'POST /api/v1/platform/plans isActive': {
    reason: 'is false, not the default of true',
    asks: { isActive: false },
  },
  'PATCH /api/v1/platform/plans/{id} aiModelTier': {
    reason: 'clears the tier',
    asks: { aiModelTier: 0 },
  },
};

/**
 * Node answers 500 to an explicit `null` here. A defect, not a behaviour to keep: the
 * Java gateway accepts it as absent, and these die with Node.
 */
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
};

const NODE_REJECTS = new Set([
  'PATCH /api/v1/webhook-endpoints/{id} eventTypes',
  'POST /api/v1/platform/plans prices',
]);

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

  const cookie = (superAdmin: boolean) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: ID,
        organizationId: superAdmin ? null : ORGANIZATION,
        isSuperAdmin: superAdmin,
        departmentIds: [],
        permissionCodes: PERMISSION_CODES,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
    'idempotency-key': 'null-rows',
  });

  /** What one request did: its status, and every request it made of a peer. */
  const send = async (field: Field, body: unknown) => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
    const response = await new Session(gateway.baseUrl).request(
      field.method,
      fillPath(field.path),
      {
        body,
        // A public route refuses a caller who is already signed in.
        headers: field.public ? {} : cookie(field.path.includes('/platform/')),
      },
    );
    const asked = [
      peers.auth,
      peers.ticket,
      peers.ingestion,
      peers.rag,
      peers.notification,
    ]
      .flatMap((peer) => peer.calls())
      .filter(
        (call) =>
          !call.method.endsWith('JobHealth') &&
          !call.method.endsWith('GetOrganizationStatus'),
      )
      .map((call) => ({ method: call.method, request: call.request }));

    return { status: response.status, asked, error: response.body };
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
    !NODE_REJECTS.has(field.key) &&
    !(`${field.method} ${field.path}` in UNREACHABLE);

  rowFor('Ops').each(fields.filter(isGeneric).map((f) => [f.key] as const))(
    '**`%s` treats an explicit `null` as absent: the same status, and the peer is asked the same**',
    async (key) => {
      const field = fields.find((f) => f.key === key)!;
      const { absent, withNull } = bodies(field);

      const before = await send(field, absent);
      // The row compares two ACCEPTED requests, or it would pass on two refusals.
      if (before.asked.length === 0) {
        throw new Error(
          `${key}: the baseline (field absent) never reached the peer: ${before.status} ${JSON.stringify(before.error)}`,
        );
      }

      const after = await send(field, withNull);

      expect({ status: after.status, asked: after.asked }).toEqual({
        status: before.status,
        asked: before.asked,
      });
    },
  );

  // One row per field, each with a LITERAL title: `SKIPPED_FOR_JAVA` matches the
  // title a row is declared with, and a `%s` template would hide which field is skipped.
  for (const [key, meaning] of Object.entries(MEANINGS)) {
    rowFor('Ops')(
      `**\`${key}\`: an explicit \`null\` ${meaning.reason}, and the peer is asked for exactly that**`,
      async () => {
        const field = fields.find((f) => f.key === key)!;
        const { absent, withNull } = bodies(field);

        const before = await send(field, absent);
        expect(before.asked.length).toBeGreaterThan(0);

        const after = await send(field, withNull);

        expect(after.asked.length).toBeGreaterThan(0);
        expect(after.asked[0].request).toMatchObject(meaning.asks);
        // And it is not what leaving the field out asks, or the row proves nothing.
        expect(after.asked[0].request).not.toEqual(before.asked[0].request);
      },
    );
  }
});
