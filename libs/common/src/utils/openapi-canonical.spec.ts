import { canonicalizeEnums } from './openapi-canonical';

describe('canonicalizeEnums', () => {
  it('**sorts every primitive `enum` array, at any depth**', () => {
    const document = {
      components: {
        schemas: {
          NotificationResponseDto: {
            properties: {
              type: { enum: ['ticket.escalated', 'ticket.assigned'] },
              channels: {
                items: { enum: ['sms', 'email', 'in_app'] },
              },
            },
          },
        },
      },
    };

    canonicalizeEnums(document);

    const { properties } = document.components.schemas.NotificationResponseDto;
    expect(properties.type.enum).toEqual([
      'ticket.assigned',
      'ticket.escalated',
    ]);
    expect(properties.channels.items.enum).toEqual(['email', 'in_app', 'sms']);
  });

  it('**never reorders object keys** — SDK generators read them as field order', () => {
    const document = {
      properties: { zeta: { type: 'string' }, alpha: { type: 'string' } },
    };

    canonicalizeEnums(document);

    expect(Object.keys(document.properties)).toEqual(['zeta', 'alpha']);
  });

  it('leaves an `enum` of objects alone, and orders mixed primitives by type then value', () => {
    const objects = { enum: [{ b: 1 }, { a: 1 }] };
    const mixed = { enum: ['b', 10, 'a', 2] };

    canonicalizeEnums(objects);
    canonicalizeEnums(mixed);

    expect(objects.enum).toEqual([{ b: 1 }, { a: 1 }]);
    expect(mixed.enum).toEqual([2, 10, 'a', 'b']);
  });

  it('**the same set in two orders canonicalizes to the same bytes**', () => {
    const one = {
      enum: ['ticket.reassigned', 'ticket.assigned', 'ticket.escalated'],
    };
    const two = {
      enum: ['ticket.escalated', 'ticket.reassigned', 'ticket.assigned'],
    };

    expect(JSON.stringify(canonicalizeEnums(one))).toBe(
      JSON.stringify(canonicalizeEnums(two)),
    );
  });
});
