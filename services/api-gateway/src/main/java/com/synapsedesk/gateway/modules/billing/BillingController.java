package com.synapsedesk.gateway.modules.billing;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.modules.billing.dto.rest.ChangePlanDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.CheckoutSessionResponseDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.CreateCheckoutSessionDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.CreatePortalSessionDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.InvoiceResponseDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.PlanChangeResponseDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.PortalSessionResponseDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.SubscriptionResponseDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.TenantPlanPriceResponseDto;
import com.synapsedesk.gateway.modules.billing.dto.rest.TenantPlanResponseDto;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Billing.BillingEmptyRequest;
import synapsedesk.auth.Billing.CreateCheckoutSessionRequest;
import synapsedesk.auth.Billing.CreatePortalSessionRequest;
import synapsedesk.auth.Billing.InvoiceResponse;
import synapsedesk.auth.Billing.ListInvoicesRequest;
import synapsedesk.auth.Billing.ListInvoicesResponse;
import synapsedesk.auth.Billing.PlanChangePreviewResponse;
import synapsedesk.auth.Billing.PlanChangeRequest;
import synapsedesk.auth.Billing.PlanChangeResponse;
import synapsedesk.auth.Billing.SubscriptionResponse;
import synapsedesk.auth.Billing.TenantPlanResponse;
import synapsedesk.auth.BillingServiceGrpc;
import synapsedesk.auth.Common.AiModelTier;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.ingestion.Document.DocumentIdRequest;
import synapsedesk.ingestion.Document.StorageUsageResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;

/**
 * `BillingApi` — against auth-service's `BillingService`. The Stripe webhook
 * intake (`POST /webhooks/stripe`) is a separate, unauthenticated
 * controller/tag and is out of scope here.
 *
 * <p>
 * <b>Two deadlines, not one.</b> A local read (auth-service only) keeps the
 * gateway's shared 5-second default; a route that touches Stripe
 * ({@code createCheckoutSession}, {@code createPortalSession},
 * {@code listInvoices}, and {@code changePlan}'s FINAL RPC — not its
 * {@code previewPlanChange} leg, which is a local read) gets 20 seconds,
 * because Stripe's own API is slow enough that the shared deadline turns an
 * ordinary checkout into a 504.
 *
 * <p>
 * <b>{@code changePlan}'s usage check fails CLOSED, the opposite of
 * {@code OrganizationsController.storageLeg}'s fail-open.</b> That method
 * degrades a REPORT; this gates a WRITE. `PlanChangeGuard.verify`, ported:
 * `previewPlanChange` names which dimensions narrow, and only THOSE dial
 * ingestion for the tenant's live usage — a widening change dials nothing and
 * so cannot be blocked by an unrelated outage. An unreadable usage leg
 * refuses (503) rather than allowing the dimension through unchecked.
 *
 * <p><b>`changePlan`'s {@code idempotency-key} header is OPTIONAL.</b> auth-service
 * prefers the caller's key and, without one, derives {@code
 * plan-change:<org>:<plan>:<price>} — still enough to collapse a double-click onto one
 * Stripe update. Only the caller can tell a retry from next month's identical change,
 * which is what the header is for; refusing the request without it would refuse a
 * change that is safe to make.
 */
@Tag(name = "Billing")
@RestController
@RequestMapping(ApiPaths.V1)
// Every billing route stays reachable while the workspace is suspended for non-payment, which is how it is settled.
@OrgAccessKind(OrgAccess.BILLING)
@Validated
public class BillingController {

  private static final long DEADLINE_SECONDS = 5;
  private static final long STRIPE_DEADLINE_SECONDS = 20;

  private final BillingServiceGrpc.BillingServiceBlockingStub stub;
  private final DocumentServiceGrpc.DocumentServiceBlockingStub documentStub;
  private final CurrentUser currentUser;

  public BillingController(
    BillingServiceGrpc.BillingServiceBlockingStub stub,
    DocumentServiceGrpc.DocumentServiceBlockingStub documentStub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.documentStub = documentStub;
    this.currentUser = currentUser;
  }

