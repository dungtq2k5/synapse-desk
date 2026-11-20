import { applyDecorators } from '@nestjs/common';
import { buildMessage, ValidateBy, ValidateIf } from 'class-validator';

/**
 * An optional request field that refuses an explicit `null`.
 *
 * Absent, it's left out: the field's other validators don't run, and a
 * default (`= []`) stays. `null` is a 400 naming the field ("`tags` can't be
 * null; leave it out instead"): the gateway doesn't guess whether `null`
 * means "clear" or "leave it", so a caller learns at once that this field
 * can't be cleared that way. The field's other validators run on the `null`
 * too, so their messages come with it.
 *
 * Replaces `class-validator`'s `@IsOptional()`, which skips every validator on
 * `null` and lets it reach the code as a value its type says it can't hold.
 *
 * @example @OptionalNonNull() @IsString() readonly description?: string;
 */
export function OptionalNonNull(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_object: object, value: unknown) => value !== undefined),
    ValidateBy({
      name: 'notNull',
      validator: {
        validate: (value: unknown) => value !== null,
        defaultMessage: buildMessage(
          () => "$property can't be null; leave it out instead",
        ),
      },
    }),
  );
}

/**
 * An optional request field where `null` means something: clear the value,
 * or (on a GraphQL argument) unset, as the GraphQL schema says. Absent and
 * `null` both skip the field's other validators.
 *
 * The field is typed `| null`, so TypeScript makes every use handle the
 * `null`, and the document publishes it as nullable from that type.
 *
 * @example @OptionalNullable() @IsISO8601() readonly dob?: string | null;
 */
export function OptionalNullable(): PropertyDecorator {
  return ValidateIf(
    (_object: object, value: unknown) => value !== undefined && value !== null,
  );
}
