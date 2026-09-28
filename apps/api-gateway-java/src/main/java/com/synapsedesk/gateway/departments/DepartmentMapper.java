package com.synapsedesk.gateway.departments;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Department.DepartmentResponse;

/** Wire `DepartmentResponse`/`PageMeta` -> the GraphQL DTOs — `department.mapper.ts`, reproduced. */
public final class DepartmentMapper {

  private DepartmentMapper() {}

  public static DepartmentGqlDto toDepartmentGqlDto(
    DepartmentResponse department
  ) {
    return new DepartmentGqlDto(
      department.getId(),
      department.getName(),
      department.hasDescription() ? department.getDescription() : null
    );
  }

  public static PageMetaGqlDto toPageMetaGqlDto(PageMeta meta) {
    return new PageMetaGqlDto(
      meta.getTotalItems(),
      meta.getItemCount(),
      meta.getItemsPerPage(),
      meta.getTotalPages(),
      meta.getCurrentPage()
    );
  }
}
