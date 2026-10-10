package com.synapsedesk.gateway.lifecycle;

/**
 * The category of a route, for the tenant lifecycle gate — the values of
 * {@code OrgAccess} in {@code packages/contracts/src/configs/organization.config.ts}.
 *
 * <p>{@code AUTH} is never gated (a member of a frozen workspace must still be able
 * to sign in and be TOLD why they cannot proceed, rather than meeting an unexplained
 * 403 at the login form); {@code READ} and {@code WRITE} are the verb's default
 * ({@code GET} and {@code HEAD} read, everything else writes); {@code BILLING} and
 * {@code ONBOARDING} are declared on the routes that must stay reachable when the
 * rest of the workspace is not.
 */
public enum OrgAccess {
  AUTH,
  READ,
  WRITE,
  ONBOARDING,
  BILLING,
}
