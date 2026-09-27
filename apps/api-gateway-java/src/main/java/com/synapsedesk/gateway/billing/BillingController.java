package com.synapsedesk.gateway.billing;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.BillingApi;
import com.synapsedesk.gateway.generated.model.BillingControllerChangePlanV1200Response;
import com.synapsedesk.gateway.generated.model.BillingControllerCreateCheckoutSessionV1200Response;
import com.synapsedesk.gateway.generated.model.BillingControllerCreatePortalSessionV1200Response;
import com.synapsedesk.gateway.generated.model.BillingControllerGetSubscriptionV1200Response;
import com.synapsedesk.gateway.generated.model.BillingControllerListInvoicesV1200Response;
import com.synapsedesk.gateway.generated.model.BillingControllerListPlansV1200Response;
import com.synapsedesk.gateway.generated.model.ChangePlanDto;
import com.synapsedesk.gateway.generated.model.CheckoutSessionResponseDto;
import com.synapsedesk.gateway.generated.model.CreateCheckoutSessionDto;
import com.synapsedesk.gateway.generated.model.CreatePortalSessionDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.InvoiceResponseDto;
import com.synapsedesk.gateway.generated.model.PlanChangeResponseDto;
import com.synapsedesk.gateway.generated.model.PortalSessionResponseDto;
import com.synapsedesk.gateway.generated.model.SubscriptionResponseDto;
import com.synapsedesk.gateway.generated.model.TenantPlanPriceResponseDto;
import com.synapsedesk.gateway.generated.model.TenantPlanResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
 * `BillingApi` — against auth-service's `BillingService`
 * (`billing.controller.ts`, reproduced). The Stripe webhook intake
 * (`POST /webhooks/stripe`) is a separate, unauthenticated controller/tag and
 * is out of scope here.
 *
 * <p>
 * <b>Two deadlines, not one.</b> A local read (auth-service only) keeps the
 * gateway's shared 5-second default; a route that touches Stripe
 * ({@code createCheckoutSession}, {@code createPortalSession},
 * {@code listInvoices}, and {@code changePlan}'s FINAL RPC — not its
 * {@code previewPlanChange} leg, which is a local read) gets 20 seconds —
 * Node's own {@code STRIPE_DEADLINE_MS}, reproduced exactly, because Stripe's
 * own API is slow enough that the shared deadline turns an ordinary checkout
 * into a 504.
 *
 * <p>
 * <b>{@code changePlan}'s usage check fails CLOSED, the opposite of
 * {@code OrganizationsController.storageLeg}'s fail-open.</b> That method
 * degrades a REPORT; this gates a WRITE. `PlanChangeGuard.verify`, ported:
 * `previewPlanChange` names which dimensions narrow, and only THOSE dial
 * ingestion for the tenant's live usage — a widening change dials nothing and
 * so cannot be blocked by an unrelated outage. An unreadable usage leg
 * refuses (503) rather than allowing the dimension through unchecked.
 */
@RestController
public class BillingController implements BillingApi {

  private static final long DEADLINE_SECONDS = 5;
  private static final long STRIPE_DEADLINE_SECONDS = 20;

  private final BillingServiceGrpc.BillingServiceBlockingStub stub;
  private final DocumentServiceGrpc.DocumentServiceBlockingStub documentStub;
  private final CurrentUser currentUser;

