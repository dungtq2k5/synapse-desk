import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsBoolean, IsOptional } from 'class-validator';
import { ToBoolean } from './to-boolean.decorator';

/**
 * The contract every `@ToBoolean()` field depends on.
 *
 * Pins three behaviours the DTOs rely on and none of them state: `'false'` is
 * `false`, `'1'`/`'0'` are accepted, and an ABSENT key keeps its declared
 * default rather than becoming `false`.
 */
class Flags {
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly plain?: boolean;

  /** The shape `ConfirmDocumentDto.isOrganizationWide` uses — RDM Table 17. */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly defaultsTrue?: boolean = true;
}

const parse = (payload: Record<string, unknown>) =>
  plainToInstance(Flags, payload);

describe('@ToBoolean', () => {
  describe('accepts the spellings a query string actually carries', () => {
    it.each([
      ['true', true],
      ['1', true],
      ['True', true],
      ['TRUE', true],
      [true, true],
      ['false', false],
      ['0', false],
      ['False', false],
      [false, false],
    ])('%p -> %p', (input, expected) => {
      const dto = parse({ plain: input });

      expect(dto.plain).toBe(expected);
      expect(validateSync(dto)).toEqual([]);
    });
  });

  describe('**refuses anything else instead of calling it false**', () => {
    // The change this file was written for. These used to become `false` and
    // return 200 over the wrong row set — a wrong answer where a 400 is a
    // correct one.
    it.each(['yes', 'no', 'on', 'off', '', 'TRUEISH', '2', 'null'])(
      '%p is a validation error',
      (input) => {
        const dto = parse({ plain: input });

        // Passed through unchanged rather than thrown on, so the message names
        // the property. A throwing transform would surface as a 500.
        expect(dto.plain).toBe(input);
        expect(validateSync(dto)).not.toEqual([]);
      },
    );
  });

  describe('an ABSENT flag keeps its declared default', () => {
    // The one worth asserting: class-transformer does NOT run a transform for a
    // key the payload never had, so a `= true` default survives. Read the other
    // way -- `undefined` becoming `false` -- the documented default of
    // `isOrganizationWide` would be dead and every new document scoped.
    it('keeps `= true` when the key is missing', () => {
      const dto = parse({});

      expect(dto.defaultsTrue).toBe(true);
      expect(validateSync(dto)).toEqual([]);
    });

    it('still lets an explicit `false` override that default', () => {
      const dto = parse({ defaultsTrue: 'false' });

      expect(dto.defaultsTrue).toBe(false);
      expect(validateSync(dto)).toEqual([]);
    });

    it('leaves an optional flag with no default undefined', () => {
      const dto = parse({});

      expect(dto.plain).toBeUndefined();
      expect(validateSync(dto)).toEqual([]);
    });
  });
});
