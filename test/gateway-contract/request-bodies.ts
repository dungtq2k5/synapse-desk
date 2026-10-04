/**
 * @file Minimal VALID request bodies, generated from the committed document.
 *
 * A row that wants to vary one field of a request needs a request that is
 * otherwise accepted, and writing 88 of those by hand is how a list drifts from the
 * contract it describes. This builds each from the document's own schema: only the
 * required properties, each the smallest value the schema allows. Anything the
 * document does not publish (a phone format, a password policy) is not in it, which
 * is the point of asking the gateway whether the body was accepted.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, REPO_ROOT } from './gateway';
import { type Peers, TEST_KEYS } from './peers';

export type Schema = {
  $ref?: string;
  /** OpenAPI 3.1 writes an optional field as `["string", "null"]`. */
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  minLength?: number;
  minimum?: number;
  minItems?: number;
  items?: Schema;
  oneOf?: Schema[];
  required?: string[];
  properties?: Record<string, Schema>;
};

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
};

type Operation = {
  security?: Record<string, unknown>[];
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
};

const document = JSON.parse(
  readFileSync(join(REPO_ROOT, 'docs/reference/openapi.json'), 'utf8'),
) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

export const ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/** Every permission the published contract lists, so a row is never refused for lacking one. */
export const PERMISSION_CODES = (document.components.schemas
  .CurrentUserResponseDto.properties?.permissionCodes?.items?.enum ??
  []) as string[];

/**
 * The schema a value must match, with any `$ref` followed and `null` set aside.
 *
 * OpenAPI 3.1 writes an optional field as `type: ["string", "null"]`, or as a `oneOf`
 * with a `null` branch around a `$ref`. Every generator here asks what the NON-null
 * value is (a string? an array to walk into?), so this answers that once, for all of
 * them, rather than each reading `type` as a single string and quietly skipping the
 * field.
 *
 * @example resolve({ type: ['array', 'null'], items }) // { type: 'array', items }
 */
export const resolve = (schema: Schema): Schema => {
  if (schema.$ref) {
    return resolve(
      document.components.schemas[schema.$ref.split('/').pop() as string],
    );
  }
  const branches = schema.oneOf?.filter((branch) => branch.type !== 'null');
  if (branches?.length === 1 && branches.length < schema.oneOf!.length) {
    return resolve({ ...schema, oneOf: undefined, ...branches[0] });
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== 'null');
    return { ...schema, type: types.length === 1 ? types[0] : types };
  }

  return schema;
};

/** The smallest valid value for a schema: required properties only. */
export function minimalValue(raw: Schema, name = ''): unknown {
  const schema = resolve(raw);
  if (schema.enum) return schema.enum[0];

  switch (schema.type) {
    case 'string':
      if (schema.format === 'uuid') return ID;
      if (schema.format === 'date-time') return '2026-01-01T00:00:00.000Z';
      if (schema.format === 'uri') return 'https://example.com/hook';

      // The document types these as bare strings; the gateway reads them as more.
      if (/email/iu.test(name)) return 'a@example.com';
      if (name === 'from') return '2026-01-01';
      if (name === 'to') return '2026-01-31';

      return 'x'.repeat(Math.max(1, schema.minLength ?? 1));
    case 'number':
    case 'integer':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    case 'array':
      return Array.from({ length: Math.max(1, schema.minItems ?? 0) }, () =>
        minimalValue(schema.items ?? {}, name),
      );
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const key of schema.required ?? []) {
        out[key] = minimalValue(schema.properties?.[key] ?? {}, key);
      }

      return out;
    }
    default:
      return 'x';
  }
}

export type KeyPath = (string | number)[];

/** Every OPTIONAL property that exists inside the required structure of a body, as a key path. */
export function optionalPaths(raw: Schema, prefix: KeyPath = []): KeyPath[] {
  const schema = resolve(raw);
  const found: KeyPath[] = [];

  if (schema.type === 'object') {
    const required = new Set<string>(schema.required ?? []);
    for (const [key, value] of Object.entries<Schema>(
      schema.properties ?? {},
    )) {
      if (required.has(key))
        found.push(...optionalPaths(value, [...prefix, key]));
      else found.push([...prefix, key]);
    }
  } else if (schema.type === 'array') {
    found.push(...optionalPaths(schema.items ?? {}, [...prefix, 0]));
  }

  return found;
}

export function setAt(body: unknown, path: KeyPath, value: unknown): void {
  let current = body as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    current = current[key] as Record<string | number, unknown>;
  }
  current[path[path.length - 1]] = value;
}

/** `public` when the document says the route needs no session (`security: []`). */
export type JsonRequest = {
  method: string;
  path: string;
  schema: Schema;
  public: boolean;
};

/** Every operation whose request body is JSON, in document order. */
export function jsonRequests(): JsonRequest[] {
  const found: JsonRequest[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const schema =
        operation.requestBody?.content?.['application/json']?.schema;
      if (schema) {
        found.push({
          method: method.toUpperCase(),
          path,
          schema,
          public:
            Array.isArray(operation.security) &&
            operation.security.length === 0,
        });
      }
    }
  }

  return found;
}

/** Whether the document has a component schema with this name. */
export const hasSchema = (name: string): boolean =>
  name in document.components.schemas;

/** `{id}` and friends filled in: ids as a UUID, anything else (a token) as a plain string. */
export const fillPath = (path: string): string =>
  path.replace(/\{(\w+)\}/gu, (_match, name: string) => {
    if (/^(id|\w+Id)$/u.test(name)) return ID;
    // The document types a few path variables as numbers (a ticket number).
    if (/number$/iu.test(name)) return '1';

    return 'abc';
  });

