package com.synapsedesk.gateway.modules.roles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.cache.CacheService;
import com.synapsedesk.gateway.modules.roles.dto.rest.AssignRoleUsersDto;
import com.synapsedesk.gateway.modules.roles.dto.rest.CreateRoleDto;
import com.synapsedesk.gateway.modules.roles.dto.rest.SetRolePermissionsDto;
import com.synapsedesk.gateway.modules.roles.dto.rest.UpdateRoleDto;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.auth.Role.AssignRoleUsersRequest;
import synapsedesk.auth.Role.CreateRoleRequest;
import synapsedesk.auth.Role.RevokeRoleUserRequest;
import synapsedesk.auth.Role.RoleIdRequest;
import synapsedesk.auth.Role.RoleResponse;
import synapsedesk.auth.Role.SetRolePermissionsRequest;
import synapsedesk.auth.Role.UpdateRoleRequest;
import synapsedesk.auth.RoleServiceGrpc;

/** `RolesApi` — the request each write builds, and `create`'s single-code gate. */
class RolesControllerTest {

  private final RoleServiceGrpc.RoleServiceBlockingStub stub = mock(
    RoleServiceGrpc.RoleServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final CacheService cache = mock(CacheService.class);
  private RolesController controller;

  private static RoleResponse.Builder baseRole(String id) {
    return RoleResponse.newBuilder()
      .setId(id)
      .setName("Agent")
      .setIsSystemRole(false)
      .setUserAssigned(3)
      .addPermissionCodes("ticket.read.all")
      .setCreatedAt(Timestamp.getDefaultInstance())
      .setUpdatedAt(Timestamp.getDefaultInstance());
  }

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
        List.of("role.create"),
        true,
        "127.0.0.1",
        "test"
      )
    );
    when(cache.wrapTyped(any(), anyLong(), any(), any())).thenAnswer(
      invocation -> ((Supplier<?>) invocation.getArgument(3)).get()
    );
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(mock(HttpServletRequest.class))
    );
    controller = new RolesController(stub, currentUser, cache);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void createSendsNameDescriptionAndPermissionCodes() {
    when(stub.createRole(any())).thenReturn(baseRole("r1").build());
    CreateRoleDto dto = new CreateRoleDto(
      "Agent",
      List.of(CreateRoleDto.PermissionCodesEnum.TICKET_READ_ALL)
    ).description("Front line");

    var response = controller.rolesControllerCreateV1(dto);

    ArgumentCaptor<CreateRoleRequest> captor = ArgumentCaptor.forClass(
      CreateRoleRequest.class
    );
    verify(stub).createRole(captor.capture());
    assertThat(captor.getValue().getName()).isEqualTo("Agent");
    assertThat(captor.getValue().getDescription()).isEqualTo("Front line");
    assertThat(captor.getValue().getPermissionCodesList()).containsExactly(
      "ticket.read.all"
    );
    assertThat(response.getStatusCode().value()).isEqualTo(201);
    assertThat(response.getBody().data().getId()).isEqualTo("r1");
  }

  @Test
  void updateSendsOnlyPresentFields() {
    when(stub.updateRole(any())).thenReturn(baseRole("r1").build());
    UpdateRoleDto dto = new UpdateRoleDto().name("New name");

    controller.rolesControllerUpdateV1("r1", dto);

    ArgumentCaptor<UpdateRoleRequest> captor = ArgumentCaptor.forClass(
      UpdateRoleRequest.class
    );
    verify(stub).updateRole(captor.capture());
    assertThat(captor.getValue().getId()).isEqualTo("r1");
    assertThat(captor.getValue().hasName()).isTrue();
    assertThat(captor.getValue().hasDescription()).isFalse();
  }

  @Test
  void removeSendsTheRoleId() {
    controller.rolesControllerRemoveV1("r1");

    ArgumentCaptor<RoleIdRequest> captor = ArgumentCaptor.forClass(
      RoleIdRequest.class
    );
    verify(stub).deleteRole(captor.capture());
    assertThat(captor.getValue().getId()).isEqualTo("r1");
  }

  @Test
  void setPermissionsReplacesTheWholeSet() {
    when(stub.setRolePermissions(any())).thenReturn(baseRole("r1").build());
    SetRolePermissionsDto dto = new SetRolePermissionsDto(
      List.of(SetRolePermissionsDto.PermissionCodesEnum.ROLE_READ)
    );

    controller.rolesControllerSetPermissionsV1("r1", dto);

    ArgumentCaptor<SetRolePermissionsRequest> captor = ArgumentCaptor.forClass(
      SetRolePermissionsRequest.class
    );
    verify(stub).setRolePermissions(captor.capture());
    assertThat(captor.getValue().getId()).isEqualTo("r1");
    assertThat(captor.getValue().getPermissionCodesList()).containsExactly(
      "role.read"
    );
  }

  @Test
  void assignUsersSendsTheRoleIdAndUserIds() {
    when(stub.assignRoleUsers(any())).thenReturn(baseRole("r1").build());
    var u1 = java.util.UUID.fromString("11111111-1111-4111-8111-111111111111");
    var u2 = java.util.UUID.fromString("22222222-2222-4222-8222-222222222222");
    AssignRoleUsersDto dto = new AssignRoleUsersDto(List.of(u1, u2));

    controller.rolesControllerAssignUsersV1("r1", dto);

    ArgumentCaptor<AssignRoleUsersRequest> captor = ArgumentCaptor.forClass(
      AssignRoleUsersRequest.class
    );
    verify(stub).assignRoleUsers(captor.capture());
    assertThat(captor.getValue().getRoleId()).isEqualTo("r1");
    assertThat(captor.getValue().getUserIdsList()).containsExactly(
      u1.toString(),
      u2.toString()
    );
  }

  @Test
  void revokeUserSendsBothIds() {
    when(stub.revokeRoleUser(any())).thenReturn(baseRole("r1").build());

    controller.rolesControllerRevokeUserV1("r1", "u1");

    ArgumentCaptor<RevokeRoleUserRequest> captor = ArgumentCaptor.forClass(
      RevokeRoleUserRequest.class
    );
    verify(stub).revokeRoleUser(captor.capture());
    assertThat(captor.getValue().getRoleId()).isEqualTo("r1");
    assertThat(captor.getValue().getUserId()).isEqualTo("u1");
  }
}
