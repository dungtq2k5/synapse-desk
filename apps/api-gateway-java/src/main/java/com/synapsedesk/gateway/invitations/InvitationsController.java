package com.synapsedesk.gateway.invitations;

import com.synapsedesk.gateway.auth.CookieWriter;
import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.GuestCheck;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.metrics.GuardRefusal;
import com.synapsedesk.gateway.model.AcceptInvitationDto;
import com.synapsedesk.gateway.model.CreateInvitationsDto;
import com.synapsedesk.gateway.model.CreateInvitationsResponseDto;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.FailedInvitationResponseDto;
import com.synapsedesk.gateway.model.InvitationPreviewRowResponseDto;
import com.synapsedesk.gateway.model.InvitationResponseDto;
import com.synapsedesk.gateway.model.LoginResponseDto;
import com.synapsedesk.gateway.model.PreviewInvitationResponseDto;
import com.synapsedesk.gateway.model.PreviewInvitationsDto;
import com.synapsedesk.gateway.model.PreviewInvitationsResponseDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.throttle.AuthThrottle;
import com.synapsedesk.gateway.throttle.RouteThrottle;
import com.synapsedesk.gateway.throttle.ThrottleOverride;
import com.synapsedesk.gateway.throttle.ThrottlerTiers;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.InvitationSortField;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import com.synapsedesk.gateway.web.SortDirection;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Invitation.AcceptInvitationRequest;
import synapsedesk.auth.Invitation.AcceptInvitationResponse;
import synapsedesk.auth.Invitation.CreateInvitationsRequest;
import synapsedesk.auth.Invitation.CreateInvitationsResponse;
import synapsedesk.auth.Invitation.GetInvitationRequest;
import synapsedesk.auth.Invitation.InvitationIdRequest;
import synapsedesk.auth.Invitation.InvitationPreviewRow;
import synapsedesk.auth.Invitation.InvitationResponse;
import synapsedesk.auth.Invitation.InvitationStatus;
import synapsedesk.auth.Invitation.InviteUserInput;
import synapsedesk.auth.Invitation.ListInvitationsRequest;
import synapsedesk.auth.Invitation.ListInvitationsResponse;
import synapsedesk.auth.Invitation.PreviewInvitationRequest;
import synapsedesk.auth.Invitation.PreviewInvitationResponse;
import synapsedesk.auth.Invitation.PreviewInvitationsRequest;
import synapsedesk.auth.Invitation.PreviewInvitationsResponse;
import synapsedesk.auth.InvitationServiceGrpc;

/**
 * `InvitationsApi` — against auth-service's `InvitationService`
 * (`invitations.controller.ts`, reproduced).
 *
 * <p>
 * <b>Two of the eight routes are genuinely public.</b> {@code previewByToken}
 * (masked preview, so an invitee sees who invited them before an account
 * exists) and {@code accept} (redeem + sign in) carry no
 * {@code @RequirePermission} and need no {@link RequestContext} at all — the
 * token names its own tenant. {@code accept} additionally needs {@link
 * GuestCheck}: signing in while already holding a live session would
 * silently replace it, the same reason {@code AuthController}'s login routes
 * carry the check.
 *
 * <p><b>Migrated off `InvitationsApi`.</b> {@code create} answers 201 on a
 * clean batch or 207 when some invitations failed — the generated
 * interface only ever documented 201, a pre-existing gap in the committed
 * document this migration does not close.
 */
