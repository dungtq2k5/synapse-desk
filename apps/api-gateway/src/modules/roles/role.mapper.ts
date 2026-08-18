import { PermissionCode } from '@synapsedesk/common';
import {
  ListPermissionsResponse,
  ListRolesRequest,
  ListRolesResponse,
  PermissionResponse,
  requireProtoTimestamp,
  RoleResponse,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { ListRolesQueryDto } from './dto/rest/role.dto';
import {
  PermissionResponseDto,
  RoleResponseDto,
} from './dto/rest/role-response.dto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';

/** Wire -> REST: proto's `undefined` becomes JSON's `null`. */
export function toRoleResponseDto(role: RoleResponse): RoleResponseDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? null,
    isSystemRole: role.isSystemRole,
    userAssigned: role.userAssigned,
    // The proto declares `repeated string`; the codes come from our own seeded
    // catalogue rather than from user input, so the narrowing is safe here --
    // the same one `toCurrentUserResponseDto` performs.
    permissionCodes: role.permissionCodes as PermissionCode[],
    createdAt: requireProtoTimestamp(role.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(role.updatedAt, 'updatedAt'),
  };
}

export function toPermissionResponseDto(
  permission: PermissionResponse,
): PermissionResponseDto {
  return {
    id: permission.id,
    code: permission.code as PermissionCode,
    name: permission.name,
    group: permission.group,
  };
}

/** Converts a `ListRolesResponse` into the paginated REST envelope. */
export function toRolePageDto(
  response: ListRolesResponse,
): PaginationResponseDto<RoleResponseDto> {
  return {
    items: response.items.map(toRoleResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Converts a `ListPermissionsResponse` off the wire into its REST DTOs. */
export function toPermissionResponseDtos(
  response: ListPermissionsResponse,
): PermissionResponseDto[] {
  return response.items.map(toPermissionResponseDto);
}

/** Builds a `ListRolesRequest` from the REST query. */
export function toListRolesRequest(query: ListRolesQueryDto): ListRolesRequest {
  return { page: toPageRequest(query), includeSystem: query.includeSystem };
}
