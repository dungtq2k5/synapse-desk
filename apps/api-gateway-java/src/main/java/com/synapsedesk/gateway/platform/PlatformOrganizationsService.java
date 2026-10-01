package com.synapsedesk.gateway.platform;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.generated.model.CreatePlatformOrganizationDto;
import com.synapsedesk.gateway.generated.model.CreatePlatformOrganizationResponseDto;
import com.synapsedesk.gateway.generated.model.OffboardOrganizationDto;
import com.synapsedesk.gateway.generated.model.OffboardResponseDto;
import com.synapsedesk.gateway.generated.model.OrganizationResponseDto;
import com.synapsedesk.gateway.generated.model.PlatformOrganizationResponseDto;
import com.synapsedesk.gateway.generated.model.ResetBillingCycleDto;
import com.synapsedesk.gateway.generated.model.SetOrganizationStatusDto;
import com.synapsedesk.gateway.generated.model.UpdatePlatformOrganizationDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Organization.OrganizationResponse;
import synapsedesk.auth.Platform.CreatePlatformOrganizationRequest;
import synapsedesk.auth.Platform.CreatePlatformOrganizationResponse;
import synapsedesk.auth.Platform.ListPlatformOrganizationsRequest;
import synapsedesk.auth.Platform.ListPlatformOrganizationsResponse;
import synapsedesk.auth.Platform.OffboardOrganizationRequest;
import synapsedesk.auth.Platform.OffboardOrganizationResponse;
import synapsedesk.auth.Platform.PlatformOrganizationIdRequest;
import synapsedesk.auth.Platform.PlatformOrganizationResponse;
import synapsedesk.auth.Platform.ResetBillingCycleRequest;
import synapsedesk.auth.Platform.SetOrganizationStatusRequest;
import synapsedesk.auth.Platform.UpdatePlatformOrganizationRequest;
import synapsedesk.auth.PlatformServiceGrpc;

/**
 * `PlatformApi`'s organizations group (8 of 20 operations) — the first of
 * three sub-passes across this interface, split because of its size
 * (~2,474 lines of Node source). Gated by {@link SuperAdminCheck}, the same
 * door {@code PlatformJobsController} and {@code PlatformAuditLogsController}
 * already use — called first thing in every method.
 *
 * <p><b>A plain service, not yet a {@code @RestController}.</b> {@code
 * PlatformApi} is one generated interface with 20 abstract methods; a
 * concrete class declaring {@code implements PlatformApi} must implement all
 * twenty to compile (this port's own J3 rule — see {@code pending-apis.txt}'s
 * own comment on this). The routed {@code PlatformController} is assembled
 * once every group lands, delegating to this service and its two siblings;
 * until then this class carries real, sabotage-tested logic with no route
 * attached to it yet.
 *
 * <p><b>Known gap 42, same as {@code OrganizationsController}</b>: Node
 * calls {@code organizationStatus.invalidate(id)} after {@code
 * updateOrganization}/{@code setStatus}/{@code offboard}/{@code restore} to
 * drop the cached tenant-status the lifecycle interceptor reads — no write
 * here evicts that cache either, an already-accepted, tracked gap rather
 * than a new one.
 *
 * <p><b>Two validation gaps hand-replicated</b>, same root cause as every
 * other one found this session: {@code nestjs-swagger} has no OpenAPI
 * spelling for {@code @Matches} or {@code @ArrayMaxSize}, so neither reaches
 * the generated Java DTOs at all. {@link #requireSlug} reproduces the slug
 * pattern (and Node's own order: normalize — trim, lowercase — THEN
 * validate, so `ACME-CORP` still succeeds); {@link #requireAllowedEmailDomainsWithinLimit}
 * reproduces the array bound.
 */
@Component
public class PlatformOrganizationsService {

  private static final long DEADLINE_SECONDS = 5;
  private static final int MAX_ALLOWED_EMAIL_DOMAINS = 50;
  private static final Pattern SLUG_PATTERN = Pattern.compile("^[a-z0-9-]+$");

  private final PlatformServiceGrpc.PlatformServiceBlockingStub stub;
  private final SuperAdminCheck superAdminCheck;

  public PlatformOrganizationsService(
    PlatformServiceGrpc.PlatformServiceBlockingStub stub,
    SuperAdminCheck superAdminCheck
  ) {
    this.stub = stub;
    this.superAdminCheck = superAdminCheck;
  }

