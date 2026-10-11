package com.synapsedesk.gateway.common.auth;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * `SuperAdminGuard`, reproduced — gates `/platform/*`.
 *
 * <p><b>Not a permission check.</b> RBAC is tenant-scoped — permission rows
 * hang off roles that belong to an organization — and a Super Admin has no
 * organization at all. There is no permission code that could express this,
 * so it keys off the caller's {@code isSuperAdmin} claim instead.
 *
 * <p><b>Both conditions, not just the flag.</b> A database constraint keeps
 * {@code isSuperAdmin} and a null {@code organizationId} paired, but a token
 * minted before a schema change — or by a bug — could carry one without the
 * other, and "is a super admin" is precisely the claim where the wrong
 * direction to fail is generous.
 */
@Component
public class SuperAdminCheck {

  public void require(RequestContext context) {
    if (!context.isSuperAdmin() || context.organizationId() != null) {
      throw new ResponseStatusException(
        HttpStatus.FORBIDDEN,
        "Platform administration access required"
      );
    }
  }
}
