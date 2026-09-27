package com.synapsedesk.gateway.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.departments.DepartmentGqlDto;
import com.synapsedesk.gateway.graphql.DepartmentsLoaderConfig;
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
import synapsedesk.auth.Common.Gender;
import synapsedesk.auth.Common.UserResponse;
import synapsedesk.auth.Department.DepartmentResponse;
import synapsedesk.auth.Department.ListDepartmentsByIdsRequest;
import synapsedesk.auth.Department.ListDepartmentsByIdsResponse;
import synapsedesk.auth.DepartmentServiceGrpc;
import synapsedesk.auth.User.CurrentUserResponse;
import synapsedesk.auth.User.GetCurrentUserRequest;
import synapsedesk.auth.User.ListUsersRequest;
import synapsedesk.auth.User.ListUsersResponse;
import synapsedesk.auth.User.UserIdRequest;
import synapsedesk.auth.User.UserSummaryResponse;
import synapsedesk.auth.UserServiceGrpc;

/**
 * `Query.me`, `Query.user`, `Query.users`, `User.departmentCount`, and
 * `User.departments` — the request each builds, the envelope each flattens,
 * and (for `departments`) the same MAX_EDGE_LIST-before-the-batch property
 * `DocumentsResolver.departments` proves.
 */
class UsersResolverTest {

