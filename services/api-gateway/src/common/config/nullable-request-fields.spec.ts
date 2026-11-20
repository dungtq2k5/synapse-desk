import type { OpenAPIObject } from '@nestjs/swagger';
import { nullableRequestFields } from './nullable-request-fields';

describe('nullableRequestFields', () => {
  const document = () =>
    ({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/things': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateThingDto' },
                },
              },
            },
            responses: {
              '200': {
                description: '',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ThingResponseDto' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          CreateThingDto: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              note: { type: 'string', description: 'Free text.' },
              part: { $ref: '#/components/schemas/PartDto' },
            },
          },
          PartDto: {
            type: 'object',
            properties: { size: { type: 'number' } },
          },
          ThingResponseDto: {
            type: 'object',
            properties: { note: { type: 'string' } },
          },
        },
      },
    }) as unknown as OpenAPIObject;

  it('**publishes optional request fields nullable, nested ones too**; required and response fields stay', () => {
    const schemas = nullableRequestFields(document()).components!
      .schemas as Record<string, { properties: Record<string, unknown> }>;

    expect(schemas.CreateThingDto.properties).toEqual({
      name: { type: 'string' },
      note: { type: 'string', description: 'Free text.', nullable: true },
      part: {
        nullable: true,
        allOf: [{ $ref: '#/components/schemas/PartDto' }],
      },
    });
    expect(schemas.PartDto.properties.size).toEqual({
      type: 'number',
      nullable: true,
    });
    expect(schemas.ThingResponseDto.properties.note).toEqual({
      type: 'string',
    });
  });
});
