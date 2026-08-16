import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * An ISO-8601 instant that has not already passed
 *
 * Written for `LockUserDto.lockedUntil`, where a past value would lock and
 * unlock an account in the same instant: accepted by the database, rejected by
 * nobody, and incomprehensible to both the admin who set it and the user who
 * received the email announcing it.
 *
 * **Compose it with `@IsISO8601()`, do not replace it.** This constraint answers
 * only "is it in the future" — an unparseable string fails here too, but with a
 * message about time rather than about format, which sends the caller looking
 * in the wrong place.
 */
export function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;

          const instant = Date.parse(value);

          // `NaN > x` is false, so an unparseable string fails without a
          // separate branch — but the check is explicit anyway, because a
          // reader should not have to know that to trust the line.
          if (Number.isNaN(instant)) return false;

          return instant > Date.now();
        },
        defaultMessage(): string {
          return '$property must be a date in the future';
        },
      },
    });
  };
}
