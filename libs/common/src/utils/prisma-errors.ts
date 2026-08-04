/**
 * Prisma error shapes, identified by SHAPE rather than by class.
 *
 * `error instanceof Prisma.PrismaClientKnownRequestError` is the obvious
 * implementation and the wrong one here: each service generates its OWN Prisma
 * client, so there are two `PrismaClientKnownRequestError` classes in this
 * repo and an error raised by ticket-service's client is not an `instanceof`
 * auth-service's. The check would silently return false and a clean 409 would
 * surface as an unhandled 500 — the same failure mode `SmartThrottlerGuard`
 * documents for `ThrottlerException`, and the same fix.
 *
 * Duck-typing also lets this live in `libs/common`, which has no Prisma
 * dependency and must not grow one: it is imported by the gateway, which owns
 * no database at all.
 */

/** The subset of a Prisma known-request error this file reads. */
type PrismaKnownRequestError = {
  code: string;
  meta?: { target?: unknown };
};

function asKnownRequestError(error: unknown): PrismaKnownRequestError | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as { code?: unknown; meta?: unknown };
  if (typeof candidate.code !== 'string') return null;

  return candidate as PrismaKnownRequestError;
}

/**
 * A unique-constraint violation — `P2002`.
 *
 * Every write guarded by a pre-check ALSO needs this, and the pairing is not
 * redundancy:
 *
 *   pre-check -> a good error message in the 99.99% non-racing case
 *   this      -> correctness in the remaining case, where two concurrent
 *                writers both read "free" and both insert
 *
 * `index` narrows it to one constraint, so a handler can tell "that email is
 * taken" from "that slug is taken" when a row is guarded by several.
 */
export function isUniqueConstraintViolation(
  error: unknown,
  index?: string,
): boolean {
  const known = asKnownRequestError(error);
  if (known?.code !== 'P2002') return false;
  if (!index) return true;

  // `meta.target` is the index NAME for a raw-SQL partial index, and a
  // field-name ARRAY for one Prisma declared. Only those two shapes are
  // matched — anything else is treated as "not this index" rather than
  // stringified, because `String({})` yields '[object Object]' and would match
  // nothing usefully while looking like it had checked.
  const target: unknown = known.meta?.target;
  if (typeof target === 'string') return target.includes(index);
  if (Array.isArray(target)) return target.includes(index);

  return false;
}

/** A foreign-key constraint violation — `P2003`. */
export function isForeignKeyViolation(error: unknown): boolean {
  return asKnownRequestError(error)?.code === 'P2003';
}

/** "An operation failed because it depends on one or more records that were
 * required but not found" — `P2025`. Raised by `update`/`delete` on a `where`
 * that matched nothing, which for a tenant-scoped write means the row belongs
 * to someone else. */
export function isRecordNotFound(error: unknown): boolean {
  return asKnownRequestError(error)?.code === 'P2025';
}
