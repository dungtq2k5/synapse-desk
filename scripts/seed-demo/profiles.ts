/**
 * @file What a run produces, as data rather than as branches.
 *
 * A profile is a value the orchestrator reads; nothing anywhere branches on the
 * profile's NAME. Adding a fourth is adding an entry.
 */

/** How much of everything one run makes. */
export type Profile = {
  /** How many tenants. Everything else is per tenant. */
  tenants: number;
  /**
   * Users and tickets as a fraction of what the tenant's PLAN grants, never as
   * a fixed count — see {@link countFor}. `[min, max]` of the grant.
   *
   * **`readonly`, which is what `as const` below actually produces.** A profile
   * is data nobody mutates, so the declaration says so — and a mutable tuple
   * here is a disagreement with the values that some compilers report and
   * others do not.
   */
  seatFill: readonly [min: number, max: number];
  storageFill: readonly [min: number, max: number];
  documentFill: readonly [min: number, max: number];
  ticketsPerUser: readonly [min: number, max: number];
  /** How far back `billing_events` history runs. */
  billingMonths: number;
  /**
   * One tenant is seeded just past a threshold on purpose, so the level alarm
   * has something to show. **Deliberate, never an accident of random sizes**:
   * a demo that happens to cross 80% teaches nobody anything, and a demo that
   * happens to cross 100% is a refusal nobody expected.
   */
  nearThresholdFill: number;
  /**
   * A ceiling on rows per tenant per dimension, applied AFTER the grant.
   *
   * **The grant decides the shape; this decides the size.** Enterprise grants
   * 100,000 documents, and 60% of that is a demo nobody waits for and a
   * `large` profile that writes millions of rows. Capping keeps the derivation
   * rule intact — a tenant is still never over its limit, because the cap only
   * ever lowers — while keeping a run to something a person can sit through.
   */
  rowCeiling: number;
};

/**
 * The three shapes, and what each is for.
 *
 * `small` is "can I click through it", `demo` is the one to screenshot, and
 * `large` exists to make pagination and index behaviour visible — it is the
 * only one that will exceed Prisma's default transaction timeout, which is why
 * the writes are batched per tenant.
 */
export const PROFILES = {
  small: {
    tenants: 1,
    seatFill: [0.4, 0.6],
    storageFill: [0.1, 0.3],
    documentFill: [0.1, 0.3],
    ticketsPerUser: [1, 3],
    billingMonths: 3,
    nearThresholdFill: 0.85,
    rowCeiling: 200,
  },
  demo: {
    tenants: 5,
    seatFill: [0.3, 0.8],
    storageFill: [0.1, 0.6],
    documentFill: [0.1, 0.6],
    ticketsPerUser: [2, 6],
    billingMonths: 6,
    nearThresholdFill: 0.85,
    rowCeiling: 400,
  },
  large: {
    tenants: 50,
    seatFill: [0.2, 0.9],
    storageFill: [0.05, 0.7],
    documentFill: [0.05, 0.7],
    ticketsPerUser: [1, 4],
    billingMonths: 12,
    nearThresholdFill: 0.85,
    rowCeiling: 120,
  },
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];

/**
 * A count derived from a GRANT and a target fill, never from a fixed range.
 *
 * **This is the whole of §5 in one function.** A seeder writing directly to the
 * database bypasses every enforcement point, so a fixed `[10, 50]` documents
 * puts a Starter tenant (grant: 1,000) comfortably inside and an imaginary
 * 5-document plan far outside — and the tenant that is over demonstrates a
 * limit the product does not actually have.
 *
 * Clamped to the grant, so a fill of `1.2` cannot produce an over-limit tenant
 * even by mistake. Floors at zero rather than at one: a plan granting nothing
 * gets nothing.
 *
 * @param grant what the tenant's plan allows on this dimension.
 * @param fill fraction of the grant to fill, `0..1`.
 * @param ceiling a demo-sized cap. Only ever LOWERS the answer, so it cannot
 *   put a tenant over its grant.
 */
export function countFor(
  grant: number,
  fill: number,
  ceiling = Infinity,
): number {
  if (!Number.isFinite(grant) || grant <= 0) return 0;

  return Math.max(0, Math.min(grant, ceiling, Math.floor(grant * fill)));
}

/** The same, for the `bigint` grants — storage is bytes. */
export function bytesFor(grant: bigint, fill: number): bigint {
  if (grant <= 0n) return 0n;

  const filled = BigInt(Math.floor(Number(grant) * fill));

  return filled < 0n ? 0n : filled > grant ? grant : filled; // NOSONAR
}
