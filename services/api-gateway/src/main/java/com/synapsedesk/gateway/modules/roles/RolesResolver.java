package com.synapsedesk.gateway.modules.roles;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.modules.roles.dto.graphql.PermissionCatalogueGqlDto;
import com.synapsedesk.gateway.modules.roles.dto.graphql.PermissionGqlDto;
import com.synapsedesk.gateway.modules.roles.dto.graphql.RoleGqlDto;
import com.synapsedesk.gateway.modules.roles.dto.graphql.RolePageGqlDto;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Role.ListRolesRequest;
import synapsedesk.auth.Role.ListRolesResponse;
import synapsedesk.auth.Role.RoleIdRequest;
import synapsedesk.auth.Role.RoleResponse;
import synapsedesk.auth.RoleServiceGrpc;

/**
 * `Query.role`, `Query.roles`, `Query.permissions`, and the `Role.permissions`
 * edge.
 *
 * <p>`Role.users` is deliberately absent: it would
 * need a batch RPC that does not exist, against the same precedent as
 * `Ticket.messages` — `userAssigned` is the count and `GET /users?roleId=`
 * is the list.
 */
@Controller
public class RolesResolver {

  private static final long DEADLINE_SECONDS = 5;

  private final RoleServiceGrpc.RoleServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public RolesResolver(
    RoleServiceGrpc.RoleServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public RoleGqlDto role(@Argument String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    try {
      RoleResponse response = withMetadata(context).getRole(
        RoleIdRequest.newBuilder().setId(id).build()
      );
      return RoleMapper.toRoleGqlDto(response);
    } catch (StatusRuntimeException notFoundOrForbidden) {
      // Null rather than an error, matching `Query.role`'s own schema
      // description: does-not-exist and not-in-this-tenant are deliberately
      // indistinguishable.
      return null;
    }
  }

  @QueryMapping(name = "roles")
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public RolePageGqlDto roles(
    @Argument int first,
    @Argument int page,
    @Argument String searchTerm
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page)
      .setLimit(first)
      .setSortOrder(SortOrder.SORT_ORDER_ASC);
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListRolesResponse response = withMetadata(context).listRoles(
      ListRolesRequest.newBuilder()
        .setPage(pageRequest)
        // Matching the REST default, not the schema's convenience: a
        // caller who wants system roles has to ask, and this surface
        // does not offer that as an argument.
        .setIncludeSystem(false)
        .build()
    );

    return RoleMapper.toRolePageGqlDto(response);
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public CompletableFuture<List<PermissionGqlDto>> permissions(
    DataLoader<String, PermissionCatalogueGqlDto> loader
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    return loader
      .load(context.organizationIdOrEmpty(), context)
      .thenApply(PermissionCatalogueGqlDto::items);
  }

  /**
   * `Role.permissions` — the codes resolved against the catalogue, filtered
   * locally rather than fetched per role: the loader makes a page of roles
   * ONE call, and the filter is a lookup over a few dozen entries.
   */
  @SchemaMapping(typeName = "Role", field = "permissions")
  public CompletableFuture<List<PermissionGqlDto>> permissions(
    RoleGqlDto role,
    DataLoader<String, PermissionCatalogueGqlDto> loader
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    Set<String> held = new HashSet<>(role.permissionCodes());

    // Keyed on the TENANT, not the role: every role on a page shares the same
    // catalogue, and passing the role id would reinstate the N calls this
    // loader exists to collapse.
    return loader
      .load(context.organizationIdOrEmpty(), context)
      .thenApply(catalogue ->
        catalogue
          .items()
          .stream()
          .filter(p -> held.contains(p.code()))
          .toList()
      );
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
