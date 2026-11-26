import { enumBridge } from './enum-bridge';

describe('enumBridge', () => {
  const bridge = enumBridge<'OPEN' | 'CLOSED', number>(
    { OPEN: 1, CLOSED: 2 },
    0,
  );

  it('**maps a known value**', () => {
    expect(bridge.toProto('CLOSED')).toBe(2);
  });

  it('**throws on an unknown value, naming it and the allowed set**', () => {
    expect(() => bridge.toProto('ARCHIVED')).toThrow(
      '"ARCHIVED" is not one of OPEN, CLOSED',
    );
  });

  it('**an object key is not a value**', () => {
    expect(() => bridge.toProto('constructor')).toThrow(
      '"constructor" is not one of OPEN, CLOSED',
    );
  });

  it('**no value is the zero value**', () => {
    expect(bridge.toProto(null)).toBe(0);
    expect(bridge.toProto(undefined)).toBe(0);
    expect(bridge.toProto('')).toBe(0);
  });
});
