package com.synapsedesk.gateway.common.lifecycle;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * What a tenant may do in each lifecycle state, and the decision for one request —
 * the one checker behind both transports (a servlet interceptor for REST and an
 * aspect for GraphQL, which dispatch separately), as {@code PermissionChecker} is.
 *
 * <p>Without a gate, setting a tenant to FROZEN changes a column and nothing else:
 * a button that appears to suspend a customer and does not. Billing suspension,
 * offboarding and freezing all become advisory, and the tenant keeps working.
 *
 * <p>The table is {@code ORG_STATUS_ACCESS} in
 * {@code packages/contracts/src/configs/organization.config.ts}, and the messages are the
 * ones {@code test/gateway-contract/org-lifecycle.contract-spec.ts} asserts. An
 * unknown status (a cached value some other writer produced) allows nothing.
 */
@Component
public class LifecyclePolicy {

  private static final Map<String, Set<OrgAccess>> ACCESS = Map.of(
    "PENDING_ONBOARDING",
    // Reads and writes are permitted while onboarding: the checklist asks the admin
    // to create a department and invite a colleague, which a read-only tenant
    // cannot do. Onboarding is a state of NOT-YET-BILLED, not of restricted trust.
    EnumSet.of(
      OrgAccess.AUTH,
      OrgAccess.ONBOARDING,
      OrgAccess.READ,
      OrgAccess.WRITE,
      OrgAccess.BILLING
    ),
    "ACTIVE",
    EnumSet.of(
      OrgAccess.AUTH,
      OrgAccess.READ,
      OrgAccess.WRITE,
      OrgAccess.ONBOARDING,
      OrgAccess.BILLING
    ),
    "SUSPENDED_PAST_DUE",
    EnumSet.of(OrgAccess.AUTH, OrgAccess.READ, OrgAccess.BILLING),
    "FROZEN",
    EnumSet.of(OrgAccess.AUTH)
  );

  private final OrganizationStatusService statuses;

  public LifecyclePolicy(OrganizationStatusService statuses) {
    this.statuses = statuses;
  }

  /**
   * Refuses (403) unless the tenant may do a {@code kind} of thing now. {@code AUTH}
   * is never asked about: a member of a frozen workspace can still sign in and be
   * told why they cannot proceed.
   */
  public void require(String organizationId, OrgAccess kind) {
    if (kind == OrgAccess.AUTH) return;

    OrganizationStatusService.State state = statuses.get(organizationId);

    if (state.deleted()) {
      throw refused(
        "This workspace has been closed. Contact support if this is unexpected."
      );
    }
    if (!ACCESS.getOrDefault(state.status(), Set.of()).contains(kind)) {
      throw refused(explain(state.status()));
    }
  }

  /** The route's category when it declares none: READ for a GET or HEAD, else WRITE. */
  public static OrgAccess byVerb(String method) {
    return "GET".equals(method) || "HEAD".equals(method)
      ? OrgAccess.READ
      : OrgAccess.WRITE;
  }

  /** Says which state the tenant is in and what to do about it. */
  static String explain(String status) {
    return switch (status) {
      case "SUSPENDED_PAST_DUE" -> "This workspace is suspended for non-payment. It is read-only until billing is settled.";
      case "FROZEN" -> "This workspace is frozen. Contact support to restore access.";
      case "PENDING_ONBOARDING" -> "This workspace has not finished onboarding yet.";
      default -> "This workspace cannot perform that action in its current state.";
    };
  }

  private static ResponseStatusException refused(String message) {
    return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
  }
}
