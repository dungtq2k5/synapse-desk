package com.synapsedesk.gateway.modules.departments.dto.graphql;

import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import java.util.List;

/** `DepartmentPage` — `Query.departments`'s return type. */
public record DepartmentPageGqlDto(
  List<DepartmentGqlDto> items,
  PageMetaGqlDto meta
) {}
