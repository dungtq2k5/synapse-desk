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
import { REPO_ROOT } from './gateway';

type Schema = {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  minLength?: number;
  minimum?: number;
  minItems?: number;
  items?: Schema;
  required?: string[];
  properties?: Record<string, Schema>;
};

type Operation = {
  security?: unknown[];
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

const resolve = (schema: Schema): Schema =>
  schema.$ref
    ? resolve(
        document.components.schemas[schema.$ref.split('/').pop() as string],
      )
    : schema;

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

/** `{id}` and friends filled in: ids as a UUID, anything else (a token) as a plain string. */
export const fillPath = (path: string): string =>
  path.replace(/\{(\w+)\}/gu, (_match, name: string) =>
    /^(id|\w+Id)$/u.test(name) ? ID : 'abc',
  );
