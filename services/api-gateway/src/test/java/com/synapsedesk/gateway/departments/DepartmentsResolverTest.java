package com.synapsedesk.gateway.departments;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Department.DepartmentResponse;
import synapsedesk.auth.Department.ListDepartmentsRequest;
import synapsedesk.auth.Department.ListDepartmentsResponse;
import synapsedesk.auth.DepartmentServiceGrpc;

/** `Query.departments` — the request it builds and the response it maps back. */
class DepartmentsResolverTest {

  private final DepartmentServiceGrpc.DepartmentServiceBlockingStub stub = mock(
    DepartmentServiceGrpc.DepartmentServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private DepartmentsResolver resolver;

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(mock(HttpServletRequest.class))
    );
    resolver = new DepartmentsResolver(stub, currentUser);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void buildsThePageRequestAndMapsTheResponseBack() {
    when(currentUser.require(any())).thenReturn(
      new RequestContext(
        "agent-1",
        "11111111-1111-4111-8111-111111111111",
        false,
        List.of(),
        List.of("department.read"),
        true,
        "127.0.0.1",
        "test"
      )
    );
    when(stub.listDepartments(any())).thenReturn(
      ListDepartmentsResponse.newBuilder()
        .addItems(
          DepartmentResponse.newBuilder()
            .setId("dept-1")
            .setName("Support")
            .setDescription("Front line")
            .build()
        )
        .setMeta(
          PageMeta.newBuilder()
            .setTotalItems(1)
            .setItemCount(1)
            .setItemsPerPage(10)
            .setTotalPages(1)
            .setCurrentPage(1)
            .build()
        )
        .build()
    );

    DepartmentPageGqlDto result = resolver.departments(10, 1, "supp");

    ArgumentCaptor<ListDepartmentsRequest> captor = ArgumentCaptor.forClass(
      ListDepartmentsRequest.class
    );
    org.mockito.Mockito.verify(stub).listDepartments(captor.capture());

    ListDepartmentsRequest sent = captor.getValue();
    assertThat(sent.getIncludeDeleted()).isFalse();
    assertThat(sent.getPage().getPage()).isEqualTo(1);
    assertThat(sent.getPage().getLimit()).isEqualTo(10);
    assertThat(sent.getPage().getSortBy()).isEqualTo("name");
    assertThat(sent.getPage().getSortOrder()).isEqualTo(
      SortOrder.SORT_ORDER_ASC
    );
    assertThat(sent.getPage().getSearchTerm()).isEqualTo("supp");

    assertThat(result.items()).hasSize(1);
    assertThat(result.items().get(0)).isEqualTo(
      new DepartmentGqlDto("dept-1", "Support", "Front line")
    );
    assertThat(result.meta()).isEqualTo(new PageMetaGqlDto(1, 1, 10, 1, 1));
  }
}
