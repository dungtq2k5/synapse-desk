import {
  PermissionResponse,
  requireTimestamp,
  RoleResponse,
} from '@synapsedesk/grpc-proto';
import { PermissionResponseDto, RoleResponseDto } from './dto/rest/role.dto';

/** Wire -> REST: proto's `undefined` becomes JSON's `null`. */
export function toRoleDto(role: RoleResponse): RoleResponseDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? null,
    isSystemRole: role.isSystemRole,
    userAssigned: role.userAssigned,
    permissionCodes: role.permissionCodes,
    createdAt: requireTimestamp(role.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(role.updatedAt, 'updatedAt'),
  };
}

export function toPermissionDto(
  permission: PermissionResponse,
): PermissionResponseDto {
  return {
    id: permission.id,
    code: permission.code,
    name: permission.name,
    group: permission.group,
  };
}
