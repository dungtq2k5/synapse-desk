package com.synapsedesk.gateway.users;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.departments.DepartmentGqlDto;
import com.synapsedesk.gateway.graphql.GraphqlLimits;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.User.CurrentUserResponse;
import synapsedesk.auth.User.GetCurrentUserRequest;
import synapsedesk.auth.User.ListUsersRequest;
import synapsedesk.auth.User.ListUsersResponse;
import synapsedesk.auth.User.UserIdRequest;
import synapsedesk.auth.User.UserSummaryResponse;
import synapsedesk.auth.UserServiceGrpc;

/**
 * `Query.me`, `Query.user`, `Query.users`, and `User.departmentCount` /
 * `User.departments`.
 *
 * <p><b>`Query.user` carries `@RequirePermission(USER_READ)`, `me` does
 * not</b> — reading your own profile is not an administrative act, matching
 * the REST route's own distinction. That is the entire reason the two exist
 * as separate fields rather than one parameterized query.
 */
@Controller
public class UsersResolver {

  private static final long DEADLINE_SECONDS = 5;

  private final UserServiceGrpc.UserServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public UsersResolver(
    UserServiceGrpc.UserServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @QueryMapping
  public UserGqlDto me() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CurrentUserResponse response = withMetadata(context).getCurrentUser(
      GetCurrentUserRequest.newBuilder().setUserId(context.sub()).build()
    );

    return UserGqlMapper.toUserGqlDto(response);
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public UserGqlDto user(@Argument String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    try {
      UserSummaryResponse response = withMetadata(context).getUser(
        UserIdRequest.newBuilder().setId(id).build()
      );
      return UserGqlMapper.toUserGqlDto(response);
    } catch (StatusRuntimeException notFoundOrForbidden) {
      // Null rather than an error, matching `Query.ticket`/`Query.role`: a
      // non-null field that throws would take the whole query's data with it.
      return null;
    }
  }

  @QueryMapping(name = "users")
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public UserPageGqlDto users(
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

    ListUsersResponse response = withMetadata(context).listUsers(
      ListUsersRequest.newBuilder()
        .setPage(pageRequest)
        // Never deleted users, and not negotiable from here — the
        // same rule `DepartmentsResolver` and `DocumentsResolver`
        // state; the REST route gates the flag on `user.delete`
        // inside the controller, so a resolver is not the place to
        // reimplement that check.
        .setIncludeDeleted(false)
        .build()
    );

    return UserGqlMapper.toUserPageGqlDto(response);
  }

  /** The flat count beside the capped `departments` edge — the true, uncapped total. */
  @SchemaMapping(typeName = "User", field = "departmentCount")
  public int departmentCount(UserGqlDto user) {
    return user.departmentIds().size();
  }

  /**
   * `User.departments` — sliced to {@link GraphqlLimits#MAX_EDGE_LIST} BEFORE
   * the batch, same reasoning as `DocumentsResolver.departments`: an
   * uncapped parent fails the whole field rather than silently shortening it.
   */
  @SchemaMapping(typeName = "User", field = "departments")
  public CompletableFuture<List<DepartmentGqlDto>> departments(
    UserGqlDto user,
    DataLoader<String, DepartmentGqlDto> loader
  ) {
    List<String> ids = user.departmentIds();
    if (ids.isEmpty()) {
      return CompletableFuture.completedFuture(List.of());
    }

    RequestContext context = currentUser.require(CurrentRequest.request());
    List<String> capped = ids.subList(
      0,
      Math.min(ids.size(), GraphqlLimits.MAX_EDGE_LIST)
    );

    return loader
      .loadMany(capped, java.util.Collections.nCopies(capped.size(), context))
      .thenApply(departments ->
        departments.stream().filter(java.util.Objects::nonNull).toList()
      );
  }

  private UserServiceGrpc.UserServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
