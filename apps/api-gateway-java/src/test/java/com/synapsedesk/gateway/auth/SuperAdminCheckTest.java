package com.synapsedesk.gateway.auth;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/**
 * `SuperAdminGuard`, reproduced — the property under test is BOTH
 * conditions, not just the flag: a token could in principle carry {@code
 * isSuperAdmin=true} with a non-null {@code organizationId} (a bug, or a
 * token minted before a schema change), and the wrong direction to fail on
 * "is a super admin" is generous.
 */
class SuperAdminCheckTest {

  private final SuperAdminCheck check = new SuperAdminCheck();

  private static RequestContext contextOf(boolean isSuperAdmin, String organizationId) {
    return new RequestContext("agent-1", organizationId, isSuperAdmin, List.of(), List.of(), true, "127.0.0.1", "test");
  }

  @Test
  void aGenuineSuperAdminWithNoOrganizationPasses() {
    assertThatCode(() -> check.require(contextOf(true, null))).doesNotThrowAnyException();
  }

  @Test
  void anOrdinaryUserIsRefused() {
    assertThatThrownBy(() -> check.require(contextOf(false, "org-1"))).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void theSuperAdminFlagAloneIsNotEnoughWithAnOrganizationIdStillPresent() {
    assertThatThrownBy(() -> check.require(contextOf(true, "org-1"))).isInstanceOf(ResponseStatusException.class);
  }
}
