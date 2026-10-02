package com.synapsedesk.gateway.web;

/**
 * The {@code status} filter of the document and chunk lists, exactly as the published contract's enum lists it. A value outside it is
 * refused with a 400 before any handler or peer runs, and the document publishes
 * the enum from the type.
 *
 * <p>The constants are the wire values, so Spring converts the parameter by
 * constant name and there is no converter to keep in step with the contract. Named
 * {@code ...Filter} so it never collides with the protobuf type of the same
 * resource that the same controllers import.
 */
public enum DocumentStatusFilter {
  FAILED,
  INDEXED,
  PENDING,
  PROCESSING,
}
