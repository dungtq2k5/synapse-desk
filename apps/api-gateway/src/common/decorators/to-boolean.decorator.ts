import { Transform } from 'class-transformer';

const TRUE_VALUES: ReadonlySet<unknown> = new Set([true, 'true', '1']);
const FALSE_VALUES: ReadonlySet<unknown> = new Set([false, 'false', '0']);

/**
 * Parses a query-string flag into a real boolean.
 *
 * Accepts `true` / `false` (boolean or string, any case) and `'1'` / `'0'`.
 * Anything else is returned unchanged so the `@IsBoolean()` beside it produces
 * a 400 naming the property. An absent key is left absent, so a field declared
 * with a default keeps it.
 *
 * Use instead of `@Type(() => Boolean)`, which resolves the string `'false'` to
 * `true` and cannot be turned off.
 *
 * @example
 * class ListDocumentsQueryDto {
 *   @IsOptional()
 *   @IsBoolean()
 *   @ToBoolean()
 *   readonly includeDeleted?: boolean = false;
 * }
 *
 * // ?includeDeleted=false -> false
 * // ?includeDeleted=1     -> true
 * // ?includeDeleted=yes   -> 400
 */
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    // Case-insensitive: `True` and `TRUE` are what hand-written clients send.
    const normalized = typeof value === 'string' ? value.toLowerCase() : value;

    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;

    return value;
  });
