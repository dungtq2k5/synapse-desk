package com.synapsedesk.gateway.lifecycle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.lifecycle.OrganizationStatusService.State;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

/**
 * What a tenant may do in each lifecycle state, and what is said when it may not.
 *
 * <p>Without the gate, setting a tenant to FROZEN changes a column and nothing else.
 * The access table is {@code ORG_STATUS_ACCESS} in
 * {@code libs/common/src/configs/organization.config.ts}; the contract matrix holds it
 * equal end to end, and this pins it where a mutation is cheap to run.
 */
class LifecyclePolicyTest {

  private static final String ORG = "99999999-9999-4999-8999-999999999999";

  /** What each status allows, written out: the table the matrix compares against. */
  private static final Map<String, Set<OrgAccess>> ALLOWED = Map.of(
    "ACTIVE",
    Set.of(
      OrgAccess.AUTH,
      OrgAccess.READ,
      OrgAccess.WRITE,
      OrgAccess.ONBOARDING,
      OrgAccess.BILLING
    ),
    "PENDING_ONBOARDING",
    Set.of(
      OrgAccess.AUTH,
      OrgAccess.READ,
      OrgAccess.WRITE,
      OrgAccess.ONBOARDING,
      OrgAccess.BILLING
    ),
    "SUSPENDED_PAST_DUE",
    Set.of(OrgAccess.AUTH, OrgAccess.READ, OrgAccess.BILLING),
    "FROZEN",
    Set.of(OrgAccess.AUTH)
  );

  private OrganizationStatusService statuses;
  private LifecyclePolicy policy;

  @BeforeEach
  void setUp() {
    statuses = mock(OrganizationStatusService.class);
    policy = new LifecyclePolicy(statuses);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  private void tenantIs(String status, boolean deleted) {
    when(statuses.get(ORG)).thenReturn(new State(status, deleted));
  }

  @Test
  void everyStatusAllowsExactlyWhatTheTableSays() {
    for (var entry : ALLOWED.entrySet()) {
      for (OrgAccess kind : OrgAccess.values()) {
        tenantIs(entry.getKey(), false);
        boolean allowed = entry.getValue().contains(kind);

        if (allowed) {
          policy.require(ORG, kind);
        } else {
          assertThatThrownBy(() -> policy.require(ORG, kind))
            .as("%s on a %s workspace", kind, entry.getKey())
            .isInstanceOfSatisfying(ResponseStatusException.class, refusal ->
              assertThat(refusal.getStatusCode()).isEqualTo(
                HttpStatus.FORBIDDEN
              )
            );
        }
      }
    }
  }

  @Test
  void signInRoutesAreNeverAskedAboutSoAFrozenMemberCanBeToldWhy() {
    policy.require(ORG, OrgAccess.AUTH);

    verifyNoInteractions(statuses);
  }

  @Test
  void everyOtherCategoryAsksAboutThisTenant() {
    tenantIs("ACTIVE", false);

    policy.require(ORG, OrgAccess.READ);

    verify(statuses).get(ORG);
  }

  @Test
  void aClosedWorkspaceIsRefusedEvenWhileItsStatusStillReadsActive() {
    tenantIs("ACTIVE", true);

    assertThatThrownBy(() ->
      policy.require(ORG, OrgAccess.READ)
    ).isInstanceOfSatisfying(ResponseStatusException.class, refusal ->
      assertThat(refusal.getReason()).isEqualTo(
        "This workspace has been closed. Contact support if this is unexpected."
      )
    );
  }

  @Test
  void eachStateExplainsItselfInNodesWords() {
    assertThat(LifecyclePolicy.explain("SUSPENDED_PAST_DUE")).isEqualTo(
      "This workspace is suspended for non-payment. It is read-only until billing is settled."
    );
    assertThat(LifecyclePolicy.explain("FROZEN")).isEqualTo(
      "This workspace is frozen. Contact support to restore access."
    );
    assertThat(LifecyclePolicy.explain("PENDING_ONBOARDING")).isEqualTo(
      "This workspace has not finished onboarding yet."
    );
    assertThat(LifecyclePolicy.explain("SOMETHING_ELSE")).isEqualTo(
      "This workspace cannot perform that action in its current state."
    );
  }

  @Test
  void aStatusNoOneRecognisesAllowsNothingExceptSignIn() {
    tenantIs("FROM_A_NEWER_WRITER", false);

    assertThatThrownBy(() ->
      policy.require(ORG, OrgAccess.READ)
    ).isInstanceOfSatisfying(ResponseStatusException.class, refusal ->
      assertThat(refusal.getReason()).isEqualTo(
        "This workspace cannot perform that action in its current state."
      )
    );
  }

  @Test
  void aPeerThatCannotBeReachedFailsTheRequestRatherThanWavingItThrough() {
    when(statuses.get(anyString())).thenThrow(
      new IllegalStateException("auth is down")
    );

    assertThatThrownBy(() -> policy.require(ORG, OrgAccess.READ)).isInstanceOf(
      IllegalStateException.class
    );
  }

  @Test
  void aRefusalIsMarkedAsAGuardsSoItIsNotCountedInTheRequestMetrics() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(request)
    );
    tenantIs("FROZEN", false);

    assertThatThrownBy(() -> policy.require(ORG, OrgAccess.READ)).isInstanceOf(
      ResponseStatusException.class
    );

    assertThat(
      request.getAttributeNames().asIterator().hasNext() &&
        java.util.Collections.list(request.getAttributeNames())
          .stream()
          .anyMatch(name -> name.contains("GuardRefusal"))
    ).isTrue();
  }

  @Test
  void aRouteWithNoDeclarationIsReadOrWriteByItsVerb() {
    assertThat(LifecyclePolicy.byVerb("GET")).isEqualTo(OrgAccess.READ);
    assertThat(LifecyclePolicy.byVerb("HEAD")).isEqualTo(OrgAccess.READ);
    assertThat(LifecyclePolicy.byVerb("POST")).isEqualTo(OrgAccess.WRITE);
    assertThat(LifecyclePolicy.byVerb("PATCH")).isEqualTo(OrgAccess.WRITE);
    assertThat(LifecyclePolicy.byVerb("DELETE")).isEqualTo(OrgAccess.WRITE);
    assertThat(LifecyclePolicy.byVerb("OPTIONS")).isEqualTo(OrgAccess.WRITE);
  }
}