@Tag(name = "Invitations")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class InvitationsController {

  private static final long DEADLINE_SECONDS = 5;

  private final InvitationServiceGrpc.InvitationServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final GuestCheck guestCheck;
  private final CookieWriter cookies;

  public InvitationsController(
    InvitationServiceGrpc.InvitationServiceBlockingStub stub,
    CurrentUser currentUser,
    GuestCheck guestCheck,
    CookieWriter cookies
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.guestCheck = guestCheck;
    this.cookies = cookies;
  }

  @PostMapping(
    value = "/users/invitations",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission(PermissionCodesEnum.USER_INVITE)
  public ResponseEntity<
    ApiResponse<CreateInvitationsResponseDto>
  > invitationsControllerCreateV1(
    @Valid @RequestBody CreateInvitationsDto createInvitationsDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    requireEmailVerified(context);

    CreateInvitationsRequest wire = CreateInvitationsRequest.newBuilder()
      .setOrganizationId(context.organizationIdOrEmpty())
      .setInvitedById(context.sub())
      .addAllInvitations(
        createInvitationsDto
          .getInvitations()
          .stream()
          .map(InvitationsController::toInviteUserInput)
          .toList()
      )
      .build();

    CreateInvitationsResponse response = withMetadata(
      context
    ).createInvitations(wire);

    CreateInvitationsResponseDto data = new CreateInvitationsResponseDto(
      response
        .getCreatedList()
        .stream()
        .map(InvitationsController::toInvitationResponseDto)
        .toList(),
      response
        .getFailedList()
        .stream()
        .map(failed ->
          new FailedInvitationResponseDto(failed.getEmail(), failed.getReason())
        )
        .toList(),
      response.hasBatchId() ? response.getBatchId() : null
    );

    boolean partial = !response.getFailedList().isEmpty();
    HttpStatus status = partial ? HttpStatus.MULTI_STATUS : HttpStatus.CREATED;

    return ResponseEntity.status(status).body(
      ApiResponse.of(
        status.value(),
        "OK",
        partial
          ? response.getFailedCount() + " invitation(s) could not be created"
          : null,
        data
      )
    );
  }

  @GetMapping(value = "/users/invitations", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<
    ApiResponse<PagedData<InvitationResponseDto>>
  > invitationsControllerListV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) InvitationSortField sortBy,
    @Valid @RequestParam(
      value = "status",
      required = false
    ) @Nullable String status
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy.name())
      .setSortOrder(
        sortOrder == SortDirection.DESC
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListInvitationsRequest.Builder wire = ListInvitationsRequest.newBuilder()
      .setOrganizationId(context.organizationIdOrEmpty())
      .setPage(pageRequest);
    if (status != null) {
      wire.setStatus(toInvitationStatus(status));
    }

    ListInvitationsResponse response = withMetadata(context).listInvitations(
      wire.build()
    );

    PagedData<InvitationResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(InvitationsController::toInvitationResponseDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PostMapping(
    value = "/users/invitations/{id}/resend",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @AuthThrottle
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.INVITATION_RESEND_TTL_MS,
    limit = RouteThrottle.INVITATION_RESEND_LIMIT
  )
  @RequirePermission(PermissionCodesEnum.USER_INVITE)
  public ResponseEntity<
    ApiResponse<InvitationResponseDto>
  > invitationsControllerResendV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    requireEmailVerified(context);

    InvitationResponse response = withMetadata(context).resendInvitation(
      InvitationIdRequest.newBuilder()
        .setOrganizationId(context.organizationIdOrEmpty())
        .setInvitationId(id)
        .setActorId(context.sub())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Invitation resent",
        toInvitationResponseDto(response)
      )
    );
  }

  @DeleteMapping(
    value = "/users/invitations/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_INVITE)
  public ResponseEntity<ApiResponse<Void>> invitationsControllerRevokeV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).revokeInvitation(
      InvitationIdRequest.newBuilder()
        .setOrganizationId(context.organizationIdOrEmpty())
        .setInvitationId(id)
        .setActorId(context.sub())
        .build()
    );

    return ResponseEntity.ok(ApiResponse.of(200, "Invitation revoked", null));
  }

  // Public: the invitee has no workspace yet.
  @OrgAccessKind(OrgAccess.AUTH)
  @GetMapping(
    value = "/users/invitations/token/{token}",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "404" })
  @AuthThrottle
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.INVITATION_PREVIEW_TTL_MS,
    limit = RouteThrottle.INVITATION_PREVIEW_LIMIT
  )
  public ResponseEntity<
    ApiResponse<PreviewInvitationResponseDto>
  > invitationsControllerPreviewByTokenV1(@PathVariable("token") String token) {
    HttpServletRequest request = CurrentRequest.request();

    PreviewInvitationResponse response = withOriginMetadata(
      request
    ).previewInvitation(
      PreviewInvitationRequest.newBuilder().setToken(token).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new PreviewInvitationResponseDto(
          response.getValid(),
          response.hasOrganizationName()
            ? response.getOrganizationName()
            : null,
          response.hasInviterName() ? response.getInviterName() : null,
          response.hasEmail() ? response.getEmail() : null,
          response.getRoleNamesList(),
          response.hasExpiresAt()
            ? toOffsetDateTime(response.getExpiresAt())
            : null
        )
      )
    );
  }

  // Public: the invitee has no workspace yet.
  @OrgAccessKind(OrgAccess.AUTH)
  @PostMapping(
    value = "/users/invitations/accept",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<LoginResponseDto>
  > invitationsControllerAcceptV1(
    @Valid @RequestBody AcceptInvitationDto acceptInvitationDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    guestCheck.requireNoActiveSession(request);

    AcceptInvitationRequest.Builder wire = AcceptInvitationRequest.newBuilder()
      .setToken(acceptInvitationDto.getToken())
      .setFullName(acceptInvitationDto.getFullName())
      .setPassword(acceptInvitationDto.getPassword());
    if (acceptInvitationDto.getDeviceName() != null) {
      wire.setDeviceName(acceptInvitationDto.getDeviceName());
    }

    AcceptInvitationResponse response = withOriginMetadata(
      request
    ).acceptInvitation(wire.build());

    cookies.setAccessToken(
      CurrentRequest.response(),
      response.getAccessToken()
    );
    cookies.setRefreshToken(
      CurrentRequest.response(),
      response.getRefreshToken()
    );

    boolean skipped = response.getSkippedCount() > 0;

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        skipped
          ? response.getSkippedCount() +
              " role/department assignment(s) no longer exist and were skipped"
          : null,
        new LoginResponseDto(
          UserMapper.toUserResponseDto(response.getUser()),
          false
        )
      )
    );
  }

  @PostMapping(
    value = "/users/invitations/preview",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.USER_INVITE)
  public ResponseEntity<
    ApiResponse<PreviewInvitationsResponseDto>
  > invitationsControllerPreviewBatchV1(
    @Valid @RequestBody PreviewInvitationsDto previewInvitationsDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PreviewInvitationsRequest wire = PreviewInvitationsRequest.newBuilder()
      .setOrganizationId(context.organizationIdOrEmpty())
      .addAllInvitations(
        previewInvitationsDto
          .getInvitations()
          .stream()
          .map(InvitationsController::toPreviewInviteUserInput)
          .toList()
      )
      .build();

    PreviewInvitationsResponse response = withMetadata(
      context
    ).previewInvitations(wire);

    PreviewInvitationsResponseDto data = new PreviewInvitationsResponseDto(
      response
        .getRowsList()
        .stream()
        .map(InvitationsController::toPreviewRowDto)
        .toList(),
      BigDecimal.valueOf(response.getSeatsInUse()),
      BigDecimal.valueOf(response.getMaxAgentSeats()),
      BigDecimal.valueOf(response.getSeatOverrun())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(
    value = "/users/invitations/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<
    ApiResponse<InvitationResponseDto>
  > invitationsControllerGetV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    InvitationResponse response = withMetadata(context).getInvitation(
      GetInvitationRequest.newBuilder()
        .setOrganizationId(context.organizationIdOrEmpty())
        .setInvitationId(id)
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toInvitationResponseDto(response))
    );
  }

  /**
   * `EmailVerifiedGuard`, reproduced — Java has no interceptor-layer
   * equivalent yet, so this is a handler-body check, the same shape as
   * {@code DepartmentsController}'s {@code includeDeleted} port. Stacked on
   * {@code create} and {@code resend} only: both send mail on the tenant's
   * behalf, and an unverified inviter could spray invitations from an
   * unproven address. A Super Admin has no verification flow to have
   * completed, so is exempt, matching Node.
   */
  private static void requireEmailVerified(RequestContext context) {
    if (!context.isSuperAdmin() && !context.isEmailVerified()) {
      throw GuardRefusal.refused(
        new ResponseStatusException(
          HttpStatus.FORBIDDEN,
          "Verify your email address to use this feature."
        )
      );
    }
  }

  private static InvitationStatus toInvitationStatus(String status) {
    return switch (status) {
      case "PENDING" -> InvitationStatus.INVITATION_STATUS_PENDING;
      case "ACCEPTED" -> InvitationStatus.INVITATION_STATUS_ACCEPTED;
      case "REVOKED" -> InvitationStatus.INVITATION_STATUS_REVOKED;
      case "EXPIRED" -> InvitationStatus.INVITATION_STATUS_EXPIRED;
      default -> throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "status must be one of PENDING, ACCEPTED, REVOKED, EXPIRED"
      );
    };
  }

  private static InviteUserInput toInviteUserInput(
    com.synapsedesk.gateway.model.InviteUserDto draft
  ) {
    InviteUserInput.Builder wire = InviteUserInput.newBuilder()
      .setEmail(draft.getEmail())
      .addAllRoleIds(draft.getRoleIds().stream().map(Object::toString).toList())
      .addAllDepartmentIds(
        draft.getDepartmentIds().stream().map(Object::toString).toList()
      );
    var primaryDepartmentId = draft.getPrimaryDepartmentId();
    if (primaryDepartmentId != null) {
      wire.setPrimaryDepartmentId(primaryDepartmentId.toString());
    }
    return wire.build();
  }

  private static InviteUserInput toPreviewInviteUserInput(
    com.synapsedesk.gateway.model.PreviewInviteUserDto draft
  ) {
    InviteUserInput.Builder wire = InviteUserInput.newBuilder()
      .setEmail(draft.getEmail())
      .addAllRoleIds(draft.getRoleIds())
      .addAllDepartmentIds(draft.getDepartmentIds());
    if (draft.getPrimaryDepartmentId() != null) {
      wire.setPrimaryDepartmentId(draft.getPrimaryDepartmentId());
    }
    return wire.build();
  }

  private static InvitationPreviewRowResponseDto toPreviewRowDto(
    InvitationPreviewRow row
  ) {
    return new InvitationPreviewRowResponseDto(
      row.getEmail(),
      row.getOk(),
      row.hasReason() ? row.getReason() : null,
      row.getUnknownRoleIdsList(),
      row.getUnknownDepartmentIdsList()
    );
  }

  private static InvitationResponseDto toInvitationResponseDto(
    InvitationResponse invitation
  ) {
    return new InvitationResponseDto(
      invitation.getId(),
      invitation.getEmail(),
      toStatusEnum(invitation.getStatus()),
      invitation.getRoleIdsList(),
      invitation.getDepartmentIdsList(),
      invitation.hasPrimaryDepartmentId()
        ? invitation.getPrimaryDepartmentId()
        : null,
      invitation.hasInvitedByName() ? invitation.getInvitedByName() : null,
      BigDecimal.valueOf(invitation.getResentCount()),
      toOffsetDateTime(invitation.getLastSentAt()),
      toOffsetDateTime(invitation.getExpiresAt()),
      toOffsetDateTime(invitation.getCreatedAt())
    );
  }

  private static InvitationResponseDto.StatusEnum toStatusEnum(
    InvitationStatus status
  ) {
    if (status == InvitationStatus.INVITATION_STATUS_UNSPECIFIED) {
      return InvitationResponseDto.StatusEnum.PENDING;
    }
    return InvitationResponseDto.StatusEnum.fromValue(
      status.name().replace("INVITATION_STATUS_", "")
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

  private InvitationServiceGrpc.InvitationServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private InvitationServiceGrpc.InvitationServiceBlockingStub withOriginMetadata(
    HttpServletRequest request
  ) {
    RequestOrigin origin = currentUser.origin(request);
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(origin))
      );
  }
}
