package com.synapsedesk.gateway.departments;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.cache.CacheService;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.web.DepartmentSortField;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Department.ListDepartmentsRequest;
import synapsedesk.auth.Department.ListDepartmentsResponse;
import synapsedesk.auth.DepartmentServiceGrpc;

/**
 * `DepartmentsApi` — specifically `?includeDeleted=true`'s query-permission
 * gate. The property under test
 * is ORDER: the gate must run before the cache read, since a cached
 * entry warmed by a privileged caller must never be served to one without
 * the permission.
 */
class DepartmentsControllerTest {

  private final DepartmentServiceGrpc.DepartmentServiceBlockingStub stub = mock(
    DepartmentServiceGrpc.DepartmentServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final CacheService cache = mock(CacheService.class);
  private DepartmentsController controller;

  private static RequestContext contextWith(List<String> permissionCodes) {
    return new RequestContext(
      "agent-1",
      "org-1",
      false,
      List.of(),
      permissionCodes,
      true,
      "127.0.0.1",
      "test"
    );
  }

  private static MockHttpServletRequest requestWithQuery(
    String includeDeleted
  ) {
    MockHttpServletRequest request = new MockHttpServletRequest();
    if (includeDeleted != null) {
      request.setParameter("includeDeleted", includeDeleted);
    }
    return request;
  }

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(cache.wrapTyped(any(), anyLong(), any(), any())).thenAnswer(
      invocation -> ((Supplier<?>) invocation.getArgument(3)).get()
    );
    controller = new DepartmentsController(stub, currentUser, cache);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void includeDeletedWithoutThePermissionIsRefusedBeforeTheCacheIsTouched() {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(requestWithQuery("true"))
    );
    when(currentUser.require(any())).thenReturn(
      contextWith(List.of("department.read"))
    );

    assertThatThrownBy(() ->
      controller.departmentsControllerListV1(
        BigDecimalOf(1),
        BigDecimalOf(10),
        SortDirection.ASC,
        null,
        DepartmentSortField.createdAt,
        true
      )
    ).isInstanceOf(ResponseStatusException.class);

    verifyNoInteractions(cache);
    verifyNoInteractions(stub);
  }

  @Test
  void includeDeletedWithThePermissionReachesThePeer() {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(requestWithQuery("true"))
    );
    when(currentUser.require(any())).thenReturn(
      contextWith(List.of("department.read", "department.delete"))
    );
    when(stub.listDepartments(any())).thenReturn(
      ListDepartmentsResponse.newBuilder()
        .setMeta(synapsedesk.auth.Common.PageMeta.getDefaultInstance())
        .build()
    );

    controller.departmentsControllerListV1(
      BigDecimalOf(1),
      BigDecimalOf(10),
      SortDirection.ASC,
      null,
      DepartmentSortField.createdAt,
      true
    );

    org.mockito.ArgumentCaptor<ListDepartmentsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(ListDepartmentsRequest.class);
    verify(stub).listDepartments(captor.capture());
    assertThat(captor.getValue().getIncludeDeleted()).isTrue();
  }

  @Test
  void anAbsentIncludeDeletedNeverTriggersTheGate() {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(requestWithQuery(null))
    );
    when(currentUser.require(any())).thenReturn(
      contextWith(List.of("department.read"))
    );
    when(stub.listDepartments(any())).thenReturn(
      ListDepartmentsResponse.newBuilder()
        .setMeta(synapsedesk.auth.Common.PageMeta.getDefaultInstance())
        .build()
    );

    controller.departmentsControllerListV1(
      BigDecimalOf(1),
      BigDecimalOf(10),
      SortDirection.ASC,
      null,
      DepartmentSortField.createdAt,
      false
    );

    org.mockito.ArgumentCaptor<ListDepartmentsRequest> captor =
      org.mockito.ArgumentCaptor.forClass(ListDepartmentsRequest.class);
    verify(stub).listDepartments(captor.capture());
    assertThat(captor.getValue().getIncludeDeleted()).isFalse();
  }

  @Test
  void includeDeletedFalseAsRawStringIsNotAnAsk() {
    // `?includeDeleted=false` is present but
    // false-ish, so it never demands the permission at all.
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(requestWithQuery("false"))
    );
    when(currentUser.require(any())).thenReturn(
      contextWith(List.of("department.read"))
    );
    when(stub.listDepartments(any())).thenReturn(
      ListDepartmentsResponse.newBuilder()
        .setMeta(synapsedesk.auth.Common.PageMeta.getDefaultInstance())
        .build()
    );

    controller.departmentsControllerListV1(
      BigDecimalOf(1),
      BigDecimalOf(10),
      SortDirection.ASC,
      null,
      DepartmentSortField.createdAt,
      false
    );

    verify(stub).listDepartments(any());
  }

  private static java.math.BigDecimal BigDecimalOf(int value) {
    return java.math.BigDecimal.valueOf(value);
  }
}