  private final UserServiceGrpc.UserServiceBlockingStub stub = mock(UserServiceGrpc.UserServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private UsersResolver resolver;

  private static RequestContext context() {
    return new RequestContext(
        "user-1",
        "11111111-1111-4111-8111-111111111111",
        false,
        List.of(),
        List.of("user.read"),
        true,
        "127.0.0.1",
        "test");
  }

  private static UserResponse.Builder baseUser(String id) {
    return UserResponse.newBuilder()
        .setId(id)
        .setFullName("Ada Lovelace")
        .setEmail("ada@example.com")
        .setIsEmailVerified(true)
        .setIsPhoneVerified(false)
        .setGender(Gender.GENDER_FEMALE)
        .setIsLocked(false)
        .setIsTwoFactorEnabled(false)
        .setCreatedAt(com.google.protobuf.Timestamp.getDefaultInstance())
        .setUpdatedAt(com.google.protobuf.Timestamp.getDefaultInstance());
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.require(any())).thenReturn(context());
    RequestContextHolder.setRequestAttributes(
        new ServletRequestAttributes(mock(HttpServletRequest.class)));
    resolver = new UsersResolver(stub, currentUser);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void meFlattensTheCurrentUserEnvelope() {
    when(stub.getCurrentUser(any()))
        .thenReturn(
            CurrentUserResponse.newBuilder()
                .setUser(baseUser("user-1"))
                .addDepartmentIds("dept-1")
                .addDepartmentIds("dept-2")
                .build());

    UserGqlDto result = resolver.me();

    ArgumentCaptor<GetCurrentUserRequest> captor = ArgumentCaptor.forClass(GetCurrentUserRequest.class);
    verify(stub).getCurrentUser(captor.capture());
    assertThat(captor.getValue().getUserId()).isEqualTo("user-1");
    assertThat(result.id()).isEqualTo("user-1");
    // The bug Node's own docblock warns about: `departmentIds` is a SIBLING
    // of `user` on the envelope, not a field of it — a mapper that read
    // `current.user` alone would answer `[]` here.
    assertThat(result.departmentIds()).containsExactly("dept-1", "dept-2");
    assertThat(result.gender()).isEqualTo(GenderGql.FEMALE);
  }

  @Test
  void userFlattensTheSummaryEnvelope() {
    when(stub.getUser(any()))
        .thenReturn(
            UserSummaryResponse.newBuilder().setUser(baseUser("user-2")).addDepartmentIds("dept-1").build());

    UserGqlDto result = resolver.user("user-2");

    ArgumentCaptor<UserIdRequest> captor = ArgumentCaptor.forClass(UserIdRequest.class);
    verify(stub).getUser(captor.capture());
    assertThat(captor.getValue().getId()).isEqualTo("user-2");
    assertThat(result.id()).isEqualTo("user-2");
    assertThat(result.departmentIds()).containsExactly("dept-1");
  }

  @Test
  void userReturnsNullWhenTheStatusIsNotOk() {
    when(stub.getUser(any())).thenThrow(new io.grpc.StatusRuntimeException(io.grpc.Status.NOT_FOUND));

    assertThat(resolver.user("missing")).isNull();
  }

  @Test
  void usersNeverAsksForDeletedUsers() {
    when(stub.listUsers(any()))
        .thenReturn(
            ListUsersResponse.newBuilder()
                .setMeta(synapsedesk.auth.Common.PageMeta.getDefaultInstance())
                .build());

    resolver.users(10, 1, "ada");

    ArgumentCaptor<ListUsersRequest> captor = ArgumentCaptor.forClass(ListUsersRequest.class);
    verify(stub).listUsers(captor.capture());
    assertThat(captor.getValue().getIncludeDeleted()).isFalse();
    assertThat(captor.getValue().getPage().getSearchTerm()).isEqualTo("ada");
  }

  @Test
  void departmentCountIsTheDeclaredIdsLength() {
    UserGqlDto user =
        new UserGqlDto(
            "u1", null, List.of("d1", "d2", "d3"), "Ada", null, "a@x.com", true, null, false, null,
            GenderGql.UNSPECIFIED, null, false, null, false, null, null);

    assertThat(resolver.departmentCount(user)).isEqualTo(3);
  }

  private DataLoader<String, DepartmentGqlDto> departmentsLoaderFor(
      DepartmentServiceGrpc.DepartmentServiceBlockingStub stub) {
    DefaultBatchLoaderRegistry registry = new DefaultBatchLoaderRegistry();
    new DepartmentsLoaderConfig(registry, stub);

    DataLoaderRegistry dataLoaderRegistry = new DataLoaderRegistry();
    registry.registerDataLoaders(dataLoaderRegistry, GraphQLContext.getDefault());

    return dataLoaderRegistry.getDataLoader(DepartmentGqlDto.class.getName());
  }

  @Test
  void departmentsIsCappedAtMaxEdgeListBeforeTheBatchCall() throws Exception {
    DepartmentServiceGrpc.DepartmentServiceBlockingStub departmentStub =
        mock(DepartmentServiceGrpc.DepartmentServiceBlockingStub.class);
    when(departmentStub.withDeadlineAfter(anyLong(), any())).thenReturn(departmentStub);
    when(departmentStub.withInterceptors(any())).thenReturn(departmentStub);
    when(departmentStub.listDepartmentsByIds(any()))
        .thenAnswer(
            invocation -> {
              ListDepartmentsByIdsRequest request = invocation.getArgument(0);
              return ListDepartmentsByIdsResponse.newBuilder()
                  .addAllItems(
                      request.getDepartmentIdsList().stream()
                          .map(id -> DepartmentResponse.newBuilder().setId(id).setName(id).build())
                          .toList())
                  .build();
            });

    List<String> overCapped =
        java.util.stream.IntStream.range(0, com.synapsedesk.gateway.graphql.GraphqlLimits.MAX_EDGE_LIST + 10)
            .mapToObj(i -> "dept-" + i)
            .toList();
    UserGqlDto user =
        new UserGqlDto(
            "u1", null, overCapped, "Ada", null, "a@x.com", true, null, false, null,
            GenderGql.UNSPECIFIED, null, false, null, false, null, null);

    DataLoader<String, DepartmentGqlDto> loader = departmentsLoaderFor(departmentStub);
    CompletableFuture<List<DepartmentGqlDto>> future = resolver.departments(user, loader);
    loader.dispatch();
    List<DepartmentGqlDto> result = future.get(5, TimeUnit.SECONDS);

    assertThat(result).hasSize(com.synapsedesk.gateway.graphql.GraphqlLimits.MAX_EDGE_LIST);

    ArgumentCaptor<ListDepartmentsByIdsRequest> captor =
        ArgumentCaptor.forClass(ListDepartmentsByIdsRequest.class);
    verify(departmentStub, times(1)).listDepartmentsByIds(captor.capture());
    assertThat(captor.getValue().getDepartmentIdsCount())
        .isEqualTo(com.synapsedesk.gateway.graphql.GraphqlLimits.MAX_EDGE_LIST);
  }

  @Test
  void departmentsIsEmptyWithNoLoaderCallWhenTheParentHasNone() throws Exception {
    UserGqlDto user =
        new UserGqlDto(
            "u1", null, List.of(), "Ada", null, "a@x.com", true, null, false, null,
            GenderGql.UNSPECIFIED, null, false, null, false, null, null);

    DataLoader<String, DepartmentGqlDto> loader =
        departmentsLoaderFor(mock(DepartmentServiceGrpc.DepartmentServiceBlockingStub.class));

    CompletableFuture<List<DepartmentGqlDto>> future = resolver.departments(user, loader);

    assertThat(future.get(1, TimeUnit.SECONDS)).isEmpty();
  }
}
