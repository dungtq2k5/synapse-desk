package com.synapsedesk.gateway.platform;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.model.ApplyPlanResponseDto;
import com.synapsedesk.gateway.model.CreatePlanDto;
import com.synapsedesk.gateway.model.DeletePlanResponseDto;
import com.synapsedesk.gateway.model.PlanSubscriberProjectionResponseDto;
import com.synapsedesk.gateway.model.SubscriptionPlanPriceResponseDto;
import com.synapsedesk.gateway.model.SubscriptionPlanResponseDto;
import com.synapsedesk.gateway.model.UpdatePlanDto;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import com.synapsedesk.gateway.web.RawJsonBody;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.AiModelTier;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Platform.ApplyPlanRequest;
import synapsedesk.auth.Platform.ApplyPlanResponse;
import synapsedesk.auth.Platform.CreatePlanPriceInput;
import synapsedesk.auth.Platform.CreatePlanRequest;
import synapsedesk.auth.Platform.DeletePlanResponse;
import synapsedesk.auth.Platform.ListPlansRequest;
import synapsedesk.auth.Platform.ListPlansResponse;
import synapsedesk.auth.Platform.PlanIdRequest;
import synapsedesk.auth.Platform.PlanSubscriberProjection;
import synapsedesk.auth.Platform.SubscriptionPlanResponse;
import synapsedesk.auth.Platform.UpdatePlanRequest;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.ingestion.IngestionPlatformServiceGrpc;
import synapsedesk.ingestion.Platform.PlatformUsageRequest;
import synapsedesk.ingestion.Platform.PlatformUsageResponse;
import synapsedesk.ingestion.Platform.TenantUsage;

/**
 * `PlatformApi`'s plan-catalogue group (6 of 20 operations) — the third and
 * final sub-pass across this interface.
 *
 * <p><b>{@code applyPlan}'s usage leg degrades, never refuses.</b> Node's
 * own {@code plan-usage.composer.ts}: {@code if ('failure' in usage) return
 * projection;} — an unreachable ingestion-service answers the un-enriched
 * projection, not an error. This is the "reporting" side of the rule this
 * port has been encoding (degrade what you report, refuse what you
 * authorise): {@code applyPlan} with {@code dryRun=false} DOES authorise a
 * write, but that write is auth-service's seats-and-quota grant, computed
 * entirely from auth's own tables — the usage leg only ANNOTATES the
 * response with current storage/document consumption, the same "extra
 * context, not a precondition" role {@code excludes} plays in the finance
 * snapshot. A failed leg is visible exactly the way `excludes` makes a
 * degraded number visible: {@code storage}/{@code documents} simply do not
 * appear in {@code evaluatedDimensions}, so a zero {@code overLimitCount}
 * during an ingestion outage is never confused with "nobody is over."
 *
 * <p><b>Both dry-run and apply share this exact code path</b> — the same
 * property Node's own docblock asserts: a dry run enriched by different
 * code from the apply it predicts would be believed exactly when it was
 * wrong.
 *
 * <p><b>{@code CreatePlanDto.prices}' {@code @ArrayMaxSize} is dropped</b>,
 * same generator-validation family as the rest of this session's findings —
 * replicated by hand via {@link #requirePricesWithinLimit}.
 */
@Component
public class PlatformPlansService {

  private static final Logger LOG = LoggerFactory.getLogger(
    PlatformPlansService.class
  );

  private static final long DEADLINE_SECONDS = 5;
  private static final int MAX_PLAN_PRICES = 12;
  private static final Set<String> INGESTION_DIMENSIONS = Set.of(
    "storage",
    "documents"
  );

  private final PlatformServiceGrpc.PlatformServiceBlockingStub stub;
  private final IngestionPlatformServiceGrpc.IngestionPlatformServiceBlockingStub usageStub;
  private final SuperAdminCheck superAdminCheck;
  private final RawJsonBody rawBody;

