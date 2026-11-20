import type { OpenAPIObject } from '@nestjs/swagger';

type Schema = Record<string, unknown>;

/**
 * Publishes every optional field of a request body as nullable.
 *
 * The gateway reads an explicit `null` on an optional request field as it reads
 * the field absent (or, on a few, as "clear"), so a client may send either.
 * The DTOs say `?` and nothing more, so without this the document says a
 * client must omit the field, and a generated client refuses the `null` the
 * gateway accepts. Request-body schemas only, the ones a request body reaches
 * through `$ref`s: a response field is nullable only where its DTO says so,
 * and a query parameter can't carry a `null` at all.
 *
 * @example nullableRequestFields(SwaggerModule.createDocument(app, config))
 */
export function nullableRequestFields(document: OpenAPIObject): OpenAPIObject {
  const schemas = (document.components?.schemas ?? {}) as Record<
    string,
    Schema
  >;

  for (const name of requestSchemas(document, schemas)) {
    const schema = schemas[name];
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    const required = new Set((schema.required as string[] | undefined) ?? []);

    for (const [field, property] of Object.entries(properties)) {
      if (required.has(field) || property.nullable === true) continue;
      const { $ref, ...rest } = property;
      properties[field] =
        $ref === undefined
          ? { ...property, nullable: true }
          : // A `$ref` takes no siblings in OpenAPI 3.0, so it moves under
            // `allOf`, as the swagger plugin writes a nullable reference.
            { ...rest, nullable: true, allOf: [{ $ref }] };
    }
  }
  return document;
}

/** Every component schema a request body reaches, directly or nested. */
function requestSchemas(
  document: OpenAPIObject,
  schemas: Record<string, Schema>,
): Set<string> {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const ref = (node as Schema).$ref;
    if (typeof ref === 'string') {
      const name = ref.split('/').at(-1)!;
      if (!found.has(name)) {
        found.add(name);
        visit(schemas[name]);
      }
    }
    Object.values(node).forEach(visit);
  };

  for (const operations of Object.values(document.paths)) {
    for (const operation of Object.values(operations as Schema)) {
      if (operation && typeof operation === 'object') {
        visit((operation as Schema).requestBody);
      }
    }
  }
  return found;
}
