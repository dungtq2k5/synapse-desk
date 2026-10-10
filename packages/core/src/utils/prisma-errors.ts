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
  meta?: {
    target?: unknown;
    /**
     * Prisma 7 + a driver adapter reports the constraint HERE and leaves
     * `target` undefined entirely. Two shapes, one error class — see
     * `constraintNameFrom` for why both have to be read.
     */
    driverAdapterError?: {
      cause?: {
        originalMessage?: unknown;
        constraint?: { fields?: unknown; index?: unknown };
      };
    };
  };
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

  return constraintNameFrom(known).some((name) => name.includes(index));
}

/**
 * Every place a P2002 might name its constraint. All of them are read.
 *
 * Prisma reports this differently depending on how the client talks to
 * Postgres, and the difference is silent:
 *
 *   - **Without a driver adapter**, `meta.target` carries the index name (raw
 *     SQL index) or a field-name array (Prisma-declared `@@unique`).
 *   - **With a driver adapter** — what this repo uses on Prisma 7 —
 *     `meta.target` is ABSENT and the name appears only inside
 *     `meta.driverAdapterError.cause.originalMessage`.
 *
 * Reading only `target` made every raw-SQL-index check return false under the
 * adapter: a partial unique index fired correctly in Postgres, the service
 * failed to recognise it, and a clean 409 surfaced as an unhandled 500.
 *
 * `constraint.fields` is deliberately NOT consulted — it lists COLUMN names, so
 * matching against it would make any two indexes over the same columns
 * indistinguishable, which is the whole thing `index` exists to tell apart.
 */
function constraintNameFrom(known: PrismaKnownRequestError): string[] {
  const names: string[] = [];

  const target: unknown = known.meta?.target;
  if (typeof target === 'string') names.push(target);
  if (Array.isArray(target)) {
    names.push(
      ...target.filter((entry): entry is string => typeof entry === 'string'),
    );
  }

  const originalMessage: unknown =
    known.meta?.driverAdapterError?.cause?.originalMessage;
  if (typeof originalMessage === 'string') names.push(originalMessage);

  const indexName: unknown =
    known.meta?.driverAdapterError?.cause?.constraint?.index;
  if (typeof indexName === 'string') names.push(indexName);

  return names;
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
