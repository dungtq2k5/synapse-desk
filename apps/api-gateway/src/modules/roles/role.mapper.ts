import {
  PermissionResponse,
  requireProtoTimestamp,
  RoleResponse,
} from '@synapsedesk/grpc-proto';
import { PermissionResponseDto, RoleResponseDto } from './dto/rest/role.dto';

/** Wire -> REST: proto's `undefined` becomes JSON's `null`. */
export function toRoleResponseDto(role: RoleResponse): RoleResponseDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? null,
    isSystemRole: role.isSystemRole,
    userAssigned: role.userAssigned,
    permissionCodes: role.permissionCodes,
    createdAt: requireProtoTimestamp(role.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(role.updatedAt, 'updatedAt'),
  };
}

export function toPermissionResponseDto(
  permission: PermissionResponse,
): PermissionResponseDto {
  return {
    id: permission.id,
    code: permission.code,
    name: permission.name,
    group: permission.group,
  };
}
