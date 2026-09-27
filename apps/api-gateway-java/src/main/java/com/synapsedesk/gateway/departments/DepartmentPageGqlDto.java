package com.synapsedesk.gateway.departments;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.util.List;

/** `DepartmentPage` — `Query.departments`'s return type. */
public record DepartmentPageGqlDto(List<DepartmentGqlDto> items, PageMetaGqlDto meta) {}