  @GetMapping(
    value = "/billing/subscription",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<
    ApiResponse<SubscriptionResponseDto>
  > billingControllerGetSubscriptionV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SubscriptionResponse response = withMetadata(context).getSubscription(
      BillingEmptyRequest.getDefaultInstance()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toSubscriptionResponseDto(response))
    );
  }

  @PostMapping(
    value = "/billing/checkout-session",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<CheckoutSessionResponseDto>
  > billingControllerCreateCheckoutSessionV1(
    @Valid @RequestBody CreateCheckoutSessionDto createCheckoutSessionDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withStripeMetadata(context).createCheckoutSession(
      CreateCheckoutSessionRequest.newBuilder()
        .setPriceId(createCheckoutSessionDto.getPriceId())
        .setSuccessUrl(createCheckoutSessionDto.getSuccessUrl().toString())
        .setCancelUrl(createCheckoutSessionDto.getCancelUrl().toString())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new CheckoutSessionResponseDto(response.getUrl())
      )
    );
  }

  @PostMapping(
    value = "/billing/portal-session",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<PortalSessionResponseDto>
  > billingControllerCreatePortalSessionV1(
    @Valid @RequestBody CreatePortalSessionDto createPortalSessionDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withStripeMetadata(context).createPortalSession(
      CreatePortalSessionRequest.newBuilder()
        .setReturnUrl(createPortalSessionDto.getReturnUrl().toString())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", new PortalSessionResponseDto(response.getUrl()))
    );
  }

  @GetMapping(value = "/billing/invoices", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<List<InvoiceResponseDto>>
  > billingControllerListInvoicesV1(
    @Valid @RequestParam(
      value = "limit",
      required = false
    ) @Nullable String limit
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    int limitValue =
      limit == null || limit.isEmpty() ? 0 : Integer.parseInt(limit);

    ListInvoicesResponse response = withStripeMetadata(context).listInvoices(
      ListInvoicesRequest.newBuilder().setLimit(limitValue).build()
    );

    List<InvoiceResponseDto> data = response
      .getItemsList()
      .stream()
      .map(BillingController::toInvoiceResponseDto)
      .toList();

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(value = "/billing/plans", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<
    ApiResponse<List<TenantPlanResponseDto>>
  > billingControllerListPlansV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).listTenantPlans(
      BillingEmptyRequest.getDefaultInstance()
    );

    List<TenantPlanResponseDto> data = response
      .getItemsList()
      .stream()
      .map(BillingController::toTenantPlanResponseDto)
      .toList();

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PostMapping(
    value = "/billing/plan",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404", "409", "503" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<PlanChangeResponseDto>
  > billingControllerChangePlanV1(
    @RequestHeader(
      value = "idempotency-key",
      required = false
    ) String idempotencyKey,
    @Valid @RequestBody ChangePlanDto changePlanDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PlanChangePreviewResponse preview = withMetadata(context).previewPlanChange(
      PlanChangeRequest.newBuilder()
        .setPlanId(changePlanDto.getPlanId().toString())
        .setPriceId(changePlanDto.getPriceId())
        .build()
    );

    enforcePlanChangeFits(preview, context);

    PlanChangeRequest.Builder change = PlanChangeRequest.newBuilder()
      .setPlanId(changePlanDto.getPlanId().toString())
      .setPriceId(changePlanDto.getPriceId());
    // Unset reads as "", which auth-service treats as "no key" and derives one.
    if (idempotencyKey != null) change.setIdempotencyKey(idempotencyKey);
    PlanChangeResponse response = withStripeMetadata(context).changePlan(
      change.build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Plan change submitted",
        new PlanChangeResponseDto(
          response.getPlanId(),
          response.getPlanName(),
          toOffsetDateTime(response.getEffectiveAt()),
          response.hasCreditIssued() ? response.getCreditIssued() : null
        )
      )
    );
  }

  /**
   * `PlanChangeGuard.verify`, ported. Seat overruns are already named by
   * {@code preview}; a WIDENING change (no narrowed dimensions) dials nothing
   * and so cannot be refused by an unrelated outage. Anything narrowed reads
   * the tenant's live usage and refuses (503) rather than allows when that
   * read fails — a gate may not degrade.
   */
  private void enforcePlanChangeFits(
    PlanChangePreviewResponse preview,
    RequestContext context
  ) {
    if (preview.getOverLimitCount() > 0) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "This plan does not fit your current usage — " +
          String.join("; ", preview.getOverLimitList())
      );
    }

    if (preview.getNarrowedDimensionsCount() == 0) {
      return;
    }

    StorageUsageResponse usage;
    try {
      usage = documentStub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
          MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
        )
        .getStorageUsage(DocumentIdRequest.newBuilder().setId("").build());
    } catch (StatusRuntimeException failure) {
      throw new ResponseStatusException(
        HttpStatus.SERVICE_UNAVAILABLE,
        String.join(" and ", preview.getNarrowedDimensionsList()) +
          " usage could not be checked just now — please try again shortly"
      );
    }

    List<String> overLimit = new ArrayList<>();
    if (
      preview.getNarrowedDimensionsList().contains("storage") &&
      usage.getUsedBytes() > preview.getTargetMaxStorageBytes()
    ) {
      overLimit.add(
        "maxStorageBytes: " +
          usage.getUsedBytes() +
          " used, plan grants " +
          preview.getTargetMaxStorageBytes()
      );
    }
    if (
      preview.getNarrowedDimensionsList().contains("documents") &&
      usage.getDocumentCount() > preview.getTargetMaxDocumentUploads()
    ) {
      overLimit.add(
        "maxDocumentUploads: " +
          usage.getDocumentCount() +
          " held, plan grants " +
          preview.getTargetMaxDocumentUploads()
      );
    }

    if (!overLimit.isEmpty()) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "This plan does not fit your current usage — " +
          String.join("; ", overLimit)
      );
    }
  }

  private static SubscriptionResponseDto toSubscriptionResponseDto(
    SubscriptionResponse response
  ) {
    return new SubscriptionResponseDto(
      response.hasStripeCustomerId() ? response.getStripeCustomerId() : null,
      response.hasStripeSubscriptionId()
        ? response.getStripeSubscriptionId()
        : null,
      response.getPlanName(),
      BigDecimal.valueOf(response.getMaxAgentSeats()),
      BigDecimal.valueOf(response.getMaxStorageBytes()),
      BigDecimal.valueOf(response.getMonthlyAiTokenBudget()),
      toAiModelTierEnum(response.getAiModelTier()),
      toOffsetDateTime(response.getBillingCycleStart()),
      toStatusEnum(response.getStatus())
    );
  }

  private static InvoiceResponseDto toInvoiceResponseDto(
    InvoiceResponse invoice
  ) {
    return new InvoiceResponseDto(
      invoice.getId(),
      invoice.getNumber(),
      BigDecimal.valueOf(invoice.getAmountDue()),
      invoice.getCurrency(),
      invoice.getStatus(),
      toOffsetDateTime(invoice.getCreated()),
      invoice.getHostedInvoiceUrl()
    );
  }

  private static TenantPlanResponseDto toTenantPlanResponseDto(
    TenantPlanResponse plan
  ) {
    return new TenantPlanResponseDto(
      plan.getId(),
      plan.getName(),
      BigDecimal.valueOf(plan.getMaxAgentSeats()),
      BigDecimal.valueOf(plan.getMaxStorageBytes()),
      BigDecimal.valueOf(plan.getMonthlyAiTokenBudget()),
      toTenantPlanAiModelTierEnum(plan.getAiModelTier()),
      BigDecimal.valueOf(plan.getMaxDocumentBytes()),
      BigDecimal.valueOf(plan.getMaxAttachmentBytes()),
      BigDecimal.valueOf(plan.getMaxDocumentUploads()),
      BigDecimal.valueOf(plan.getMaxAnalyticsRangeDays()),
      plan
        .getPricesList()
        .stream()
        .map(price ->
          new TenantPlanPriceResponseDto(
            price.getStripePriceId(),
            price.getInterval()
          )
        )
        .toList()
    );
  }

  private static SubscriptionResponseDto.StatusEnum toStatusEnum(
    OrgStatus status
  ) {
    return SubscriptionResponseDto.StatusEnum.fromValue(
      status.name().replace("ORG_STATUS_", "")
    );
  }

  private static SubscriptionResponseDto.AiModelTierEnum toAiModelTierEnum(
    AiModelTier tier
  ) {
    return SubscriptionResponseDto.AiModelTierEnum.fromValue(
      tier.name().replace("AI_MODEL_TIER_", "")
    );
  }

  private static TenantPlanResponseDto.AiModelTierEnum toTenantPlanAiModelTierEnum(
    AiModelTier tier
  ) {
    return TenantPlanResponseDto.AiModelTierEnum.fromValue(
      tier.name().replace("AI_MODEL_TIER_", "")
    );
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  private BillingServiceGrpc.BillingServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private BillingServiceGrpc.BillingServiceBlockingStub withStripeMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(STRIPE_DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
