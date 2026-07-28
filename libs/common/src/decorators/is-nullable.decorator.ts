import { ValidateIf, ValidationOptions } from 'class-validator';

export function IsNullable(validationOptions?: ValidationOptions) {
  const condition = (
    _object: Record<string, unknown>,
    value: unknown,
  ): boolean => value !== undefined;

  return ValidateIf(condition, validationOptions);
}
