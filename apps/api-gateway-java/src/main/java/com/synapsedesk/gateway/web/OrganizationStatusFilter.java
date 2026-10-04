package com.synapsedesk.gateway.web;

/**
 * The `status` filter of the platform organization list, exactly as the published contract's enum lists it. A
 * value outside it is refused with a 400 before any handler or peer runs, and the
 * document publishes the enum from the type.
 *
 * <p>The constants are the wire values, so Spring converts the parameter by constant
 * name. Named {@code ...Filter} so it never collides with the protobuf type of the
 * same resource that the same controllers import.
 */
public enum OrganizationStatusFilter {
  ACTIVE,
  FROZEN,
  PENDING_ONBOARDING,
  SUSPENDED_PAST_DUE,
}
