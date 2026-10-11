package com.synapsedesk.gateway.modules.roles;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.cache.CacheService;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.openapi.CachedRead;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.PermissionResponseDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Role.ListPermissionsRequest;
import synapsedesk.auth.Role.ListPermissionsResponse;
import synapsedesk.auth.RoleServiceGrpc;

/**
 * `PermissionsApi` — the seeded permission catalogue, read-only by design
 * (ADR 0038).
 *
 * <p>
 * <b>This route's cache entry is shared with a GraphQL loader.</b>
 * `PermissionCatalogueLoaderConfig` builds its key from the same
 * {@code (organizationId, "permissions", {})} triple this route does — the
 * scope string and the empty params map both have to match exactly, or the
 * two surfaces silently stop sharing one entry. Change one only with the
 * other.
 */
@Tag(name = "Permissions")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class PermissionsController {

  private static final long DEADLINE_SECONDS = 5;
  private static final String CACHE_SCOPE = "permissions";
  private static final long TTL_SECONDS = 60 * 60;

  private final RoleServiceGrpc.RoleServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public PermissionsController(
    RoleServiceGrpc.RoleServiceBlockingStub stub,
    CurrentUser currentUser,
    CacheService cache
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cache = cache;
  }

  @CachedRead(
    scope = CACHE_SCOPE,
    ttlSeconds = TTL_SECONDS,
    varyBy = CachedRead.VaryBy.TENANT
  )
  @GetMapping(value = "/permissions", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public ResponseEntity<
    ApiResponse<List<PermissionResponseDto>>
  > permissionsControllerListV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    String key = cache.buildKey(
      context.organizationId(),
      CACHE_SCOPE,
      Map.of()
    );
    PermissionResponseDto[] data = cache.wrap(
      key,
      TTL_SECONDS,
      PermissionResponseDto[].class,
      () -> {
        ListPermissionsResponse response = withMetadata(
          context
        ).listPermissions(ListPermissionsRequest.getDefaultInstance());
        return response
          .getItemsList()
          .stream()
          .map(PermissionsController::toPermissionResponseDto)
          .toArray(PermissionResponseDto[]::new);
      }
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", List.of(data)));
  }

  private static PermissionResponseDto toPermissionResponseDto(
    synapsedesk.auth.Role.PermissionResponse permission
  ) {
    return new PermissionResponseDto()
      .id(permission.getId())
      .code(PermissionResponseDto.CodeEnum.fromValue(permission.getCode()))
      .name(permission.getName())
      .group(permission.getGroup())
      .isRetired(permission.getIsRetired());
  }

  private RoleServiceGrpc.RoleServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