  public PlatformPlansService(
    PlatformServiceGrpc.PlatformServiceBlockingStub stub,
    IngestionPlatformServiceGrpc.IngestionPlatformServiceBlockingStub usageStub,
    SuperAdminCheck superAdminCheck,
    RawJsonBody rawBody
  ) {
    this.stub = stub;
    this.usageStub = usageStub;
    this.superAdminCheck = superAdminCheck;
    this.rawBody = rawBody;
  }

  public ResponseEntity<
    ApiResponse<PagedData<SubscriptionPlanResponseDto>>
  > listPlans(
    RequestContext context,
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeInactive,
    Boolean includeDeleted
  ) {
    superAdminCheck.require(context);

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equalsIgnoreCase(sortOrder)
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListPlansRequest wire = ListPlansRequest.newBuilder()
      .setPage(pageRequest)
      .setIncludeInactive(includeInactive != null && includeInactive)
      .setIncludeDeleted(includeDeleted != null && includeDeleted)
      .build();

    ListPlansResponse response = withMetadata(context).listPlans(wire);

    PagedData<SubscriptionPlanResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(PlatformPlansService::toSubscriptionPlanResponseDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  public ResponseEntity<ApiResponse<SubscriptionPlanResponseDto>> createPlan(
    RequestContext context,
    CreatePlanDto dto
  ) {
    superAdminCheck.require(context);
    requirePricesWithinLimit(dto.getPrices());

    CreatePlanRequest.Builder wire = CreatePlanRequest.newBuilder()
      .setName(dto.getName())
      .setMaxAgentSeats(dto.getMaxAgentSeats().intValue())
      .setMaxStorageBytes(dto.getMaxStorageBytes().longValue())
      .setMonthlyAiTokenBudget(dto.getMonthlyAiTokenBudget().longValue())
      .setAiModelTier(toProtoAiModelTier(dto.getAiModelTier().getValue()))
      .setMaxDocumentBytes(dto.getMaxDocumentBytes().longValue())
      .setMaxAttachmentBytes(dto.getMaxAttachmentBytes().longValue())
      .setMaxDocumentUploads(dto.getMaxDocumentUploads().intValue())
      .setMaxAnalyticsRangeDays(dto.getMaxAnalyticsRangeDays().intValue())
      .setIsActive(dto.getIsActive() != null && dto.getIsActive())
      .addAllPrices(
        dto.getPrices() == null
          ? List.of()
          : dto
              .getPrices()
              .stream()
              .map(price ->
                CreatePlanPriceInput.newBuilder()
                  .setStripePriceId(price.getStripePriceId())
                  .setInterval(price.getInterval().getValue())
                  .build()
              )
              .toList()
      );
    if (dto.getStripeProductId() != null) {
      wire.setStripeProductId(dto.getStripeProductId());
    }

    SubscriptionPlanResponse response = withMetadata(context).createPlan(
      wire.build()
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(
      ApiResponse.of(201, "OK", toSubscriptionPlanResponseDto(response))
    );
  }

  public ResponseEntity<ApiResponse<SubscriptionPlanResponseDto>> getPlan(
    RequestContext context,
    String id
  ) {
    superAdminCheck.require(context);

    SubscriptionPlanResponse response = withMetadata(context).getPlan(
      PlanIdRequest.newBuilder().setPlanId(id).build()
    );

    return okPlan(response, "OK");
  }

  public ResponseEntity<ApiResponse<SubscriptionPlanResponseDto>> updatePlan(
    RequestContext context,
    String id,
    UpdatePlanDto dto
  ) {
    superAdminCheck.require(context);

    UpdatePlanRequest.Builder wire = UpdatePlanRequest.newBuilder()
      .setPlanId(id)
      .setClearStripeProductId(
        Boolean.TRUE.equals(dto.getClearStripeProductId())
      );
    if (dto.getName() != null) {
      wire.setName(dto.getName());
    }
    if (dto.getStripeProductId() != null) {
      wire.setStripeProductId(dto.getStripeProductId());
    }
    BigDecimal maxAgentSeats = dto.getMaxAgentSeats();
    if (maxAgentSeats != null) {
      wire.setMaxAgentSeats(maxAgentSeats.intValue());
    }
    BigDecimal maxStorageBytes = dto.getMaxStorageBytes();
    if (maxStorageBytes != null) {
      wire.setMaxStorageBytes(maxStorageBytes.longValue());
    }
    BigDecimal monthlyAiTokenBudget = dto.getMonthlyAiTokenBudget();
    if (monthlyAiTokenBudget != null) {
      wire.setMonthlyAiTokenBudget(monthlyAiTokenBudget.longValue());
    }
    var aiModelTier = dto.getAiModelTier();
    if (aiModelTier != null) {
      wire.setAiModelTier(toProtoAiModelTier(aiModelTier.getValue()));
    } else if (rawBody.isNull("aiModelTier")) {
      // A literal `null` clears the tier; leaving it out leaves it alone.
      wire.setAiModelTier(AiModelTier.AI_MODEL_TIER_UNSPECIFIED);
    }
    BigDecimal maxDocumentBytes = dto.getMaxDocumentBytes();
    if (maxDocumentBytes != null) {
      wire.setMaxDocumentBytes(maxDocumentBytes.longValue());
    }
    BigDecimal maxAttachmentBytes = dto.getMaxAttachmentBytes();
    if (maxAttachmentBytes != null) {
      wire.setMaxAttachmentBytes(maxAttachmentBytes.longValue());
    }
    BigDecimal maxDocumentUploads = dto.getMaxDocumentUploads();
    if (maxDocumentUploads != null) {
      wire.setMaxDocumentUploads(maxDocumentUploads.intValue());
    }
    BigDecimal maxAnalyticsRangeDays = dto.getMaxAnalyticsRangeDays();
    if (maxAnalyticsRangeDays != null) {
      wire.setMaxAnalyticsRangeDays(maxAnalyticsRangeDays.intValue());
    }
    if (dto.getIsActive() != null) {
      wire.setIsActive(dto.getIsActive());
    }

    SubscriptionPlanResponse response = withMetadata(context).updatePlan(
      wire.build()
    );

    return okPlan(response, "OK");
  }

  public ResponseEntity<ApiResponse<DeletePlanResponseDto>> deletePlan(
    RequestContext context,
    String id
  ) {
    superAdminCheck.require(context);

    DeletePlanResponse response = withMetadata(context).deletePlan(
      PlanIdRequest.newBuilder().setPlanId(id).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new DeletePlanResponseDto().deleted(response.getDeleted())
      )
    );
  }

  public ResponseEntity<ApiResponse<ApplyPlanResponseDto>> applyPlan(
    RequestContext context,
    String id,
    Boolean dryRun
  ) {
    superAdminCheck.require(context);

    ApplyPlanResponse response = withMetadata(context).applyPlan(
      ApplyPlanRequest.newBuilder()
        .setPlanId(id)
        .setDryRun(dryRun != null && dryRun)
        .build()
    );

    ApplyPlanResponseDto projection = toApplyPlanResponseDto(response);

    List<String> organizationIds = response
      .getSubscribersList()
      .stream()
      .map(PlanSubscriberProjection::getOrganizationId)
      .toList();
    Map<String, TenantUsage> usage = usageFor(organizationIds, context);
    ApplyPlanResponseDto enriched =
      usage == null ? projection : enrichWithUsage(projection, usage);

    return ResponseEntity.ok(ApiResponse.of(200, "OK", enriched));
  }

  /** `null` is the failed leg (degrade); an empty map is a genuine zero-subscriber success. */
  private Map<String, TenantUsage> usageFor(
    List<String> organizationIds,
    RequestContext context
  ) {
    if (organizationIds.isEmpty()) {
      return Map.of();
    }
    try {
      PlatformUsageResponse response = usageStub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
          MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
        )
        .getPlatformUsage(
          PlatformUsageRequest.newBuilder()
            .addAllOrganizationIds(organizationIds)
            .build()
        );

      return response
        .getUsageList()
        .stream()
        .collect(
          java.util.stream.Collectors.toMap(
            TenantUsage::getOrganizationId,
            row -> row
          )
        );
    } catch (RuntimeException e) {
      LOG.warn("Usage leg 'ingestion-service' unavailable: {}", e.getMessage());
      // `null`, not `Map.of()`, is deliberate: it is the signal the caller
      // uses to skip enrichment entirely rather than enrich with no data —
      // see `anUnreachableUsageLegDegradesTheProjectionRatherThanFailingTheCall`.
      return null;
    }
  }

  private static ApplyPlanResponseDto enrichWithUsage(
    ApplyPlanResponseDto projection,
    Map<String, TenantUsage> usage
  ) {
    List<PlanSubscriberProjectionResponseDto> subscribers = new ArrayList<>();
    for (PlanSubscriberProjectionResponseDto row : projection.getSubscribers()) {
      if (Boolean.TRUE.equals(row.getSkippedPinned())) {
        subscribers.add(row);
        continue;
      }

      TenantUsage used = usage.get(row.getOrganizationId());
      if (used == null) {
        subscribers.add(row);
        continue;
      }

      List<String> overLimit = new ArrayList<>(row.getOverLimit());
      Long storageLimit = afterValue(row.getAfter(), "maxStorageBytes");
      if (
        storageLimit != null && exceedsLimit(used.getUsedBytes(), storageLimit)
      ) {
        overLimit.add(
          "maxStorageBytes: " +
            used.getUsedBytes() +
            " used, plan grants " +
            storageLimit
        );
      }
      Long documentLimit = afterValue(row.getAfter(), "maxDocumentUploads");
      if (
        documentLimit != null &&
        exceedsLimit(used.getDocumentCount(), documentLimit)
      ) {
        overLimit.add(
          "maxDocumentUploads: " +
            used.getDocumentCount() +
            " held, plan grants " +
            documentLimit
        );
      }

      subscribers.add(
        new PlanSubscriberProjectionResponseDto()
          .organizationId(row.getOrganizationId())
          .organizationName(row.getOrganizationName())
          .changes(row.getChanges())
          .after(row.getAfter())
          .overLimit(overLimit)
          .skippedPinned(row.getSkippedPinned())
          .budgetDeferred(row.getBudgetDeferred())
      );
    }

    Set<String> evaluatedDimensions = new LinkedHashSet<>(
      projection.getEvaluatedDimensions()
    );
    evaluatedDimensions.addAll(INGESTION_DIMENSIONS);

    return new ApplyPlanResponseDto()
      .subscribers(subscribers)
      .dryRun(projection.getDryRun())
      .changedCount(projection.getChangedCount())
      .skippedPinnedCount(projection.getSkippedPinnedCount())
      .overLimitCount(
        BigDecimal.valueOf(
          subscribers
            .stream()
            .filter(row -> !row.getOverLimit().isEmpty())
            .count()
        )
      )
      .evaluatedDimensions(new ArrayList<>(evaluatedDimensions));
  }

  /** The target grant for one column, or `null` when the column is not changing — a map read, never a parsed display string. */
  private static Long afterValue(Map<String, BigDecimal> after, String field) {
    BigDecimal value = after.get(field);
    return value == null ? null : value.longValue();
  }

  private static boolean exceedsLimit(long value, long limit) {
    if (limit < 0) {
      throw new IllegalStateException(
        "Refusing to compare against an unusable limit: " + limit
      );
    }
    return value > limit;
  }

  private static void requirePricesWithinLimit(List<?> prices) {
    if (prices != null && prices.size() > MAX_PLAN_PRICES) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "prices must contain no more than " + MAX_PLAN_PRICES + " elements"
      );
    }
  }

  private static AiModelTier toProtoAiModelTier(String value) {
    return AiModelTier.valueOf("AI_MODEL_TIER_" + value);
  }

  private static ResponseEntity<
    ApiResponse<SubscriptionPlanResponseDto>
  > okPlan(SubscriptionPlanResponse response, String message) {
    return ResponseEntity.ok(
      ApiResponse.of(200, message, toSubscriptionPlanResponseDto(response))
    );
  }

  private static SubscriptionPlanResponseDto toSubscriptionPlanResponseDto(
    SubscriptionPlanResponse plan
  ) {
    // `UNSPECIFIED` reads as the product default, never as a wire value — same
    // fallback Node's `fromProtoAiModelTier(...) ?? DEFAULT_AI_MODEL_TIER` uses.
    String aiModelTier =
      plan.getAiModelTier() == AiModelTier.AI_MODEL_TIER_UNSPECIFIED
        ? "FAST"
        : plan.getAiModelTier().name().replace("AI_MODEL_TIER_", "");

    return new SubscriptionPlanResponseDto()
      .id(plan.getId())
      .name(plan.getName())
      .stripeProductId(
        plan.hasStripeProductId() ? plan.getStripeProductId() : null
      )
      .maxAgentSeats(BigDecimal.valueOf(plan.getMaxAgentSeats()))
      .maxStorageBytes(BigDecimal.valueOf(plan.getMaxStorageBytes()))
      .monthlyAiTokenBudget(BigDecimal.valueOf(plan.getMonthlyAiTokenBudget()))
      .aiModelTier(aiModelTier)
      .maxDocumentBytes(BigDecimal.valueOf(plan.getMaxDocumentBytes()))
      .maxAttachmentBytes(BigDecimal.valueOf(plan.getMaxAttachmentBytes()))
      .maxDocumentUploads(BigDecimal.valueOf(plan.getMaxDocumentUploads()))
      .maxAnalyticsRangeDays(
        BigDecimal.valueOf(plan.getMaxAnalyticsRangeDays())
      )
      .isActive(plan.getIsActive())
      .prices(
        plan
          .getPricesList()
          .stream()
          .map(price ->
            new SubscriptionPlanPriceResponseDto()
              .id(price.getId())
              .stripePriceId(price.getStripePriceId())
              .interval(price.getInterval())
          )
          .toList()
      )
      .subscriberCount(BigDecimal.valueOf(plan.getSubscriberCount()))
      .createdAt(toOffsetDateTime(plan.getCreatedAt()))
      .updatedAt(toOffsetDateTime(plan.getUpdatedAt()))
      .deletedAt(
        plan.hasDeletedAt() ? toOffsetDateTime(plan.getDeletedAt()) : null
      );
  }

  private static ApplyPlanResponseDto toApplyPlanResponseDto(
    ApplyPlanResponse response
  ) {
    return new ApplyPlanResponseDto()
      .subscribers(
        response
          .getSubscribersList()
          .stream()
          .map(row ->
            new PlanSubscriberProjectionResponseDto()
              .organizationId(row.getOrganizationId())
              .organizationName(row.getOrganizationName())
              .changes(row.getChangesMap())
              .after(
                row
                  .getAfterMap()
                  .entrySet()
                  .stream()
                  .collect(
                    java.util.stream.Collectors.toMap(
                      Map.Entry::getKey,
                      entry -> BigDecimal.valueOf(entry.getValue())
                    )
                  )
              )
              .overLimit(row.getOverLimitList())
              .skippedPinned(row.getSkippedPinned())
              .budgetDeferred(row.getBudgetDeferred())
          )
          .toList()
      )
      .dryRun(response.getDryRun())
      .changedCount(BigDecimal.valueOf(response.getChangedCount()))
      .skippedPinnedCount(BigDecimal.valueOf(response.getSkippedPinnedCount()))
      .overLimitCount(BigDecimal.valueOf(response.getOverLimitCount()))
      .evaluatedDimensions(response.getEvaluatedDimensionsList());
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  private PlatformServiceGrpc.PlatformServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
