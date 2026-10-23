package com.synapsedesk.gateway.modules.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.SuperAdminCheck;
import com.synapsedesk.gateway.common.web.RawJsonBody;
import com.synapsedesk.gateway.modules.platform.dto.rest.ApplyPlanResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.AssignPlanDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.CreatePlanDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.CreatePlanPriceDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.OverLimitItemResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.ReleasePlanDto;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Platform.ApplyPlanResponse;
import synapsedesk.auth.Platform.AssignPlanRequest;
import synapsedesk.auth.Platform.PlanSubscriberProjection;
import synapsedesk.auth.Platform.ReleasePlanRequest;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.ingestion.IngestionPlatformServiceGrpc;
import synapsedesk.ingestion.Platform.PlatformUsageResponse;
import synapsedesk.ingestion.Platform.TenantUsage;

/**
 * `PlatformApi`'s plan-catalog group (group 3 of 3). Sharpest property:
 * {@code applyPlan}'s usage leg DEGRADES on failure — it never refuses the
 * write, because the leg only annotates the projection with current
 * consumption, and auth-service's own grant computation (seats, storage,
 * AI budget ceilings) neither needs nor waits on it. The degrade is visible
 * the same way `excludes` makes a degraded finance number visible: {@code
 * storage}/{@code documents} simply absent from {@code
 * evaluatedDimensions}, never a silently-zero {@code overLimitCount}.
 */
class PlatformPlansServiceTest {

