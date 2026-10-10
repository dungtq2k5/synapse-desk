import { ValidateIf, ValidationOptions } from 'class-validator';

export function IsNullable(validationOptions?: ValidationOptions) {
  const condition = (
    _object: Record<string, unknown>,
    value: unknown,
  ): boolean => value !== undefined;

  return ValidateIf(condition, validationOptions);
}

/**
 * Present, but allowed to be `null`.
 *
 * The sibling of {@link IsNullable}, and the difference is which absence each
 * one forgives. `IsNullable` skips validation when a value is `undefined` — it
 * exists for RESPONSE DTOs, which are never validated inbound, so on a request
 * `null` still reaches `@IsString()` and fails. `@IsOptional()` skips `null`
 * *and* `undefined`, which lets a caller omit the key entirely.
 *
 * This one skips only `null`, so the key stays required while its value may be
 * empty — "no text part" and "the field was forgotten" stay different facts.
 */
export function IsPresentButNullable(validationOptions?: ValidationOptions) {
  const condition = (
    _object: Record<string, unknown>,
    value: unknown,
  ): boolean => value !== null;

  return ValidateIf(condition, validationOptions);
}
