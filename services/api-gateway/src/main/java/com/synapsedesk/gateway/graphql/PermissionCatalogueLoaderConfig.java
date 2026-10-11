package com.synapsedesk.gateway.graphql;

import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.graphql.UsersLoaderConfig;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.roles.PermissionGqlDto;
import com.synapsedesk.gateway.roles.RoleMapper;
import io.grpc.stub.MetadataUtils;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.dataloader.BatchLoaderEnvironment;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.BatchLoaderRegistry;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import synapsedesk.auth.Role.ListPermissionsRequest;
import synapsedesk.auth.Role.ListPermissionsResponse;
import synapsedesk.auth.RoleServiceGrpc;

/**
 * The permission catalogue loader — the tenant's permission list, one
 * `ListPermissions` call per request. No Redis layer: none of this gateway's
 * other three loaders ({@link UsersLoaderConfig}, {@link
 * DepartmentsLoaderConfig}, {@link DocumentsLoaderConfig}) implement one
 * either, so this stays consistent with that deferred-until-needed line.
 *
 * <p><b>Keyed by TENANT, not by permission id, and always a batch of one.</b>
 * The catalogue is a single list per tenant; every key `Role.permissions`
 * (or `Query.permissions`) presents in one request is the SAME
 * organization id, so this is a `DataLoader` used purely for its
 * per-request memo — a page of fifty roles resolving `permissions` makes
 * ONE call, not fifty. Same loader contract as {@link UsersLoaderConfig}
 * otherwise: bridge at the loader boundary only, caller context carried
 * through the {@code DataLoader}'s key context.
 */
@Configuration
public class PermissionCatalogueLoaderConfig {

  private static final long DEADLINE_SECONDS = 5;

  private final RoleServiceGrpc.RoleServiceBlockingStub stub;

  public PermissionCatalogueLoaderConfig(
    BatchLoaderRegistry registry,
    RoleServiceGrpc.RoleServiceBlockingStub stub
  ) {
    this.stub = stub;

    registry
      .forTypePair(String.class, PermissionCatalogueGqlDto.class)
      .registerMappedBatchLoader((organizationIds, environment) ->
        Mono.fromCallable(() ->
          fetch(organizationIds, environment)
        ).subscribeOn(Schedulers.boundedElastic())
      );
  }

  private Map<String, PermissionCatalogueGqlDto> fetch(
    Set<String> organizationIds,
    BatchLoaderEnvironment environment
  ) {
    RequestContext context = (RequestContext) environment
      .getKeyContexts()
      .values()
      .iterator()
      .next();

    ListPermissionsResponse response = withMetadata(context).listPermissions(
      ListPermissionsRequest.getDefaultInstance()
    );

    List<PermissionGqlDto> catalogue = response
      .getItemsList()
      .stream()
      .map(RoleMapper::toPermissionGqlDto)
      .toList();
    PermissionCatalogueGqlDto value = new PermissionCatalogueGqlDto(catalogue);

    // One entry per requested key: every key in this batch is the same
    // tenant, so this is the same catalogue N times rather than N catalogues.
    Map<String, PermissionCatalogueGqlDto> byOrganizationId = new HashMap<>();
    for (String organizationId : organizationIds) {
      byOrganizationId.put(organizationId, value);
    }
    return byOrganizationId;
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
