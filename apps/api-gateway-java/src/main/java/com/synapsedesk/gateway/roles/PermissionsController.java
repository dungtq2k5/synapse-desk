package com.synapsedesk.gateway.roles;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.generated.api.PermissionsApi;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.PermissionResponseDto;
import com.synapsedesk.gateway.generated.model.PermissionsControllerListV1200Response;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Role.ListPermissionsRequest;
import synapsedesk.auth.Role.ListPermissionsResponse;
import synapsedesk.auth.RoleServiceGrpc;

/**
 * `PermissionsApi` — the seeded permission catalogue, read-only by design
 * (ADR 0038). Ported from `permissions.controller.ts`.
 *
 * <p>
 * <b>This route's cache entry is shared with a GraphQL loader.</b>
 * `PermissionCatalogueLoaderConfig` builds its key from the same
 * {@code (organizationId, "permissions", {})} triple this route does — the
 * scope string and the empty params map both have to match exactly, or the
 * two surfaces silently stop sharing one entry. Change one only with the
 * other.
 */
@RestController
public class PermissionsController implements PermissionsApi {

  private static final long DEADLINE_SECONDS = 5;
  private static final long TTL_SECONDS = 60 * 60;

  private final RoleServiceGrpc.RoleServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public PermissionsController(
      RoleServiceGrpc.RoleServiceBlockingStub stub, CurrentUser currentUser, CacheService cache) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cache = cache;
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public ResponseEntity<PermissionsControllerListV1200Response> permissionsControllerListV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    String key = cache.buildKey(context.organizationId(), "permissions", Map.of());
    PermissionResponseDto[] data =
        cache.wrap(
            key,
            TTL_SECONDS,
            PermissionResponseDto[].class,
            () -> {
              ListPermissionsResponse response =
                  withMetadata(context).listPermissions(ListPermissionsRequest.getDefaultInstance());
              return response.getItemsList().stream()
                  .map(PermissionsController::toPermissionResponseDto)
                  .toArray(PermissionResponseDto[]::new);
            });

    return ResponseEntity.ok(
        new PermissionsControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(List.of(data)));
  }

  private static PermissionResponseDto toPermissionResponseDto(synapsedesk.auth.Role.PermissionResponse permission) {
    return new PermissionResponseDto()
        .id(permission.getId())
        .code(PermissionResponseDto.CodeEnum.fromValue(permission.getCode()))
        .name(permission.getName())
        .group(permission.getGroup())
        .isRetired(permission.getIsRetired());
  }

  private RoleServiceGrpc.RoleServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}