  public BillingController(
      BillingServiceGrpc.BillingServiceBlockingStub stub,
      DocumentServiceGrpc.DocumentServiceBlockingStub documentStub,
      CurrentUser currentUser) {
    this.stub = stub;
    this.documentStub = documentStub;
    this.currentUser = currentUser;
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<BillingControllerGetSubscriptionV1200Response> billingControllerGetSubscriptionV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SubscriptionResponse response = withMetadata(context).getSubscription(BillingEmptyRequest.getDefaultInstance());

    return ResponseEntity.ok(
        new BillingControllerGetSubscriptionV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toSubscriptionResponseDto(response)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<BillingControllerCreateCheckoutSessionV1200Response>
      billingControllerCreateCheckoutSessionV1(CreateCheckoutSessionDto createCheckoutSessionDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response =
        withStripeMetadata(context)
            .createCheckoutSession(
                CreateCheckoutSessionRequest.newBuilder()
                    .setPriceId(createCheckoutSessionDto.getPriceId())
                    .setSuccessUrl(createCheckoutSessionDto.getSuccessUrl().toString())
                    .setCancelUrl(createCheckoutSessionDto.getCancelUrl().toString())
                    .build());

    return ResponseEntity.ok(
        new BillingControllerCreateCheckoutSessionV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new CheckoutSessionResponseDto(response.getUrl())));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<BillingControllerCreatePortalSessionV1200Response> billingControllerCreatePortalSessionV1(
      CreatePortalSessionDto createPortalSessionDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response =
        withStripeMetadata(context)
            .createPortalSession(
                CreatePortalSessionRequest.newBuilder()
                    .setReturnUrl(createPortalSessionDto.getReturnUrl().toString())
                    .build());

    return ResponseEntity.ok(
        new BillingControllerCreatePortalSessionV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new PortalSessionResponseDto(response.getUrl())));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<BillingControllerListInvoicesV1200Response> billingControllerListInvoicesV1(String limit) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    int limitValue = limit == null || limit.isEmpty() ? 0 : Integer.parseInt(limit);

    ListInvoicesResponse response =
        withStripeMetadata(context)
            .listInvoices(ListInvoicesRequest.newBuilder().setLimit(limitValue).build());

    List<InvoiceResponseDto> data = response.getItemsList().stream().map(BillingController::toInvoiceResponseDto).toList();

    return ResponseEntity.ok(
        new BillingControllerListInvoicesV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<BillingControllerListPlansV1200Response> billingControllerListPlansV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).listTenantPlans(BillingEmptyRequest.getDefaultInstance());

    List<TenantPlanResponseDto> data =
        response.getItemsList().stream().map(BillingController::toTenantPlanResponseDto).toList();

    return ResponseEntity.ok(
        new BillingControllerListPlansV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<BillingControllerChangePlanV1200Response> billingControllerChangePlanV1(
      String idempotencyKey, ChangePlanDto changePlanDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PlanChangePreviewResponse preview =
        withMetadata(context)
            .previewPlanChange(
                PlanChangeRequest.newBuilder()
                    .setPlanId(changePlanDto.getPlanId().toString())
                    .setPriceId(changePlanDto.getPriceId())
                    .build());

    enforcePlanChangeFits(preview, context);

    PlanChangeResponse response =
        withStripeMetadata(context)
            .changePlan(
                PlanChangeRequest.newBuilder()
                    .setPlanId(changePlanDto.getPlanId().toString())
                    .setPriceId(changePlanDto.getPriceId())
                    .setIdempotencyKey(idempotencyKey)
                    .build());

    return ResponseEntity.ok(
        new BillingControllerChangePlanV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Plan change submitted")
            .data(
                new PlanChangeResponseDto(
                    response.getPlanId(),
                    response.getPlanName(),
                    toOffsetDateTime(response.getEffectiveAt()),
                    response.hasCreditIssued() ? response.getCreditIssued() : null)));
  }

  /**
   * `PlanChangeGuard.verify`, ported. Seat overruns are already named by
   * {@code preview}; a WIDENING change (no narrowed dimensions) dials nothing
   * and so cannot be refused by an unrelated outage. Anything narrowed reads
   * the tenant's live usage and refuses (503) rather than allows when that
   * read fails — a gate may not degrade.
   */
  private void enforcePlanChangeFits(PlanChangePreviewResponse preview, RequestContext context) {
    if (preview.getOverLimitCount() > 0) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "This plan does not fit your current usage — " + String.join("; ", preview.getOverLimitList()));
    }

    if (preview.getNarrowedDimensionsCount() == 0) {
      return;
    }

    StorageUsageResponse usage;
    try {
      usage =
          documentStub
              .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
              .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)))
              .getStorageUsage(DocumentIdRequest.newBuilder().setId("").build());
    } catch (StatusRuntimeException failure) {
      throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE,
          String.join(" and ", preview.getNarrowedDimensionsList())
              + " usage could not be checked just now — please try again shortly");
    }

    List<String> overLimit = new ArrayList<>();
    if (preview.getNarrowedDimensionsList().contains("storage")
        && usage.getUsedBytes() > preview.getTargetMaxStorageBytes()) {
      overLimit.add(
          "maxStorageBytes: " + usage.getUsedBytes() + " used, plan grants " + preview.getTargetMaxStorageBytes());
    }
    if (preview.getNarrowedDimensionsList().contains("documents")
        && usage.getDocumentCount() > preview.getTargetMaxDocumentUploads()) {
      overLimit.add(
          "maxDocumentUploads: " + usage.getDocumentCount() + " held, plan grants "
              + preview.getTargetMaxDocumentUploads());
    }

    if (!overLimit.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "This plan does not fit your current usage — " + String.join("; ", overLimit));
    }
  }

  private static SubscriptionResponseDto toSubscriptionResponseDto(SubscriptionResponse response) {
    return new SubscriptionResponseDto(
        response.hasStripeCustomerId() ? response.getStripeCustomerId() : null,
        response.hasStripeSubscriptionId() ? response.getStripeSubscriptionId() : null,
        response.getPlanName(),
        BigDecimal.valueOf(response.getMaxAgentSeats()),
        BigDecimal.valueOf(response.getMaxStorageBytes()),
        BigDecimal.valueOf(response.getMonthlyAiTokenBudget()),
        toAiModelTierEnum(response.getAiModelTier()),
        toOffsetDateTime(response.getBillingCycleStart()),
        toStatusEnum(response.getStatus()));
  }

  private static InvoiceResponseDto toInvoiceResponseDto(InvoiceResponse invoice) {
    return new InvoiceResponseDto(
        invoice.getId(),
        invoice.getNumber(),
        BigDecimal.valueOf(invoice.getAmountDue()),
        invoice.getCurrency(),
        invoice.getStatus(),
        toOffsetDateTime(invoice.getCreated()),
        invoice.getHostedInvoiceUrl());
  }

  private static TenantPlanResponseDto toTenantPlanResponseDto(TenantPlanResponse plan) {
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
        plan.getPricesList().stream()
            .map(price -> new TenantPlanPriceResponseDto(price.getStripePriceId(), price.getInterval()))
            .toList());
  }

  private static SubscriptionResponseDto.StatusEnum toStatusEnum(OrgStatus status) {
    return SubscriptionResponseDto.StatusEnum.fromValue(status.name().replace("ORG_STATUS_", ""));
  }

  private static SubscriptionResponseDto.AiModelTierEnum toAiModelTierEnum(AiModelTier tier) {
    return SubscriptionResponseDto.AiModelTierEnum.fromValue(tier.name().replace("AI_MODEL_TIER_", ""));
  }

  private static TenantPlanResponseDto.AiModelTierEnum toTenantPlanAiModelTierEnum(AiModelTier tier) {
    return TenantPlanResponseDto.AiModelTierEnum.fromValue(tier.name().replace("AI_MODEL_TIER_", ""));
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  private BillingServiceGrpc.BillingServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  private BillingServiceGrpc.BillingServiceBlockingStub withStripeMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(STRIPE_DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
