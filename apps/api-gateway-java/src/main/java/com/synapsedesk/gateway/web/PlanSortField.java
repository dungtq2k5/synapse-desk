package com.synapsedesk.gateway.web;

/**
 * The {@code sortBy} values the platform plans list accepts, exactly as the published contract's enum
 * lists them. A value outside it is refused with a 400 before any handler or
 * peer runs, and the document publishes the enum from the type.
 *
 * <p>The constants are spelled as the wire values ({@code createdAt}, not {@code
 * CREATED_AT}) because Spring converts the parameter by constant name: there is
 * no converter to keep in step with the contract, and the name IS the value.
 * Named for the resource, not the route, so a second route that takes the same
 * set reuses it.
 */
public enum PlanSortField {
  createdAt,
  maxAgentSeats,
  name,
}
