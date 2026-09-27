package com.synapsedesk.gateway.graphql;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.RequestContext;
import graphql.GraphQLContext;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.dataloader.DataLoaderRegistry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.graphql.execution.DefaultBatchLoaderRegistry;
import synapsedesk.auth.Role.ListPermissionsRequest;
import synapsedesk.auth.Role.ListPermissionsResponse;
import synapsedesk.auth.Role.PermissionResponse;
import synapsedesk.auth.RoleServiceGrpc;

/**
 * The batch-of-one row the loader contract requires — with the tenant-keyed
 * twist this loader adds: "one peer call for N entities" here means N ROLES
 * on the SAME tenant, not N distinct keys, since every key in a batch is the
 * caller's own organization id.
 *
 * <p>No separate "two concurrent callers" row: unlike {@link
 * UsersLoaderConfigTest}'s `ListUsersByIdsRequest`, `ListPermissionsRequest`
 * carries no tenant field on the wire, so a leaked context would be
 * unobservable from the request body here — asserting call COUNT alone
 * would be the guard-asserts-nothing shape this project already caught three
 * times. The pooled-thread bridge itself (`Mono.fromCallable(...)
 * .subscribeOn(Schedulers.boundedElastic())`) is the exact code shape {@link
 * UsersLoaderConfigTest} already sabotage-proves; this loader inherits that
 * proof rather than repeating it.
 */
class PermissionCatalogueLoaderConfigTest {

  private static RequestContext contextFor(String organizationId, String sub) {
    return new RequestContext(
        sub, organizationId, false, List.of(), List.of("role.read"), true, "127.0.0.1", "test");
  }

  private RoleServiceGrpc.RoleServiceBlockingStub mockedStub() {
    RoleServiceGrpc.RoleServiceBlockingStub stub = mock(RoleServiceGrpc.RoleServiceBlockingStub.class);
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);

    return stub;
  }

  private DataLoader<String, PermissionCatalogueGqlDto> loaderFor(RoleServiceGrpc.RoleServiceBlockingStub stub) {
    DefaultBatchLoaderRegistry registry = new DefaultBatchLoaderRegistry();
    new PermissionCatalogueLoaderConfig(registry, stub);

    DataLoaderRegistry dataLoaderRegistry = new DataLoaderRegistry();
    registry.registerDataLoaders(dataLoaderRegistry, GraphQLContext.getDefault());

    return dataLoaderRegistry.getDataLoader(PermissionCatalogueGqlDto.class.getName());
  }

  @Test
  void tenRolesOnOneTenantProduceExactlyOnePeerCallCarryingTheCallersContext() throws Exception {
    RoleServiceGrpc.RoleServiceBlockingStub stub = mockedStub();
    when(stub.listPermissions(any()))
        .thenReturn(
            ListPermissionsResponse.newBuilder()
                .addItems(
                    PermissionResponse.newBuilder()
                        .setId("p1")
                        .setCode("ticket.read")
                        .setName("Read tickets")
                        .setGroup("ticket")
                        .setIsRetired(false)
                        .build())
                .build());

    DataLoader<String, PermissionCatalogueGqlDto> loader = loaderFor(stub);
    RequestContext context = contextFor("11111111-1111-4111-8111-111111111111", "agent-1");

    // Every key IS the tenant, so ten roles resolving the catalogue is ten
    // loads of the SAME key — the batch-of-one property this loader exists
    // for, proven at the loader level rather than through a resolver.
    List<CompletableFuture<PermissionCatalogueGqlDto>> futures =
        java.util.stream.IntStream.range(0, 10)
            .mapToObj(i -> loader.load(context.organizationId(), context))
            .toList();
    loader.dispatch();
    for (var future : futures) {
      assertThat(future.get(5, TimeUnit.SECONDS).items()).hasSize(1);
    }

    ArgumentCaptor<ListPermissionsRequest> captor = ArgumentCaptor.forClass(ListPermissionsRequest.class);
    verify(stub, times(1)).listPermissions(captor.capture());
  }
}
