import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNumberString,
  IsStrongPassword,
  Matches,
  type ValidationOptions,
} from 'class-validator';
import { PASSWORD_POLICY } from '@synapsedesk/contracts';

/**
 * Validators that publish what they enforce. Each applies the
 * `class-validator` decorator and writes the same rule into the document as a
 * `pattern`, so a generated client refuses what the gateway would. Request DTOs
 * use these, never the bare validators: `packages/config`'s
 * `published-validators.spec.ts` holds that.
 */

/**
 * `PASSWORD_POLICY` as a regular expression: one lookahead per required
 * character class, then the minimum length. The Java gateway's
 * `@StrongPassword` builds the same string.
 */
export const PASSWORD_PATTERN = [
  '^',
  atLeast(PASSWORD_POLICY.minLowercase, '[a-z]'),
  atLeast(PASSWORD_POLICY.minUppercase, '[A-Z]'),
  atLeast(PASSWORD_POLICY.minNumbers, '[0-9]'),
  atLeast(
    PASSWORD_POLICY.minSymbols,
    `[${PASSWORD_POLICY.symbols.replace(/[\\\-[\]]/g, '\\$&')}]`,
  ),
  `[\\s\\S]{${PASSWORD_POLICY.minLength},}$`,
].join('');

/**
 * validator.js's ISO 8601 expression, which `@IsISO8601()` matches against.
 * `strict` adds a calendar check (no 30 February) no pattern can express.
 */
export const ISO8601_PATTERN =
  '^([\\+-]?\\d{4}(?!\\d{2}\\b))((-?)((0[1-9]|1[0-2])(\\3([12]\\d|0[1-9]|3[01]))?|W([0-4]\\d|5[0-3])(-?[1-7])?|(00[1-9]|0[1-9]\\d|[12]\\d{2}|3([0-5]\\d|6[1-6])))([T\\s]((([01]\\d|2[0-3])((:?)[0-5]\\d)?|24:?00)([\\.,]\\d+(?!:))?)?(\\17[0-5]\\d([\\.,]\\d+)?)?([zZ]|([\\+-])([01]\\d|2[0-3]):?([0-5]\\d)?)?)?)?$';

/**
 * An instant: an RFC 3339 date-time with seconds and an offset, what the
 * document's `format: date-time` says. Unlike {@link ISO8601_PATTERN} it has no
 * week or ordinal dates, which `new Date()` can't read, and no offset-less
 * time, which it reads in the server's own time zone.
 */
export const DATE_TIME_PATTERN =
  '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d+)?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)$';

/** validator.js's `isNumeric`, which `@IsNumberString()` matches against. */
export const NUMBER_STRING_PATTERN = '^[+-]?([0-9]*[.])?[0-9]+$';

/** `@IsStrongPassword(PASSWORD_POLICY)`, published as {@link PASSWORD_PATTERN}. */
export function StrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsStrongPassword(PASSWORD_POLICY),
    ApiProperty({ pattern: PASSWORD_PATTERN }),
  );
}

/**
 * `@Matches(pattern)`, published as the pattern's source; with `each`, on the
 * array's items.
 */
export function PublishedMatches(
  pattern: RegExp,
  options?: ValidationOptions,
): PropertyDecorator {
  return applyDecorators(
    Matches(pattern, options),
    // With `each`, the property is an array and the pattern is its items'.
    ApiProperty(
      options?.each
        ? { type: [String], pattern: pattern.source }
        : { pattern: pattern.source },
    ),
  );
}

/** `@IsISO8601()`, published as {@link ISO8601_PATTERN}. */
export function PublishedISO8601(
  options?: Parameters<typeof IsISO8601>[0],
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return applyDecorators(
    IsISO8601(options, validationOptions),
    ApiProperty({ pattern: ISO8601_PATTERN }),
  );
}

/**
 * An instant as a string, published as {@link DATE_TIME_PATTERN}: the pattern,
 * then `@IsISO8601({ strict: true })` for the calendar (no 30 February). The
 * field stays a string; whoever reads it converts with `new Date(value)`,
 * which is exact for this form.
 *
 * @example `@PublishedDateTime() readonly readAt?: string;`
 */
export function PublishedDateTime(): PropertyDecorator {
  const message =
    '$property must be a date-time with an offset, such as 2026-11-22T10:00:00Z';
  return applyDecorators(
    Matches(new RegExp(DATE_TIME_PATTERN), { message }),
    IsISO8601({ strict: true }, { message }),
    ApiProperty({
      type: String,
      format: 'date-time',
      pattern: DATE_TIME_PATTERN,
    }),
  );
}

/** `@IsNumberString()`, published as {@link NUMBER_STRING_PATTERN}. */
export function PublishedNumberString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return applyDecorators(
    IsNumberString({}, validationOptions),
    ApiProperty({ pattern: NUMBER_STRING_PATTERN }),
  );
}

function atLeast(count: number, characterClass: string): string {
  return `(?=${`[\\s\\S]*${characterClass}`.repeat(count)})`;
}
