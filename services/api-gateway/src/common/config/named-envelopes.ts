import type { OpenAPIObject } from '@nestjs/swagger';

type Schema = Record<string, unknown>;

/**
 * Names every success envelope as a component, `ApiResponse` followed by what
 * its `data` holds, and replaces the inline schema with a `$ref` to it:
 *
 * | `data` | Component |
 * | :--- | :--- |
 * | `X` | `ApiResponseX` |
 * | an array of `X` | `ApiResponseListX` |
 * | a page of `X` | `ApiResponsePagedDataX`, its `data` `PagedDataX` and the page's `meta` `PageMeta` |
 * | nothing | `ApiResponseVoid` |
 *
 * A generated client then has one type per envelope, with a stable name, where
 * an inline schema gets a name per operation. These are the names the Java
 * gateway's document uses. An envelope whose `data` is anything else (the
 * sign-in `oneOf`) stays inline.
 *
 * @throws Error when two different schemas would take one name.
 * @example namedEnvelopes(SwaggerModule.createDocument(app, config))
 */
export function namedEnvelopes(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  const schemas = document.components.schemas as Record<string, Schema>;

  const register = (name: string, schema: Schema): Schema => {
    const existing = schemas[name];
    if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) {
      throw new Error(`Two different schemas would both be named ${name}`);
    }
    schemas[name] = schema;
    return { $ref: `#/components/schemas/${name}` };
  };

  for (const operations of Object.values(document.paths)) {
    for (const operation of Object.values(operations as Schema)) {
      const responses = (operation as Schema | undefined)?.responses as
        Record<string, Schema> | undefined;
      for (const [status, response] of Object.entries(responses ?? {})) {
        if (!status.startsWith('2')) continue;
        const media = (
          response.content as Record<string, Schema> | undefined
        )?.['application/json'];
        const envelope = media?.schema as Schema | undefined;
        const properties = envelope?.properties as
          Record<string, Schema> | undefined;
        if (!media || !properties?.success) continue;

        const name = dataName(properties, register);
        if (name) media.schema = register(`ApiResponse${name}`, envelope!);
      }
    }
  }
  return document;
}

/**
 * The name of what an envelope's `data` holds, or `undefined` for a shape that
 * stays inline. A page's `data` is named, and replaced with its `$ref`, here.
 */
function dataName(
  properties: Record<string, Schema>,
  register: (name: string, schema: Schema) => Schema,
): string | undefined {
  const data = properties.data;
  if (!data) return undefined;

  const ref = refName(data);
  if (ref) return ref;

  if (data.type === 'array') {
    const item = refName(data.items as Schema | undefined);
    return item && `List${item}`;
  }

  const page = data.properties as Record<string, Schema> | undefined;
  const item = refName((page?.items?.items as Schema | undefined) ?? undefined);
  if (item && page?.meta) {
    page.meta = register('PageMeta', page.meta);
    properties.data = register(`PagedData${item}`, data);
    return `PagedData${item}`;
  }

  if (data.nullable === true && data.example === null && !data.properties) {
    return 'Void';
  }
  return undefined;
}

function refName(schema: Schema | undefined): string | undefined {
  const ref = schema?.$ref;
  return typeof ref === 'string' ? ref.split('/').at(-1) : undefined;
}
