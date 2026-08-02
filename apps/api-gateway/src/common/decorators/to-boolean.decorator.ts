import { Transform } from 'class-transformer';

/**
 * Coerces a query-string flag to a real boolean.
 *
 * **Why not `@Type(() => Boolean)`?** Because it is silently wrong. Query
 * strings are text, so `?includeDeleted=false` arrives as the STRING `'false'`,
 * and class-transformer's Boolean branch is a bare `Boolean(value)` call
 * (`TransformOperationExecutor.js`):
 *
 *     Boolean('false') === true
 *     Boolean('0')     === true
 *     Boolean('')      === false
 *
 * So `@Type(() => Boolean)` makes every present value true except an empty one
 * — the flag can be turned ON but never OFF. And because the result IS a real
 * boolean, `@IsBoolean()` passes and the ValidationPipe raises nothing: the
 * failure is invisible until someone notices that `includeDeleted=false` is
 * returning deleted rows.
 *
 * `enableImplicitConversion` does not help either — it routes through the same
 * branch.
 *
 * Only the exact string `'true'` (or a genuine `true`, for a JSON body) is
 * accepted. Anything else is false, which fails CLOSED: these flags widen what
 * a caller can see, so an unrecognised value must not widen it.
 */
export const ToBoolean = () =>
  Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  );
