package com.synapsedesk.gateway.modules.auditlogs.dto.rest;

/**
 * The `resourceType` filter of the tenant and platform audit-log lists, exactly as the published contract's enum lists it. A
 * value outside it is refused with a 400 before any handler or peer runs, and the
 * document publishes the enum from the type.
 *
 * <p>The constants are the wire values, so Spring converts the parameter by constant
 * name. Named {@code ...Filter} so it never collides with the protobuf type of the
 * same resource that the same controllers import.
 */
public enum AuditResourceTypeFilter {
  DEPARTMENT,
  DOCUMENT_FLAG,
  EXPORT,
  ORGANIZATION,
  ROLE,
  SUBSCRIPTION_PLAN,
  USER,
}