  public ResponseEntity<
    ApiResponse<PagedData<PlatformOrganizationResponseDto>>
  > listOrganizations(
    RequestContext context,
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted,
    String status
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

    ListPlatformOrganizationsRequest.Builder wire =
      ListPlatformOrganizationsRequest.newBuilder()
        .setPage(pageRequest)
        .setIncludeDeleted(includeDeleted != null && includeDeleted);
    if (status != null) {
      wire.setStatus(toProtoOrgStatus(status));
    }

    ListPlatformOrganizationsResponse response = withMetadata(
      context
    ).listOrganizations(wire.build());

    PagedData<PlatformOrganizationResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(PlatformOrganizationsService::toPlatformOrganizationResponseDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  public ResponseEntity<
    ApiResponse<CreatePlatformOrganizationResponseDto>
  > createOrganization(
    RequestContext context,
    CreatePlatformOrganizationDto dto
  ) {
    superAdminCheck.require(context);
    requireAllowedEmailDomainsWithinLimit(dto.getAllowedEmailDomains());

    CreatePlatformOrganizationRequest.Builder wire =
      CreatePlatformOrganizationRequest.newBuilder()
        .setName(dto.getName())
        .setSlug(requireSlug(dto.getSlug()))
        .addAllAllowedEmailDomains(
          dto.getAllowedEmailDomains() == null
            ? List.of()
            : dto.getAllowedEmailDomains()
        )
        .setAdminEmail(dto.getAdminEmail())
        .setAdminFullName(dto.getAdminFullName());
    if (dto.getDomain() != null) {
      wire.setDomain(dto.getDomain());
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

    CreatePlatformOrganizationResponse response = withMetadata(
      context
    ).createOrganization(wire.build());

    return ResponseEntity.status(HttpStatus.CREATED).body(
      ApiResponse.of(
        201,
        "OK",
        new CreatePlatformOrganizationResponseDto()
          .organization(
            toPlatformOrganizationResponseDto(response.getOrganization())
          )
          .admin(UserMapper.toUserResponseDto(response.getAdmin()))
      )
    );
  }

  public ResponseEntity<
    ApiResponse<PlatformOrganizationResponseDto>
  > getOrganization(RequestContext context, String id) {
    superAdminCheck.require(context);

    PlatformOrganizationResponse response = withMetadata(
      context
    ).getOrganization(
      PlatformOrganizationIdRequest.newBuilder().setOrganizationId(id).build()
    );

    return ok200(toPlatformOrganizationResponseDto(response), "OK");
  }

  public ResponseEntity<
    ApiResponse<PlatformOrganizationResponseDto>
  > updateOrganization(
    RequestContext context,
    String id,
    UpdatePlatformOrganizationDto dto
  ) {
    superAdminCheck.require(context);

    UpdatePlatformOrganizationRequest.Builder wire =
      UpdatePlatformOrganizationRequest.newBuilder().setOrganizationId(id);
    if (dto.getName() != null) {
      wire.setName(dto.getName());
    }
    String slug = dto.getSlug();
    if (slug != null) {
      wire.setSlug(requireSlug(slug));
    }
    if (dto.getDomain() != null) {
      wire.setDomain(dto.getDomain());
    }
    BigDecimal updatedMaxAgentSeats = dto.getMaxAgentSeats();
    if (updatedMaxAgentSeats != null) {
      wire.setMaxAgentSeats(updatedMaxAgentSeats.intValue());
    }
    BigDecimal updatedMaxStorageBytes = dto.getMaxStorageBytes();
    if (updatedMaxStorageBytes != null) {
      wire.setMaxStorageBytes(updatedMaxStorageBytes.longValue());
    }
    BigDecimal updatedMonthlyAiTokenBudget = dto.getMonthlyAiTokenBudget();
    if (updatedMonthlyAiTokenBudget != null) {
      wire.setMonthlyAiTokenBudget(updatedMonthlyAiTokenBudget.longValue());
    }

    PlatformOrganizationResponse response = withMetadata(
      context
    ).updateOrganization(wire.build());

    // Known gap 42 (see class docblock): no cache eviction here either.
    return ok200(toPlatformOrganizationResponseDto(response), "OK");
  }

  public ResponseEntity<ApiResponse<PlatformOrganizationResponseDto>> setStatus(
    RequestContext context,
    String id,
    SetOrganizationStatusDto dto
  ) {
    superAdminCheck.require(context);

    PlatformOrganizationResponse response = withMetadata(
      context
    ).setOrganizationStatus(
      SetOrganizationStatusRequest.newBuilder()
        .setOrganizationId(id)
        .setStatus(toProtoOrgStatus(dto.getStatus().getValue()))
        .setReason(dto.getReason())
        .build()
    );

    // Known gap 42 (see class docblock): no cache eviction here either.
    return ok200(toPlatformOrganizationResponseDto(response), "Status updated");
  }

  public ResponseEntity<
    ApiResponse<PlatformOrganizationResponseDto>
  > resetBillingCycle(
    RequestContext context,
    String id,
    ResetBillingCycleDto dto
  ) {
    superAdminCheck.require(context);

    PlatformOrganizationResponse response = withMetadata(
      context
    ).resetBillingCycle(
      ResetBillingCycleRequest.newBuilder()
        .setOrganizationId(id)
        .setReason(dto.getReason())
        .build()
    );

    return ok200(
      toPlatformOrganizationResponseDto(response),
      "Billing cycle reset — this desynchronizes the quota window from the Stripe invoice period and grants a fresh AI budget"
    );
  }

  public ResponseEntity<ApiResponse<OffboardResponseDto>> offboard(
    RequestContext context,
    String id,
    OffboardOrganizationDto dto
  ) {
    superAdminCheck.require(context);

    OffboardOrganizationResponse response = withMetadata(
      context
    ).offboardOrganization(
      OffboardOrganizationRequest.newBuilder()
        .setOrganizationId(id)
        .setReason(dto.getReason())
        .build()
    );

    // Known gap 42 (see class docblock): no cache eviction here either.
    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Workspace offboarded",
        new OffboardResponseDto().revokedSessionCount(
          BigDecimal.valueOf(response.getRevokedSessionCount())
        )
      )
    );
  }

  public ResponseEntity<ApiResponse<PlatformOrganizationResponseDto>> restore(
    RequestContext context,
    String id
  ) {
    superAdminCheck.require(context);

    PlatformOrganizationResponse response = withMetadata(
      context
    ).restoreOrganization(
      PlatformOrganizationIdRequest.newBuilder().setOrganizationId(id).build()
    );

    // Known gap 42 (see class docblock): no cache eviction here either.
    return ok200(
      toPlatformOrganizationResponseDto(response),
      "Workspace restored"
    );
  }

  private static ResponseEntity<
    ApiResponse<PlatformOrganizationResponseDto>
  > ok200(PlatformOrganizationResponseDto data, String message) {
    return ResponseEntity.ok(ApiResponse.of(200, message, data));
  }

  /** Node's `.trim().toLowerCase()` normalization, THEN the pattern — same order, so `ACME-CORP` still succeeds. */
  private static String requireSlug(String raw) {
    String slug = raw.trim().toLowerCase(Locale.ROOT);
    if (!SLUG_PATTERN.matcher(slug).matches()) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "slug must be lowercase letters, digits, or hyphens"
      );
    }
    return slug;
  }

  private static void requireAllowedEmailDomainsWithinLimit(
    List<String> domains
  ) {
    if (domains != null && domains.size() > MAX_ALLOWED_EMAIL_DOMAINS) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "allowedEmailDomains must contain no more than " +
          MAX_ALLOWED_EMAIL_DOMAINS +
          " elements"
      );
    }
  }

  private static OrgStatus toProtoOrgStatus(String status) {
    try {
      return OrgStatus.valueOf("ORG_STATUS_" + status);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "status must be one of the following values: ACTIVE, FROZEN, PENDING_ONBOARDING, SUSPENDED_PAST_DUE"
      );
    }
  }

  private static PlatformOrganizationResponseDto toPlatformOrganizationResponseDto(
    PlatformOrganizationResponse row
  ) {
    return new PlatformOrganizationResponseDto()
      .organization(toOrganizationResponseDto(row.getOrganization()))
      .userCount(BigDecimal.valueOf(row.getUserCount()))
      .pendingInvitationCount(
        BigDecimal.valueOf(row.getPendingInvitationCount())
      )
      .departmentCount(BigDecimal.valueOf(row.getDepartmentCount()))
      .deletedAt(
        row.hasDeletedAt() ? toOffsetDateTime(row.getDeletedAt()) : null
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
      .status(
        OrganizationResponseDto.StatusEnum.fromValue(
          organization.getStatus().name().replace("ORG_STATUS_", "")
        )
      )
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
