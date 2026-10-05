package com.synapsedesk.gateway.roles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.graphql.PermissionCatalogueGqlDto;
import com.synapsedesk.gateway.graphql.PermissionCatalogueLoaderConfig;
import graphql.GraphQLContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.dataloader.DataLoaderRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.graphql.execution.DefaultBatchLoaderRegistry;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Role.ListPermissionsResponse;
import synapsedesk.auth.Role.ListRolesRequest;
import synapsedesk.auth.Role.ListRolesResponse;
import synapsedesk.auth.Role.PermissionResponse;
import synapsedesk.auth.Role.RoleIdRequest;
import synapsedesk.auth.Role.RoleResponse;
import synapsedesk.auth.RoleServiceGrpc;

/**
 * `Query.role`, `Query.roles`, `Query.permissions`, and `Role.permissions` —
 * the request each builds, the response each maps back, and (for the
 * catalogue) the batch-of-one property the loader exists for: N roles
 * resolving `permissions` on the SAME tenant make exactly one
 * `listPermissions` call.
 */
class RolesResolverTest {

  private final RoleServiceGrpc.RoleServiceBlockingStub stub = mock(
    RoleServiceGrpc.RoleServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private RolesResolver resolver;

  private static RequestContext context() {
    return new RequestContext(
      "agent-1",
      "11111111-1111-4111-8111-111111111111",
      false,
      List.of(),
      List.of("role.read"),
      true,
      "127.0.0.1",
      "test"
    );
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.require(any())).thenReturn(context());
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(mock(HttpServletRequest.class))
    );
    resolver = new RolesResolver(stub, currentUser);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void roleMapsAFoundResponse() {
    when(stub.getRole(any())).thenReturn(
      RoleResponse.newBuilder()
        .setId("role-1")
        .setName("Agent")
        .setIsSystemRole(false)
        .setUserAssigned(3)
        .addPermissionCodes("ticket.read")
        .setCreatedAt(com.google.protobuf.Timestamp.getDefaultInstance())
        .setUpdatedAt(com.google.protobuf.Timestamp.getDefaultInstance())
        .build()
    );

    RoleGqlDto result = resolver.role("role-1");

    ArgumentCaptor<RoleIdRequest> captor = ArgumentCaptor.forClass(
      RoleIdRequest.class
    );
    verify(stub).getRole(captor.capture());
    assertThat(captor.getValue().getId()).isEqualTo("role-1");
    assertThat(result.id()).isEqualTo("role-1");
    assertThat(result.permissionCodes()).containsExactly("ticket.read");
  }

  @Test
  void roleReturnsNullWhenTheStatusIsNotOk() {
    when(stub.getRole(any())).thenThrow(
      new io.grpc.StatusRuntimeException(io.grpc.Status.NOT_FOUND)
    );

    assertThat(resolver.role("missing")).isNull();
  }

  @Test
  void rolesBuildsThePageRequestAndNeverAsksForSystemRoles() {
    when(stub.listRoles(any())).thenReturn(
      ListRolesResponse.newBuilder()
        .setMeta(
          PageMeta.newBuilder()
            .setTotalItems(0)
            .setItemCount(0)
            .setItemsPerPage(10)
            .setTotalPages(0)
            .setCurrentPage(1)
            .build()
        )
        .build()
    );

    resolver.roles(10, 1, "supp");

    ArgumentCaptor<ListRolesRequest> captor = ArgumentCaptor.forClass(
      ListRolesRequest.class
    );
    verify(stub).listRoles(captor.capture());
    assertThat(captor.getValue().getIncludeSystem()).isFalse();
    assertThat(captor.getValue().getPage().getSearchTerm()).isEqualTo("supp");
  }

  private DataLoader<String, PermissionCatalogueGqlDto> loaderFor(
    RoleServiceGrpc.RoleServiceBlockingStub stub
  ) {
    DefaultBatchLoaderRegistry registry = new DefaultBatchLoaderRegistry();
    new PermissionCatalogueLoaderConfig(registry, stub);

    DataLoaderRegistry dataLoaderRegistry = new DataLoaderRegistry();
    registry.registerDataLoaders(
      dataLoaderRegistry,
      GraphQLContext.getDefault()
    );

    return dataLoaderRegistry.getDataLoader(
      PermissionCatalogueGqlDto.class.getName()
    );
  }

  @Test
  void fiveRolesOnOneTenantResolvingPermissionsProduceExactlyOneBatchCall()
    throws Exception {
    when(stub.listPermissions(any())).thenReturn(
      ListPermissionsResponse.newBuilder()
        .addItems(
          PermissionResponse.newBuilder()
            .setId("p1")
            .setCode("ticket.read")
            .setName("Read tickets")
            .setGroup("ticket")
            .setIsRetired(false)
            .build()
        )
        .addItems(
          PermissionResponse.newBuilder()
            .setId("p2")
            .setCode("ticket.write")
            .setName("Write tickets")
            .setGroup("ticket")
            .setIsRetired(true)
            .build()
        )
        .build()
    );

    DataLoader<String, PermissionCatalogueGqlDto> loader = loaderFor(stub);

    List<CompletableFuture<List<PermissionGqlDto>>> futures =
      java.util.stream.IntStream.range(0, 5)
        .mapToObj(i ->
          resolver.permissions(
            new RoleGqlDto(
              "role-" + i,
              "Role " + i,
              null,
              false,
              0,
              List.of("ticket.read"),
              null,
              null
            ),
            loader
          )
        )
        .toList();
    loader.dispatch();

    for (var future : futures) {
      List<PermissionGqlDto> permissions = future.get(5, TimeUnit.SECONDS);
      assertThat(permissions).hasSize(1);
      assertThat(permissions.get(0).code()).isEqualTo("ticket.read");
    }

    verify(stub, times(1)).listPermissions(any());
  }

  @Test
  void queryPermissionsReturnsTheWholeCatalogueUnfiltered() throws Exception {
    when(stub.listPermissions(any())).thenReturn(
      ListPermissionsResponse.newBuilder()
        .addItems(
          PermissionResponse.newBuilder()
            .setId("p1")
            .setCode("ticket.read")
            .setName("Read tickets")
            .setGroup("ticket")
            .setIsRetired(false)
            .build()
        )
        .build()
    );

    DataLoader<String, PermissionCatalogueGqlDto> loader = loaderFor(stub);

    CompletableFuture<List<PermissionGqlDto>> future = resolver.permissions(
      loader
    );
    loader.dispatch();

    assertThat(future.get(5, TimeUnit.SECONDS)).hasSize(1);
  }
}