  private final PlatformServiceGrpc.PlatformServiceBlockingStub stub = mock(
    PlatformServiceGrpc.PlatformServiceBlockingStub.class
  );
  private final IngestionPlatformServiceGrpc.IngestionPlatformServiceBlockingStub usageStub =
    mock(
      IngestionPlatformServiceGrpc.IngestionPlatformServiceBlockingStub.class
    );
  private final SuperAdminCheck superAdminCheck = mock(SuperAdminCheck.class);
  private PlatformPlansService service;

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
    when(usageStub.withDeadlineAfter(anyLong(), any())).thenReturn(usageStub);
    when(usageStub.withInterceptors(any())).thenReturn(usageStub);
    service = new PlatformPlansService(
      stub,
      usageStub,
      superAdminCheck,
      new RawJsonBody(tools.jackson.databind.json.JsonMapper.builder().build())
    );
  }

  @Test
  void getPlanRefusesBeforeTouchingThePeerWhenTheCheckFails() {
    org.mockito.Mockito.doThrow(
      new ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN)
    )
      .when(superAdminCheck)
      .require(any());

    assertThatThrownBy(() -> service.getPlan(context(), "plan-1")).isInstanceOf(
      ResponseStatusException.class
    );

    verify(superAdminCheck).require(any());
    verifyNoMoreInteractions(stub);
  }

  @Test
  void aPlansPricesCarryTheirAmountOrNullWhenNoneWasStored() {
    com.google.protobuf.Timestamp now =
      com.google.protobuf.Timestamp.newBuilder()
        .setSeconds(1_756_684_800)
        .build();
    when(stub.getPlan(any())).thenReturn(
      synapsedesk.auth.Platform.SubscriptionPlanResponse.newBuilder()
        .setId("plan-1")
        .setName("Pro")
        .setCreatedAt(now)
        .setUpdatedAt(now)
        .addPrices(
          synapsedesk.auth.Platform.SubscriptionPlanPriceResponse.newBuilder()
            .setId("p1")
            .setStripePriceId("price_monthly")
            .setInterval("month")
            .setUnitAmount(2_900)
            .setCurrency("usd")
        )
        .addPrices(
          synapsedesk.auth.Platform.SubscriptionPlanPriceResponse.newBuilder()
            .setId("p2")
            .setStripePriceId("price_old")
            .setInterval("year")
        )
        .build()
    );

    var prices = service
      .getPlan(context(), "plan-1")
      .getBody()
      .data()
      .getPrices();

    assertThat(prices.get(0).getUnitAmount()).isEqualByComparingTo("2900");
    assertThat(prices.get(0).getCurrency()).isEqualTo("usd");
    assertThat(prices.get(1).getUnitAmount()).isNull();
    assertThat(prices.get(1).getCurrency()).isNull();
  }

  @Test
  void anUnreachableUsageLegDegradesTheProjectionRatherThanFailingTheCall() {
    when(stub.applyPlan(any())).thenReturn(
      ApplyPlanResponse.newBuilder()
        .addSubscribers(subscriberOver("org-1", 5_000_000_000L))
        .setDryRun(true)
        .setChangedCount(0)
        .setSkippedPinnedCount(0)
        .setOverLimitCount(0)
        .addEvaluatedDimensions("seats")
        .build()
    );
    when(usageStub.getPlatformUsage(any())).thenThrow(
      new io.grpc.StatusRuntimeException(io.grpc.Status.UNAVAILABLE)
    );

    ApplyPlanResponseDto data = service
      .applyPlan(context(), "plan-1", true)
      .getBody()
      .data();

    // Never refused — the call still answers 200 with what auth-service alone computed.
    assertThat(data.getEvaluatedDimensions()).containsExactly("seats");
    assertThat(data.getEvaluatedDimensions()).doesNotContain(
      "storage",
      "documents"
    );
    assertThat(data.getSubscribers().get(0).getOverLimit()).isEmpty();
  }

  @Test
  void aReachableUsageLegAddsStorageAndDocumentsToEvaluatedDimensionsAndFlagsAnOverage() {
    when(stub.applyPlan(any())).thenReturn(
      ApplyPlanResponse.newBuilder()
        .addSubscribers(subscriberOver("org-1", 10_000_000_000L))
        .setDryRun(true)
        .addEvaluatedDimensions("seats")
        .build()
    );
    when(usageStub.getPlatformUsage(any())).thenReturn(
      PlatformUsageResponse.newBuilder()
        .addUsage(
          TenantUsage.newBuilder()
            .setOrganizationId("org-1")
            .setUsedBytes(20_000_000_000L)
            .setDocumentCount(0)
        )
        .build()
    );

    ApplyPlanResponseDto data = service
      .applyPlan(context(), "plan-1", true)
      .getBody()
      .data();

    assertThat(data.getEvaluatedDimensions()).contains(
      "seats",
      "storage",
      "documents"
    );
    assertThat(data.getSubscribers().get(0).getOverLimit()).anyMatch(line ->
      line.startsWith("maxStorageBytes")
    );
    assertThat(data.getOverLimitCount()).isEqualTo(java.math.BigDecimal.ONE);
  }

  @Test
  void overLimitItemsCarryAuthsSeatsAndTheGatewaysStorageAndDocumentsAsData() {
    when(stub.applyPlan(any())).thenReturn(
      ApplyPlanResponse.newBuilder()
        .addSubscribers(
          PlanSubscriberProjection.newBuilder()
            .setOrganizationId("org-1")
            .setOrganizationName("Acme")
            .putAfter("maxStorageBytes", 10_000_000_000L)
            .putAfter("maxDocumentUploads", 30)
            .addOverLimit("maxAgentSeats: 12 in use, plan grants 10")
            .addOverLimitItems(
              synapsedesk.auth.Billing.OverLimit.newBuilder()
                .setDimension("SEATS")
                .setInUse(12)
                .setAllowed(10)
            )
            .build()
        )
        .setDryRun(true)
        .addEvaluatedDimensions("seats")
        .build()
    );
    when(usageStub.getPlatformUsage(any())).thenReturn(
      PlatformUsageResponse.newBuilder()
        .addUsage(
          TenantUsage.newBuilder()
            .setOrganizationId("org-1")
            .setUsedBytes(20_000_000_000L)
            .setDocumentCount(40)
        )
        .build()
    );

    var items = service
      .applyPlan(context(), "plan-1", true)
      .getBody()
      .data()
      .getSubscribers()
      .get(0)
      .getOverLimitItems();

    assertThat(items).containsExactly(
      new OverLimitItemResponseDto()
        .dimension(OverLimitItemResponseDto.DimensionEnum.SEATS)
        .inUse(java.math.BigDecimal.valueOf(12))
        .allowed(java.math.BigDecimal.valueOf(10)),
      new OverLimitItemResponseDto()
        .dimension(OverLimitItemResponseDto.DimensionEnum.STORAGE)
        .inUse(java.math.BigDecimal.valueOf(20_000_000_000L))
        .allowed(java.math.BigDecimal.valueOf(10_000_000_000L)),
      new OverLimitItemResponseDto()
        .dimension(OverLimitItemResponseDto.DimensionEnum.DOCUMENTS)
        .inUse(java.math.BigDecimal.valueOf(40))
        .allowed(java.math.BigDecimal.valueOf(30))
    );
  }

  @Test
  void aPinnedSubscriberIsNeverCheckedForOverage() {
    when(stub.applyPlan(any())).thenReturn(
      ApplyPlanResponse.newBuilder()
        .addSubscribers(
          PlanSubscriberProjection.newBuilder()
            .setOrganizationId("org-1")
            .setOrganizationName("Acme")
            .putAfter("maxStorageBytes", 1)
            .setSkippedPinned(true)
            .build()
        )
        .build()
    );
    when(usageStub.getPlatformUsage(any())).thenReturn(
      PlatformUsageResponse.newBuilder()
        .addUsage(
          TenantUsage.newBuilder()
            .setOrganizationId("org-1")
            .setUsedBytes(999_999_999L)
            .setDocumentCount(0)
        )
        .build()
    );

    ApplyPlanResponseDto data = service
      .applyPlan(context(), "plan-1", true)
      .getBody()
      .data();

    assertThat(data.getSubscribers().get(0).getOverLimit()).isEmpty();
  }

  @Test
  void usageExactlyAtTheLimitIsNotAnOverage() {
    when(stub.applyPlan(any())).thenReturn(
      ApplyPlanResponse.newBuilder()
        .addSubscribers(subscriberOver("org-1", 10_000_000_000L))
        .setDryRun(true)
        .build()
    );
    when(usageStub.getPlatformUsage(any())).thenReturn(
      PlatformUsageResponse.newBuilder()
        .addUsage(
          TenantUsage.newBuilder()
            .setOrganizationId("org-1")
            .setUsedBytes(10_000_000_000L)
            .setDocumentCount(0)
        )
        .build()
    );

    ApplyPlanResponseDto data = service
      .applyPlan(context(), "plan-1", true)
      .getBody()
      .data();

    // A limit gates the NEXT addition, not tenure at exactly the ceiling.
    assertThat(data.getSubscribers().get(0).getOverLimit()).isEmpty();
  }

  @Test
  void assigningForwardsTheOrganizationPlanAndReasonAndComposesLikeApply() {
    when(stub.assignPlan(any())).thenReturn(oneSubscriber());
    when(usageStub.getPlatformUsage(any())).thenReturn(overStorage());

    var data = service
      .assignPlan(
        context(),
        "org-1",
        new AssignPlanDto()
          .planId(new java.util.UUID(0, 7))
          .reason("Signed the agreement"),
        true
      )
      .getBody()
      .data();

    var captor = ArgumentCaptor.forClass(AssignPlanRequest.class);
    verify(stub).assignPlan(captor.capture());
    assertThat(captor.getValue().getOrganizationId()).isEqualTo("org-1");
    assertThat(captor.getValue().getPlanId()).isEqualTo(
      new java.util.UUID(0, 7).toString()
    );
    assertThat(captor.getValue().getReason()).isEqualTo("Signed the agreement");
    assertThat(captor.getValue().getDryRun()).isTrue();
    assertThat(data.getEvaluatedDimensions()).contains("storage", "documents");
    assertThat(data.getOverLimitCount()).isEqualTo(java.math.BigDecimal.ONE);
  }

  @Test
  void aPreviewWithNoReasonSendsAnEmptyOne() {
    when(stub.assignPlan(any())).thenReturn(oneSubscriber());
    when(stub.releasePlan(any())).thenReturn(oneSubscriber());
    when(usageStub.getPlatformUsage(any())).thenReturn(overStorage());

    service.assignPlan(
      context(),
      "org-1",
      new AssignPlanDto().planId(new java.util.UUID(0, 7)),
      null
    );
    service.releasePlan(context(), "org-1", new ReleasePlanDto(), null);

    var assign = ArgumentCaptor.forClass(AssignPlanRequest.class);
    verify(stub).assignPlan(assign.capture());
    assertThat(assign.getValue().getReason()).isEmpty();
    assertThat(assign.getValue().getDryRun()).isFalse();
    var release = ArgumentCaptor.forClass(ReleasePlanRequest.class);
    verify(stub).releasePlan(release.capture());
    assertThat(release.getValue().getReason()).isEmpty();
  }

  @Test
  void releasingForwardsTheOrganizationAndReasonAndComposesLikeApply() {
    when(stub.releasePlan(any())).thenReturn(oneSubscriber());
    when(usageStub.getPlatformUsage(any())).thenReturn(overStorage());

    var data = service
      .releasePlan(
        context(),
        "org-1",
        new ReleasePlanDto().reason("Self-service"),
        false
      )
      .getBody()
      .data();

    var captor = ArgumentCaptor.forClass(ReleasePlanRequest.class);
    verify(stub).releasePlan(captor.capture());
    assertThat(captor.getValue().getOrganizationId()).isEqualTo("org-1");
    assertThat(captor.getValue().getReason()).isEqualTo("Self-service");
    assertThat(captor.getValue().getDryRun()).isFalse();
    assertThat(data.getOverLimitCount()).isEqualTo(java.math.BigDecimal.ONE);
  }

  @Test
  void assigningAndReleasingRefuseBeforeTouchingThePeerWhenTheCheckFails() {
    org.mockito.Mockito.doThrow(new IllegalStateException("not a super admin"))
      .when(superAdminCheck)
      .require(any());

    assertThatThrownBy(() ->
      service.assignPlan(
        context(),
        "org-1",
        new AssignPlanDto().planId(new java.util.UUID(0, 7)),
        true
      )
    ).hasMessage("not a super admin");
    assertThatThrownBy(() ->
      service.releasePlan(context(), "org-1", new ReleasePlanDto(), true)
    ).hasMessage("not a super admin");
    org.mockito.Mockito.verifyNoInteractions(usageStub);
    org.mockito.Mockito.verify(stub, org.mockito.Mockito.never()).assignPlan(
      any()
    );
    org.mockito.Mockito.verify(stub, org.mockito.Mockito.never()).releasePlan(
      any()
    );
  }

  private static ApplyPlanResponse oneSubscriber() {
    return ApplyPlanResponse.newBuilder()
      .addSubscribers(
        PlanSubscriberProjection.newBuilder()
          .setOrganizationId("org-1")
          .setOrganizationName("Acme")
          .putChanges("maxStorageBytes", "20 -> 10")
          .putAfter("maxStorageBytes", 10)
          .build()
      )
      .setDryRun(true)
      .setChangedCount(1)
      .addEvaluatedDimensions("seats")
      .build();
  }

  private static PlatformUsageResponse overStorage() {
    return PlatformUsageResponse.newBuilder()
      .addUsage(
        TenantUsage.newBuilder().setOrganizationId("org-1").setUsedBytes(15)
      )
      .build();
  }

  @Test
  void moreThanTwelvePricesIsRefused() {
    CreatePlanDto dto = new CreatePlanDto();
    dto.setName("Enterprise");
    dto.setMaxAgentSeats(java.math.BigDecimal.TEN);
    dto.setMaxStorageBytes(java.math.BigDecimal.valueOf(1_000_000));
    dto.setMonthlyAiTokenBudget(java.math.BigDecimal.valueOf(1_000_000));
    dto.setAiModelTier(CreatePlanDto.AiModelTierEnum.FAST);
    dto.setMaxDocumentBytes(java.math.BigDecimal.valueOf(1_000_000));
    dto.setMaxAttachmentBytes(java.math.BigDecimal.valueOf(1_000_000));
    dto.setMaxDocumentUploads(java.math.BigDecimal.valueOf(1_000));
    dto.setMaxAnalyticsRangeDays(java.math.BigDecimal.valueOf(90));
    List<CreatePlanPriceDto> prices = new ArrayList<>();
    for (int i = 0; i < 13; i++) {
      CreatePlanPriceDto price = new CreatePlanPriceDto();
      price.setStripePriceId("price_" + i);
      price.setInterval(CreatePlanPriceDto.IntervalEnum.MONTH);
      prices.add(price);
    }
    dto.setPrices(prices);

    assertThatThrownBy(() -> service.createPlan(context(), dto)).isInstanceOf(
      ResponseStatusException.class
    );
  }

  private static PlanSubscriberProjection subscriberOver(
    String organizationId,
    long storageLimit
  ) {
    return PlanSubscriberProjection.newBuilder()
      .setOrganizationId(organizationId)
      .setOrganizationName("Acme")
      .putAfter("maxStorageBytes", storageLimit)
      .build();
  }
}
