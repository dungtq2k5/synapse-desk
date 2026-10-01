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
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.generated.model.PermissionResponseDto;
import com.synapsedesk.gateway.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.Role.ListPermissionsResponse;
import synapsedesk.auth.Role.PermissionResponse;
import synapsedesk.auth.RoleServiceGrpc;

/** `GET /permissions` — the catalogue, and the cache key it shares with the GraphQL loader. */
class PermissionsControllerTest {

  private final RoleServiceGrpc.RoleServiceBlockingStub stub = mock(
    RoleServiceGrpc.RoleServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final CacheService cache = mock(CacheService.class);
  private PermissionsController controller;

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.require(any())).thenReturn(
      new RequestContext(
        "agent-1",
        "org-1",
        false,
        List.of(),
        List.of("role.read"),
        true,
        "127.0.0.1",
        "test"
      )
    );
    when(cache.buildKey(any(), any(), any())).thenReturn(
      "cache:org-1|permissions|"
    );
    when(cache.wrap(any(), anyLong(), any(), any())).thenAnswer(invocation ->
      ((Supplier<?>) invocation.getArgument(3)).get()
    );
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(mock(HttpServletRequest.class))
    );
    controller = new PermissionsController(stub, currentUser, cache);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void listsTheCatalogueUnderTheSharedCacheKey() {
    when(stub.listPermissions(any())).thenReturn(
      ListPermissionsResponse.newBuilder()
        .addItems(
          PermissionResponse.newBuilder()
            .setId("p1")
            .setCode("role.read")
            .setName("Read roles")
            .setGroup("role")
            .setIsRetired(false)
            .build()
        )
        .build()
    );

    ResponseEntity<ApiResponse<List<PermissionResponseDto>>> response =
      controller.permissionsControllerListV1();

    // The scope string and the (empty) params map both have to match the
    // GraphQL loader's build exactly, or the two surfaces stop sharing one
    // entry silently.
    verify(cache, times(1)).buildKey(
      "org-1",
      "permissions",
      java.util.Map.of()
    );
    List<PermissionResponseDto> data = response.getBody().data();
    assertThat(data).hasSize(1);
    assertThat(data.get(0).getCode()).isEqualTo(
      PermissionResponseDto.CodeEnum.ROLE_READ
    );
    assertThat(data.get(0).getIsRetired()).isFalse();
  }
}
