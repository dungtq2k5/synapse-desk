import type { OpenAPIObject } from '@nestjs/swagger';
import { namedEnvelopes } from './named-envelopes';

describe('namedEnvelopes', () => {
  const wrapper = (data?: Record<string, unknown>) => ({
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean' }, ...(data && { data }) },
  });
  const route = (data?: Record<string, unknown>) => ({
    get: {
      responses: {
        '200': {
          description: '',
          content: { 'application/json': { schema: wrapper(data) } },
        },
      },
    },
  });
  const meta = {
    type: 'object',
    properties: { totalItems: { type: 'number' } },
  };
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const document = (paths: Record<string, unknown>) =>
    ({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths,
      components: { schemas: {} },
    }) as unknown as OpenAPIObject;
  const schemaOf = (doc: OpenAPIObject, path: string) =>
    (
      doc.paths[path].get!.responses['200'] as {
        content: Record<string, { schema: unknown }>;
      }
    ).content['application/json'].schema;

  it('**names each envelope by what its `data` holds**, as the Java gateway does', () => {
    const doc = namedEnvelopes(
      document({
        '/one': route(ref('ThingDto')),
        '/again': route(ref('ThingDto')),
        '/list': route({ type: 'array', items: ref('ThingDto') }),
        '/page': route({
          type: 'object',
          properties: {
            items: { type: 'array', items: ref('ThingDto') },
            meta,
          },
        }),
        '/none': route({ type: 'object', nullable: true, example: null }),
        '/either': route({ oneOf: [ref('ThingDto'), ref('OtherDto')] }),
      }),
    );
    const schemas = doc.components!.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;

    expect(schemaOf(doc, '/one')).toEqual(ref('ApiResponseThingDto'));
    expect(schemaOf(doc, '/again')).toEqual(ref('ApiResponseThingDto'));
    expect(schemaOf(doc, '/list')).toEqual(ref('ApiResponseListThingDto'));
    expect(schemaOf(doc, '/page')).toEqual(ref('ApiResponsePagedDataThingDto'));
    expect(schemas.ApiResponsePagedDataThingDto.properties.data).toEqual(
      ref('PagedDataThingDto'),
    );
    expect(schemas.PagedDataThingDto.properties.meta).toEqual(ref('PageMeta'));
    expect(schemaOf(doc, '/none')).toEqual(ref('ApiResponseVoid'));
    // Stays inline, as on Java.
    expect(schemaOf(doc, '/either')).toMatchObject({
      properties: { success: {} },
    });
  });

  it('**refuses two different schemas under one name**', () => {
    const doc = document({ '/one': route(ref('ThingDto')) });
    (doc.components!.schemas as Record<string, unknown>).ApiResponseThingDto = {
      type: 'string',
    };

    expect(() => namedEnvelopes(doc)).toThrow('ApiResponseThingDto');
  });
});
