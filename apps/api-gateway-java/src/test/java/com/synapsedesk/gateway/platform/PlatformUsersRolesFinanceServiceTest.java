package com.synapsedesk.gateway.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.generated.model.FinanceRevenueResponseDto;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Platform.FinanceDunning;
import synapsedesk.auth.Platform.FinanceRevenue;
import synapsedesk.auth.Platform.FinanceSnapshotResponse;
import synapsedesk.auth.Platform.FinanceTenantCounts;
import synapsedesk.auth.Platform.ListGlobalRolesRequest;
import synapsedesk.auth.Platform.ListGlobalRolesResponse;
import synapsedesk.auth.PlatformServiceGrpc;

/**
 * `PlatformApi`'s users/global-roles/metrics/finance group (group 2 of 3).
 * Sharpest properties: {@code listGlobalRoles} forwards ONLY {@code page} —
 * the wire request has no other fields at all, so a caller-supplied
 * {@code sortBy}/{@code organizationId} is silently ignored rather than
 * refused, and a port that "fixed" this by inventing wire fields would be
 * wrong; the ISO-date gap on {@code listBillingEvents} (the generator
 * dropped it, same family as {@code PlatformJobsApi}'s {@code
 * BackfillJobDto}); and the finance revenue section's degrade-with-a-reason
 * shape, where {@code excludes} must survive even when everything else in
 * that section goes null.
 */
class PlatformUsersRolesFinanceServiceTest {

  private final PlatformServiceGrpc.PlatformServiceBlockingStub stub = mock(
    PlatformServiceGrpc.PlatformServiceBlockingStub.class
  );
  private final SuperAdminCheck superAdminCheck = mock(SuperAdminCheck.class);
  private PlatformUsersRolesFinanceService service;

  private static RequestContext context() {
    return new RequestContext(
      "agent-1",
      null,
      true,
      List.of(),
      List.of(),
      true,
      "127.0.0.1",
      "test"
    );
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    service = new PlatformUsersRolesFinanceService(stub, superAdminCheck);
  }

  @Test
  void getMetricsRefusesBeforeTouchingThePeerWhenTheCheckFails() {
    org.mockito.Mockito.doThrow(
      new ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN)
    )
      .when(superAdminCheck)
      .require(any());

    assertThatThrownBy(() -> service.getMetrics(context())).isInstanceOf(
      ResponseStatusException.class
    );

    verify(superAdminCheck).require(any());
    verifyNoMoreInteractions(stub);
  }

  @Test
  void listGlobalRolesForwardsOnlyPageEvenWhenSortAndSearchAreSupplied() {
    when(stub.listGlobalRoles(any())).thenReturn(
      ListGlobalRolesResponse.getDefaultInstance()
    );

    service.listGlobalRoles(
      context(),
      java.math.BigDecimal.valueOf(2),
      java.math.BigDecimal.valueOf(25),
      "DESC",
      "acme",
      "name",
      true,
      java.util.UUID.randomUUID()
    );

    ArgumentCaptor<ListGlobalRolesRequest> captor = ArgumentCaptor.forClass(
      ListGlobalRolesRequest.class
    );
    verify(stub).listGlobalRoles(captor.capture());
    // `ListGlobalRolesRequest` has no field but `page` at all — this is the
    // whole wire contract, not a subset the assertion is choosing to check.
    assertThat(captor.getValue().getPage().getPage()).isEqualTo(2);
    assertThat(captor.getValue().getPage().getLimit()).isEqualTo(25);
    assertThat(captor.getValue().toBuilder().clearPage().build()).isEqualTo(
      ListGlobalRolesRequest.getDefaultInstance()
        .toBuilder()
        .clearPage()
        .build()
    );
  }

  @Test
  void listBillingEventsRefusesAMalformedDate() {
    assertThatThrownBy(() ->
      service.listBillingEvents(context(), "not-a-date", "2026-01-31")
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void aDegradedRevenueSectionKeepsExcludesButNullsEverythingElse() {
    Timestamp now = Timestamp.newBuilder().setSeconds(1_756_684_800).build();
    FinanceSnapshotResponse response = FinanceSnapshotResponse.newBuilder()
      .setTenants(FinanceTenantCounts.newBuilder().setTotal(3))
      .setDunning(FinanceDunning.newBuilder().setPastDue(0))
      .setRevenue(
        FinanceRevenue.newBuilder()
          .setAvailable(false)
          .addExcludes("annual prices are estimated")
      )
      .setGeneratedAt(now)
      .build();
    when(stub.getFinanceSnapshot(any())).thenReturn(response);

    FinanceRevenueResponseDto revenue = service
      .getFinanceSnapshot(context())
      .getBody()
      .data()
      .getRevenue();

    assertThat(revenue.getAvailable()).isFalse();
    assertThat(revenue.getEstimatedMrr()).isNull();
    assertThat(revenue.getCurrency()).isNull();
    assertThat(revenue.getActiveSubscriptions()).isNull();
    assertThat(revenue.getComputedAt()).isNull();
    assertThat(revenue.getExcludes()).containsExactly(
      "annual prices are estimated"
    );
  }
}
