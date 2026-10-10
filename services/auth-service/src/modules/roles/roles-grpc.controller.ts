import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  CreateRoleRequest,
  DeleteRoleResponse,
  ListPermissionsResponse,
  ListRolesRequest,
  ListRolesResponse,
  RoleIdRequest,
  RoleResponse,
  RoleServiceController,
  RoleServiceControllerMethods,
  AssignRoleUsersRequest,
  RevokeRoleUserRequest,
  SetRolePermissionsRequest,
  unpackCallerContext,
  UpdateRoleRequest,
} from '@synapsedesk/grpc-proto';
import { RolesService } from './roles.service';

@Controller()
@RoleServiceControllerMethods()
export class RolesGrpcController implements RoleServiceController {
  constructor(private readonly rolesService: RolesService) {}

  listRoles(
    request: ListRolesRequest,
    metadata?: Metadata,
  ): Promise<ListRolesResponse> {
    return this.rolesService.listRoles(request, unpackCallerContext(metadata));
  }

  getRole(request: RoleIdRequest, metadata?: Metadata): Promise<RoleResponse> {
    return this.rolesService.getRole(request, unpackCallerContext(metadata));
  }

  createRole(
    request: CreateRoleRequest,
    metadata?: Metadata,
  ): Promise<RoleResponse> {
    return this.rolesService.createRole(request, unpackCallerContext(metadata));
  }

  updateRole(
    request: UpdateRoleRequest,
    metadata?: Metadata,
  ): Promise<RoleResponse> {
    return this.rolesService.updateRole(request, unpackCallerContext(metadata));
  }

  deleteRole(
    request: RoleIdRequest,
    metadata?: Metadata,
  ): Promise<DeleteRoleResponse> {
    return this.rolesService.deleteRole(request, unpackCallerContext(metadata));
  }

  setRolePermissions(
    request: SetRolePermissionsRequest,
    metadata?: Metadata,
  ): Promise<RoleResponse> {
    return this.rolesService.setRolePermissions(
      request,
      unpackCallerContext(metadata),
    );
  }

  assignRoleUsers(
    request: AssignRoleUsersRequest,
    metadata?: Metadata,
  ): Promise<RoleResponse> {
    return this.rolesService.assignRoleUsers(
      request,
      unpackCallerContext(metadata),
    );
  }

  revokeRoleUser(
    request: RevokeRoleUserRequest,
    metadata?: Metadata,
  ): Promise<RoleResponse> {
    return this.rolesService.revokeRoleUser(
      request,
      unpackCallerContext(metadata),
    );
  }

  /** The seeded catalogue is identical for every tenant, so no context needed. */
  listPermissions(): Promise<ListPermissionsResponse> {
    return this.rolesService.listPermissions();
  }
}
