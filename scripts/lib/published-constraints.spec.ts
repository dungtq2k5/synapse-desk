import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The constraints the Java gateway PUBLISHES agree with the ones it ENFORCES.
 *
 * `ConstraintPublishingCustomizer` writes each constraint annotation into the document as
 * a `pattern` (or, where no keyword can say it, a fixed sentence). A pattern string that
 * merely exists proves nothing: this reads the committed document,
 * compiles each published pattern with a real ECMA-262 engine (the dialect JSON Schema
 * patterns are written in), and holds it to the shared validator table, whose answers
 * the Node gateway's spec recomputed from validator.js itself.
 *
 *   - the password and OTP-code patterns must give EXACTLY the library's answer on every
 *     row: they claim to be the rule;
 *   - the ISO 8601 pattern must ACCEPT every date the library accepts: it claims only to
 *     be a necessary condition (a date that does not exist matches it and is refused by
 *     the calendar check after), and must still refuse something, or it says nothing.
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, any>;

const document = read('docs/reference/openapi.json');
const table = read(
  'test/fixtures/inbound-email/validator-parity.json',
) as Record<string, [string, boolean][]>;
const schemas = document.components.schemas as Record<string, any>;

const patternOf = (schema: string, property: string): string => {
  const published = schemas[schema]?.properties?.[property]?.pattern;
  if (typeof published !== 'string') {
    throw new Error(`${schema}.${property} publishes no pattern`);
  }

  return published;
};

/** Every pattern in the document, on a property or a parameter, with where it is. */
const everyPattern = (): [string, string][] => {
  const found: [string, string][] = [];
  for (const [name, schema] of Object.entries(schemas)) {
    for (const [key, property] of Object.entries<any>(
      schema.properties ?? {},
    )) {
      if (typeof property.pattern === 'string') {
        found.push([`${name}.${key}`, property.pattern]);
      }
    }
  }
  for (const [path, methods] of Object.entries<any>(document.paths)) {
    for (const [method, operation] of Object.entries<any>(methods)) {
      for (const parameter of operation.parameters ?? []) {
        if (typeof parameter.schema?.pattern === 'string') {
          found.push([
            `${method} ${path} ${parameter.name}`,
            parameter.schema.pattern,
          ]);
        }
      }
    }
  }

  return found;
};

describe('the constraints the Java document publishes', () => {
  it.each([
    ['RegisterDto', 'password'],
    ['ResetPasswordDto', 'newPassword'],
    ['ChangePasswordDto', 'newPassword'],
  ])(
    '%s.%s: the published pattern IS the strong-password rule, row for row',
    (schema, property) => {
      const pattern = new RegExp(patternOf(schema, property));

      for (const [input, accepted] of table.strongPassword) {
        expect({ input, accepted: pattern.test(input) }).toEqual({
          input,
          accepted,
        });
      }
    },
  );

  it('VerifyOtpDto.code: the published pattern IS the number-string rule, row for row', () => {
    const pattern = new RegExp(patternOf('VerifyOtpDto', 'code'));

    for (const [input, accepted] of table.numeric) {
      expect({ input, accepted: pattern.test(input) }).toEqual({
        input,
        accepted,
      });
    }
  });

  it('CreateTicketExportDto.from: the published ISO pattern accepts every date the library does, and refuses some', () => {
    const pattern = new RegExp(patternOf('CreateTicketExportDto', 'from'));
    const rows = table.iso8601;

    for (const [input, accepted] of rows.filter(([, ok]) => ok)) {
      expect({ input, matches: pattern.test(input) }).toEqual({
        input,
        matches: accepted,
      });
    }
    expect(
      rows.filter(([input, ok]) => !ok && !pattern.test(input)).length,
    ).toBeGreaterThan(0);
  });

  it('CreateExportDto.from: the published day pattern takes a day and nothing longer', () => {
    const pattern = new RegExp(patternOf('CreateExportDto', 'from'));

    expect(
      ['2026-01-31', '2026-01-31T00:00:00Z', '20260131', '2026-1-31'].map(
        (input) => pattern.test(input),
      ),
    ).toEqual([true, false, false, false]);
  });

  it('every published pattern compiles as ECMA-262, the dialect JSON Schema uses', () => {
    const patterns = everyPattern();

    expect(patterns.length).toBeGreaterThan(20);
    for (const [where, source] of patterns) {
      expect({
        where,
        compiles: (() => {
          try {
            new RegExp(source);
            return true;
          } catch {
            return false;
          }
        })(),
      }).toEqual({ where, compiles: true });
    }
  });

  it('a rule no keyword can state is published as its sentence', () => {
    expect(schemas.UpdateUserDto.properties.phoneNumber.description).toContain(
      'valid phone number',
    );
    expect(
      schemas.RequestPhoneVerificationDto.properties.phoneNumber.description,
    ).toContain('valid phone number');
    expect(schemas.LockUserDto.properties.lockedUntil.description).toContain(
      'in the future',
    );
  });
});