/** The object at `path` inside a body. */
export function getAt(body: unknown, path: KeyPath): Record<string, unknown> {
  let current = body as Record<string | number, unknown>;
  for (const key of path)
    current = current[key] as Record<string | number, unknown>;

  return current;
}

/**
 * Where, inside a request body, an object of the schema named `target` sits, through
 * properties (required or not) and array items. A path through an OPTIONAL property
 * needs its containers created first: see {@link bodyWith}.
 */
export function pathsTo(
  raw: Schema,
  target: string,
  prefix: KeyPath = [],
  depth = 0,
): KeyPath[] {
  if (depth > 6) return [];
  if (raw.$ref?.split('/').pop() === target) return [prefix];

  const schema = resolve(raw);
  const found: KeyPath[] = [];
  if (schema.type === 'object') {
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      found.push(...pathsTo(value, target, [...prefix, key], depth + 1));
    }
  } else if (schema.type === 'array') {
    found.push(
      ...pathsTo(schema.items ?? {}, target, [...prefix, 0], depth + 1),
    );
  }

  return found;
}

/**
 * A minimal body for `schema` with every container on `path` present, and the object
 * at the end of the path. A property the minimal body leaves out (because it is
 * optional) is added, built from its own schema, so a field nested inside one can be set.
 */
export function bodyWith(
  schema: Schema,
  path: KeyPath,
): { body: unknown; target: Record<string, unknown> } {
  const body = minimalValue(schema);
  let current = body as Record<string | number, unknown>;
  let here = resolve(schema);

  for (const key of path) {
    const child = typeof key === 'number' ? here.items : here.properties?.[key];
    if (current[key] === undefined) current[key] = minimalValue(child ?? {});
    current = current[key] as Record<string | number, unknown>;
    here = resolve(child ?? {});
  }

  return { body, target: current };
}

const ORGANIZATION = 'a0490000-0000-4000-8000-000000000049';

/** What one request did: its status, its error body, and every request it made of a peer. */
export type Outcome = {
  status: number;
  body: unknown;
  asked: { method: string; request: Record<string, unknown> }[];
};

/**
 * Sends a request body as a caller who may do anything the contract lets anyone do
 * (a super admin for `/platform/` routes, none for a public route, which refuses a
 * caller already signed in), against a gateway whose organization is ACTIVE, and
 * reports what the peers were then asked.
 */
export function bodySender(gateway: () => Gateway, peers: () => Peers) {
  const cookie = (superAdmin: boolean, subject: string, verified = true) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: subject,
        organizationId: superAdmin ? null : ORGANIZATION,
        isSuperAdmin: superAdmin,
        departmentIds: [],
        permissionCodes: PERMISSION_CODES,
        isEmailVerified: verified,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
    'idempotency-key': 'body-rows',
  });

  return async (
    request: {
      method: string;
      path: string;
      public: boolean;
      /** Send as a tenant member even to a `/platform/` route, which is otherwise a super admin. */
      member?: boolean;
      /** Send with an email address that is not verified. */
      unverified?: boolean;
    },
    body: unknown,
    subject: string = ID,
  ): Promise<Outcome> => {
    const fakes = peers();
    fakes.reset();
    fakes.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
    const response = await new Session(gateway().baseUrl).request(
      request.method,
      fillPath(request.path),
      {
        body,
        headers: request.public
          ? {}
          : cookie(
              request.path.includes('/platform/') && !request.member,
              subject,
              !request.unverified,
            ),
      },
    );
    const asked = [
      fakes.auth,
      fakes.ticket,
      fakes.ingestion,
      fakes.rag,
      fakes.notification,
    ]
      .flatMap((peer) => peer.calls())
      .filter(
        (call) =>
          !call.method.endsWith('JobHealth') &&
          !call.method.endsWith('GetOrganizationStatus'),
      )
      .map((call) => ({ method: call.method, request: call.request }));

    return { status: response.status, body: response.body, asked };
  };
}

/**
 * A caller no other row has been: the throttler counts an authenticated caller per
 * USER (a public route, per address, which a row cannot vary), and the export routes
 * allow 5 a minute, so rows that share one identity are refused with 429 as soon as
 * another suite has used the budget. A row takes one subject and uses it for BOTH of
 * its requests, so what a peer is asked can still be compared.
 */
export const freshSubject = (): string => randomUUID();

/** Every operation in the document, with what it needs to be called validly. */
export type AnyOperation = {
  method: string;
  path: string;
  /** The JSON body schema, when the route takes one. */
  body: Schema | undefined;
  /** The security the document declares: `undefined` when it says nothing, `[]` when public. */
  security: string[] | undefined;
  /** The query string that satisfies every REQUIRED query parameter. */
  query: string;
};

const QUERY_VALUE: Record<string, string> = {
  from: '2026-01-01',
  to: '2026-01-31',
};

export function allOperations(): AnyOperation[] {
  const found: AnyOperation[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const required = (operation.parameters ?? []).filter(
        (parameter) => parameter.in === 'query' && parameter.required,
      );
      found.push({
        method: method.toUpperCase(),
        path,
        body: operation.requestBody?.content?.['application/json']?.schema,
        security: operation.security?.flatMap((entry) => Object.keys(entry)),
        query: required
          .map((parameter) => {
            const first = parameter.schema?.enum?.[0];

            return `${parameter.name}=${
              typeof first === 'string'
                ? first
                : (QUERY_VALUE[parameter.name] ?? 'x')
            }`;
          })
          .join('&'),
      });
    }
  }

  return found;
}
