/**
 * The tenant lifecycle: what each `organizations.status` permits, and which
 * transitions between them are legal.
 *
 * Both tables are POLICY rather than data, which is why they live beside the
 * enum instead of in whichever service happened to need them first.
 */

export enum OrgStatus {
  PENDING_ONBOARDING = 'PENDING_ONBOARDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED_PAST_DUE = 'SUSPENDED_PAST_DUE',
  FROZEN = 'FROZEN',
}

/**
 * What a tenant may do in each lifecycle state (api-endpoints-plan).
 *
 * The table is the whole policy, declared once so the gateway gate and any
 * future consumer read the same rules rather than each encoding their own idea
 * of what SUSPENDED_PAST_DUE permits.
 *
 *   PENDING_ONBOARDING  auth + the onboarding flow only
 *   ACTIVE              everything
 *   SUSPENDED_PAST_DUE  reads only, plus auth and billing — a past-due tenant
 *                       must still be able to see its data and pay, or
 *                       suspension becomes indistinguishable from deletion
 *   FROZEN              auth only; every business route refused
 */
export enum OrgAccess {
  /** Signing in, refreshing, logging out, password reset. Never blocked — a
   * user of a frozen tenant must still be able to authenticate and be told
   * why they cannot proceed. */
  AUTH = 'AUTH',
  /** Reading business data. */
  READ = 'READ',
  /** Changing business data. */
  WRITE = 'WRITE',
  /** The onboarding flow itself, which by definition runs before ACTIVE. */
  ONBOARDING = 'ONBOARDING',
  /** Billing and the usage pages a past-due tenant needs to settle up. */
  BILLING = 'BILLING',
}

export const ORG_STATUS_ACCESS: Record<OrgStatus, readonly OrgAccess[]> = {
  [OrgStatus.PENDING_ONBOARDING]: [
    OrgAccess.AUTH,
    OrgAccess.ONBOARDING,
    // Reads and writes are permitted while onboarding: the checklist asks the
    // admin to create a department and invite a colleague, which they cannot do
    // from a read-only tenant. Onboarding is a state of NOT-YET-BILLED, not of
    // restricted trust.
    OrgAccess.READ,
    OrgAccess.WRITE,
    OrgAccess.BILLING,
  ],
  [OrgStatus.ACTIVE]: [
    OrgAccess.AUTH,
    OrgAccess.READ,
    OrgAccess.WRITE,
    OrgAccess.ONBOARDING,
    OrgAccess.BILLING,
  ],
  [OrgStatus.SUSPENDED_PAST_DUE]: [
    OrgAccess.AUTH,
    OrgAccess.READ,
    OrgAccess.BILLING,
  ],
  [OrgStatus.FROZEN]: [OrgAccess.AUTH],
};

/**
 * Legal `organizations.status` transitions (see the remaining-work doc).
 *
 * An explicit allowlist rather than "anything goes with a reason": the illegal
 * ones matter. FROZEN -> SUSPENDED_PAST_DUE would silently restore read access
 * to a tenant frozen for abuse, and PENDING_ONBOARDING is unreachable once
 * left — a tenant cannot un-onboard.
 */
export const ORG_STATUS_TRANSITIONS: Record<OrgStatus, readonly OrgStatus[]> = {
  [OrgStatus.PENDING_ONBOARDING]: [OrgStatus.ACTIVE, OrgStatus.FROZEN],
  [OrgStatus.ACTIVE]: [OrgStatus.SUSPENDED_PAST_DUE, OrgStatus.FROZEN],
  [OrgStatus.SUSPENDED_PAST_DUE]: [OrgStatus.ACTIVE, OrgStatus.FROZEN],
  [OrgStatus.FROZEN]: [OrgStatus.ACTIVE],
};
