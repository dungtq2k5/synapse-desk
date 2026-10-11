package com.synapsedesk.gateway.modules.departments;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.modules.departments.dto.graphql.DepartmentPageGqlDto;
import io.grpc.stub.MetadataUtils;
import java.util.concurrent.TimeUnit;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Department.ListDepartmentsRequest;
import synapsedesk.auth.Department.ListDepartmentsResponse;
import synapsedesk.auth.DepartmentServiceGrpc;

/**
 * `Query.departments` — one page of departments. Never deleted departments
 * and always sorted by name: a resolver is not the place to reimplement the
 * `department.delete`-gated `includeDeleted` check the REST route carries.
 */
@Controller
public class DepartmentsResolver {

  private static final long DEADLINE_SECONDS = 5;

  private final DepartmentServiceGrpc.DepartmentServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public DepartmentsResolver(
    DepartmentServiceGrpc.DepartmentServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_READ)
  public DepartmentPageGqlDto departments(
    @Argument int first,
    @Argument int page,
    @Argument String searchTerm
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page)
      .setLimit(first)
      .setSortBy("name")
      .setSortOrder(SortOrder.SORT_ORDER_ASC);
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListDepartmentsResponse response = withMetadata(context).listDepartments(
      ListDepartmentsRequest.newBuilder()
        .setPage(pageRequest)
        .setIncludeDeleted(false)
        .build()
    );

    return new DepartmentPageGqlDto(
      response
        .getItemsList()
        .stream()
        .map(DepartmentMapper::toDepartmentGqlDto)
        .toList(),
      DepartmentMapper.toPageMetaGqlDto(response.getMeta())
    );
  }

  private DepartmentServiceGrpc.DepartmentServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
