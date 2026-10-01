package com.synapsedesk.gateway.organizations;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.config.InboundEmailProperties;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DeleteOrganizationDto;
import com.synapsedesk.gateway.generated.model.InboundAddressResponseDto;
import com.synapsedesk.gateway.generated.model.OffboardResponseDto;
import com.synapsedesk.gateway.generated.model.OnboardingResponseDto;
import com.synapsedesk.gateway.generated.model.OnboardingStepResponseDto;
import com.synapsedesk.gateway.generated.model.OrganizationResponseDto;
import com.synapsedesk.gateway.generated.model.OrganizationSettingsResponseDto;
import com.synapsedesk.gateway.generated.model.OrganizationUsageResponseDto;
import com.synapsedesk.gateway.generated.model.UpdateOrganizationDto;
import com.synapsedesk.gateway.generated.model.UpdateOrganizationSettingsDto;
import com.synapsedesk.gateway.generated.model.UsageMeterResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.CachedBodyRequest;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Common.AiModelTier;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.auth.Organization.CompleteOnboardingRequest;
import synapsedesk.auth.Organization.DeleteOrganizationRequest;
import synapsedesk.auth.Organization.DeleteOrganizationResponse;
import synapsedesk.auth.Organization.GetCurrentOrganizationRequest;
import synapsedesk.auth.Organization.GetOnboardingRequest;
import synapsedesk.auth.Organization.GetOrganizationSettingsRequest;
import synapsedesk.auth.Organization.GetOrganizationUsageRequest;
import synapsedesk.auth.Organization.IssueInboundTokenRequest;
import synapsedesk.auth.Organization.IssueInboundTokenResponse;
import synapsedesk.auth.Organization.OnboardingResponse;
import synapsedesk.auth.Organization.OrganizationResponse;
import synapsedesk.auth.Organization.OrganizationSettingsResponse;
import synapsedesk.auth.Organization.OrganizationUsageResponse;
import synapsedesk.auth.Organization.RevokeInboundTokenRequest;
import synapsedesk.auth.Organization.UpdateOrganizationRequest;
import synapsedesk.auth.Organization.UpdateOrganizationSettingsRequest;
import synapsedesk.auth.Organization.UsageMeter;
import synapsedesk.auth.OrganizationServiceGrpc;
import synapsedesk.ingestion.Document.DocumentIdRequest;
import synapsedesk.ingestion.Document.StorageUsageResponse;
import synapsedesk.ingestion.DocumentServiceGrpc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * `OrganizationsApi` — the caller's OWN tenant, against auth-service's
 * `OrganizationService` (`organizations.controller.ts`, reproduced). Every
 * route resolves the tenant from the verified caller context; none takes an
 * id.
 *
 * <p>
 * <b>{@code get} carries NO permission requirement</b> — Node's own choice,
 * not an omission: the End User role holds zero permission rows, so gating
 * the app shell's own workspace read on {@code organization.read} 403s the
 * first screen for every ordinary member. Authentication plus tenancy IS the
 * authorization here.
 *
 * <p>
 * <b>{@code updateSettings}'s three override fields cross a wire that carries
 * three states through two proto fields each</b> (absent = leave alone, an
 * explicit {@code null} = clear, a value = set) — Jackson binds a JSON
 * {@code null} and an absent key to the same {@code null} field, so the
 * distinction is read off the RAW request body via {@link CachedBodyRequest}
 * (populated globally by {@code JsonBodyFilter}), the same as Node reads
 * {@code undefined} vs {@code null} off the parsed body. {@code
 * allowedEmailDomains}' replace-vs-untouched flag needs the same raw
 * presence check, for the same reason.
 *
 * <p>
 * No write here evicts the cache — known gap 42, same as every other
 * {@code @Cacheable} route ported so far.
 *
 * <p><b>Migrated off `OrganizationsApi`.</b> {@code get}'s cache goes
 * through {@link CacheService#wrapTyped} — a bare {@code Class<T>} would
 * erase {@code ApiResponse<OrganizationResponseDto>}'s own type argument on
 * a cache HIT, the same defect fixed in {@code RolesController.list} and
 * {@code DepartmentsController.list}. {@code issueInboundToken} answers
 * 201, {@code revokeInboundToken} answers 204 —
 * {@code @ResponseStatus} is what tells springdoc that.
 */
@Tag(name = "Organizations")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class OrganizationsController {

  private static final long DEADLINE_SECONDS = 5;
  private static final String CACHE_SCOPE = "organizations";
  private static final long GET_CACHE_TTL_SECONDS = 60;
  private static final String INBOUND_LOCAL_PART = "support";
  private static final String STORAGE_UNAVAILABLE_REASON =
    "Storage usage could not be read just now — try again shortly";

  private final OrganizationServiceGrpc.OrganizationServiceBlockingStub stub;
  private final DocumentServiceGrpc.DocumentServiceBlockingStub documentStub;
  private final CurrentUser currentUser;
  private final CacheService cache;
  private final InboundEmailProperties inboundEmail;
  private final ObjectMapper json;

  public OrganizationsController(
    OrganizationServiceGrpc.OrganizationServiceBlockingStub stub,
    DocumentServiceGrpc.DocumentServiceBlockingStub documentStub,
    CurrentUser currentUser,
    CacheService cache,
    InboundEmailProperties inboundEmail,
    ObjectMapper json
  ) {
    this.stub = stub;
    this.documentStub = documentStub;
    this.currentUser = currentUser;
    this.cache = cache;
    this.inboundEmail = inboundEmail;
    this.json = json;
  }

  // The workspace's own record, which the billing screens read.
  @OrgAccessKind(OrgAccess.BILLING)
  @GetMapping(
    value = "/organizations/current",
    produces = { "application/json" }
  )
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<OrganizationResponseDto>
  > organizationsControllerGetV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    String key = cache.buildKey(
      context.organizationId(),
      CACHE_SCOPE,
      Map.of()
    );
    ApiResponse<OrganizationResponseDto> envelope = cache.wrapTyped(
      key,
      GET_CACHE_TTL_SECONDS,
      new tools.jackson.core.type.TypeReference<
        ApiResponse<OrganizationResponseDto>
      >() {},
      () ->
        toGetEnvelope(
          "OK",
          200,
          withMetadata(context).getCurrentOrganization(
            GetCurrentOrganizationRequest.getDefaultInstance()
          )
        )
    );

    return ResponseEntity.ok(envelope);
  }

  @PostMapping(
    value = "/organizations/current/inbound-token",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<InboundAddressResponseDto>
  > organizationsControllerIssueInboundTokenV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    IssueInboundTokenResponse response = withMetadata(
      context
    ).issueInboundToken(IssueInboundTokenRequest.getDefaultInstance());

    String address =
      INBOUND_LOCAL_PART +
      "+" +
      response.getInboundToken() +
      "@" +
      inboundEmail.domain();

    return ResponseEntity.status(201).body(
      ApiResponse.of(
        201,
        "OK",
        new InboundAddressResponseDto().inboundAddress(address)
      )
    );
  }

  @DeleteMapping(
    value = "/organizations/current/inbound-token",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<Void> organizationsControllerRevokeInboundTokenV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).revokeInboundToken(
      RevokeInboundTokenRequest.getDefaultInstance()
    );

    return ResponseEntity.noContent().build();
  }

  @PatchMapping(
    value = "/organizations/current",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<OrganizationResponseDto>
  > organizationsControllerUpdateV1(
    @Valid @RequestBody UpdateOrganizationDto updateOrganizationDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateOrganizationRequest.Builder wire =
      UpdateOrganizationRequest.newBuilder();
    if (updateOrganizationDto.getName() != null) {
      wire.setName(updateOrganizationDto.getName());
    }
    if (updateOrganizationDto.getSlug() != null) {
      wire.setSlug(updateOrganizationDto.getSlug());
    }
    if (updateOrganizationDto.getDomain() != null) {
      wire.setDomain(updateOrganizationDto.getDomain());
    }

    OrganizationResponse response = withMetadata(context).updateOrganization(
      wire.build()
    );

    return ResponseEntity.ok(toGetEnvelope("OK", 200, response));
  }

  @GetMapping(
    value = "/organizations/current/settings",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<
    ApiResponse<OrganizationSettingsResponseDto>
  > organizationsControllerGetSettingsV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    OrganizationSettingsResponse response = withMetadata(
      context
    ).getOrganizationSettings(
      GetOrganizationSettingsRequest.getDefaultInstance()
    );

    return ResponseEntity.ok(toSettingsEnvelope("OK", response, null));
  }

  @PatchMapping(
    value = "/organizations/current/settings",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<OrganizationSettingsResponseDto>
  > organizationsControllerUpdateSettingsV1(
    @Valid @RequestBody UpdateOrganizationSettingsDto updateOrganizationSettingsDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    JsonNode body = rawBody();

    UpdateOrganizationSettingsRequest.Builder wire =
      UpdateOrganizationSettingsRequest.newBuilder();
    if (updateOrganizationSettingsDto.getEnforceTwoFactor() != null) {
      wire.setEnforceTwoFactor(
        updateOrganizationSettingsDto.getEnforceTwoFactor()
      );
    }

    if (body.has("allowedEmailDomains")) {
      wire.addAllAllowedEmailDomains(
        updateOrganizationSettingsDto.getAllowedEmailDomains()
      );
      wire.setReplaceAllowedEmailDomains(true);
    }

    applyLongOverride(
      body,
      "maxDocumentBytesOverride",
      updateOrganizationSettingsDto.getMaxDocumentBytesOverride(),
      wire::setMaxDocumentBytesOverride,
      wire::setClearMaxDocumentBytesOverride
    );
    applyLongOverride(
      body,
      "maxAttachmentBytesOverride",
      updateOrganizationSettingsDto.getMaxAttachmentBytesOverride(),
      wire::setMaxAttachmentBytesOverride,
      wire::setClearMaxAttachmentBytesOverride
    );
    if (body.has("maxAttachmentsPerMessageOverride")) {
      if (body.get("maxAttachmentsPerMessageOverride").isNull()) {
        wire.setClearMaxAttachmentsPerMessageOverride(true);
      } else {
        wire.setMaxAttachmentsPerMessageOverride(
          updateOrganizationSettingsDto
            .getMaxAttachmentsPerMessageOverride()
            .intValue()
        );
      }
    }

    OrganizationSettingsResponse response = withMetadata(
      context
    ).updateOrganizationSettings(wire.build());

    String warning =
      response.getPublicDomainWarningsCount() > 0
        ? "Anyone with an address at " +
          String.join(", ", response.getPublicDomainWarningsList()) +
          " can now join this workspace automatically."
        : null;

    return ResponseEntity.ok(
      toSettingsEnvelope("Settings updated", response, warning)
    );
  }

  // Usage against the plan, read by the billing screens.
  @OrgAccessKind(OrgAccess.BILLING)
  @GetMapping(
    value = "/organizations/current/usage",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<
    ApiResponse<OrganizationUsageResponseDto>
  > organizationsControllerGetUsageV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    OrganizationUsageResponse response = withMetadata(
      context
    ).getOrganizationUsage(GetOrganizationUsageRequest.getDefaultInstance());
    UsageMeterResponseDto storage = storageLeg(context);

    OrganizationUsageResponseDto data = new OrganizationUsageResponseDto(
      toUsageMeterResponseDto(response.getSeats()),
      storage,
      toUsageMeterResponseDto(response.getAiTokens()),
      toOffsetDateTime(response.getBillingCycleStart()),
      toAiModelTierEnum(response.getAiModelTier()),
      response.getPlanName(),
      response.hasCurrentPeriodEnd()
        ? toOffsetDateTime(response.getCurrentPeriodEnd())
        : null
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  /** The id is ignored — storage usage is a WORKSPACE total, matching Node's own client. */
  private UsageMeterResponseDto storageLeg(RequestContext context) {
    try {
      StorageUsageResponse storage = documentStub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
          MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
        )
        .getStorageUsage(DocumentIdRequest.newBuilder().setId("").build());

      return new UsageMeterResponseDto()
        .available(true)
        .used(BigDecimal.valueOf(storage.getUsedBytes()))
        .limit(BigDecimal.valueOf(storage.getLimitBytes()))
        .unavailableReason(null);
    } catch (StatusRuntimeException failure) {
      return new UsageMeterResponseDto()
        .available(false)
        .used(null)
        .limit(null)
        .unavailableReason(STORAGE_UNAVAILABLE_REASON);
    }
  }

  // The onboarding checklist.
  @OrgAccessKind(OrgAccess.ONBOARDING)
  @GetMapping(
    value = "/organizations/current/onboarding",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_READ)
  public ResponseEntity<
    ApiResponse<OnboardingResponseDto>
  > organizationsControllerGetOnboardingV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    OnboardingResponse response = withMetadata(context).getOnboarding(
      GetOnboardingRequest.getDefaultInstance()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toOnboardingResponseDto(response))
    );
  }

  // Completing onboarding.
  @OrgAccessKind(OrgAccess.ONBOARDING)
  @PostMapping(
    value = "/organizations/current/onboarding/complete",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_UPDATE)
  public ResponseEntity<
    ApiResponse<OrganizationResponseDto>
  > organizationsControllerCompleteOnboardingV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    OrganizationResponse response = withMetadata(context).completeOnboarding(
      CompleteOnboardingRequest.getDefaultInstance()
    );

    return ResponseEntity.ok(
      toGetEnvelope("Onboarding complete", 200, response)
    );
  }

  @DeleteMapping(
    value = "/organizations/current",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.ORGANIZATION_DELETE)
  public ResponseEntity<
    ApiResponse<OffboardResponseDto>
  > organizationsControllerRequestOffboardV1(
    @Valid @RequestBody DeleteOrganizationDto deleteOrganizationDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DeleteOrganizationResponse response = withMetadata(
      context
    ).deleteOrganization(
      DeleteOrganizationRequest.newBuilder()
        .setReason(deleteOrganizationDto.getReason())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Offboarding requested",
        "This workspace is frozen pending review. Contact support to cancel.",
        new OffboardResponseDto(
          BigDecimal.valueOf(response.getRevokedSessionCount())
        )
      )
    );
  }

  /**
   * Presence-and-null on ONE raw JSON field, folded into a proto {@code
   * value + clear} pair — the shape {@code maxDocumentBytesOverride} and
   * {@code maxAttachmentBytesOverride} share.
   */
  private static void applyLongOverride(
    JsonNode body,
    String field,
    BigDecimal value,
    java.util.function.LongConsumer setValue,
    java.util.function.Consumer<Boolean> setClear
  ) {
    if (!body.has(field)) {
      return;
    }
    if (body.get(field).isNull() || value == null) {
      setClear.accept(true);
    } else {
      setValue.accept(value.longValue());
    }
  }

  /**
   * The raw request body, read from {@link CachedBodyRequest} — populated
   * globally by {@code JsonBodyFilter} ahead of every route that carries one
   * — rather than the bound DTO, which cannot tell an absent key apart from
   * an explicit {@code null}.
   */
  private JsonNode rawBody() {
    if (CurrentRequest.request() instanceof CachedBodyRequest cached) {
      return json.readTree(cached.body());
    }
    return json.readTree("{}");
  }

  private static ApiResponse<OrganizationResponseDto> toGetEnvelope(
    String message,
    int status,
    OrganizationResponse response
  ) {
    return ApiResponse.of(status, message, toOrganizationResponseDto(response));
  }

  private static ApiResponse<OrganizationSettingsResponseDto> toSettingsEnvelope(
    String message,
    OrganizationSettingsResponse response,
    String warning
  ) {
    return ApiResponse.of(
      200,
      message,
      warning,
      toOrganizationSettingsResponseDto(response)
    );
  }

  private static OrganizationResponseDto toOrganizationResponseDto(
    OrganizationResponse organization
  ) {
    return new OrganizationResponseDto()
      .id(organization.getId())
      .name(organization.getName())
      .slug(organization.getSlug())
      .domain(organization.hasDomain() ? organization.getDomain() : null)
      .status(toStatusEnum(organization.getStatus()))
      .enforceTwoFactor(organization.getEnforceTwoFactor())
      .allowedEmailDomains(organization.getAllowedEmailDomainsList())
      .maxAgentSeats(BigDecimal.valueOf(organization.getMaxAgentSeats()))
      .maxStorageBytes(BigDecimal.valueOf(organization.getMaxStorageBytes()))
      .monthlyAiTokenBudget(
        BigDecimal.valueOf(organization.getMonthlyAiTokenBudget())
      )
      .billingCycleStart(toOffsetDateTime(organization.getBillingCycleStart()))
      .createdAt(toOffsetDateTime(organization.getCreatedAt()))
      .updatedAt(toOffsetDateTime(organization.getUpdatedAt()));
  }

  private static OrganizationSettingsResponseDto toOrganizationSettingsResponseDto(
    OrganizationSettingsResponse settings
  ) {
    return new OrganizationSettingsResponseDto()
      .enforceTwoFactor(settings.getEnforceTwoFactor())
      .allowedEmailDomains(settings.getAllowedEmailDomainsList())
      .publicDomainWarnings(settings.getPublicDomainWarningsList())
      .maxDocumentBytesOverride(
        settings.hasMaxDocumentBytesOverride()
          ? BigDecimal.valueOf(settings.getMaxDocumentBytesOverride())
          : null
      )
      .maxAttachmentBytesOverride(
        settings.hasMaxAttachmentBytesOverride()
          ? BigDecimal.valueOf(settings.getMaxAttachmentBytesOverride())
          : null
      )
      .maxAttachmentsPerMessageOverride(
        settings.hasMaxAttachmentsPerMessageOverride()
          ? BigDecimal.valueOf(settings.getMaxAttachmentsPerMessageOverride())
          : null
      );
  }

  private static OnboardingResponseDto toOnboardingResponseDto(
    OnboardingResponse response
  ) {
    return new OnboardingResponseDto(
      response
        .getStepsList()
        .stream()
        .map(step ->
          new OnboardingStepResponseDto(
            step.getKey(),
            step.getLabel(),
            step.getComplete()
          )
        )
        .toList(),
      response.getCanComplete(),
      toOnboardingStatusEnum(response.getStatus())
    );
  }

  private static UsageMeterResponseDto toUsageMeterResponseDto(
    UsageMeter meter
  ) {
    return new UsageMeterResponseDto()
      .available(meter.getAvailable())
      .used(
        meter.getAvailable() && meter.hasUsed()
          ? BigDecimal.valueOf(meter.getUsed())
          : null
      )
      .limit(
        meter.getAvailable() && meter.hasLimit()
          ? BigDecimal.valueOf(meter.getLimit())
          : null
      )
      .unavailableReason(
        meter.hasUnavailableReason() ? meter.getUnavailableReason() : null
      );
  }

  private static OrganizationResponseDto.StatusEnum toStatusEnum(
    OrgStatus status
  ) {
    return OrganizationResponseDto.StatusEnum.fromValue(
      status.name().replace("ORG_STATUS_", "")
    );
  }

  private static OnboardingResponseDto.StatusEnum toOnboardingStatusEnum(
    OrgStatus status
  ) {
    return OnboardingResponseDto.StatusEnum.fromValue(
      status.name().replace("ORG_STATUS_", "")
    );
  }

  private static OrganizationUsageResponseDto.AiModelTierEnum toAiModelTierEnum(
    AiModelTier tier
  ) {
    return OrganizationUsageResponseDto.AiModelTierEnum.fromValue(
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

  private OrganizationServiceGrpc.OrganizationServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
