import {
  CreatePlatformOrganizationResponse,
  fromProtoTimestamp,
  ListGlobalRolesResponse,
  ListPlatformOrganizationsRequest,
  ListPlatformOrganizationsResponse,
  ListPlatformUsersRequest,
  ListPlatformUsersResponse,
  PlatformMetricsResponse,
  PlatformOrganizationResponse,
  requireField,
  requireProtoTimestamp,
  toPageRequest,
  toProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto } from '../users/user.mapper';
import { toRoleResponseDto } from '../roles/role.mapper';
import {
  ListPlatformOrganizationsQueryDto,
  ListPlatformUsersQueryDto,
  RoleResponseDto,
} from './dto/rest/platform.dto';
import {
  CreatePlatformOrganizationResponseDto,
  PlatformMetricsResponseDto,
  PlatformOrganizationResponseDto,
  PlatformUserResponseDto,
} from './dto/rest/platform-response.dto';
import { toOrganizationResponseDto } from '../organizations/organization.mapper';

export function toPlatformOrganizationResponseDto(
  row: PlatformOrganizationResponse,
): PlatformOrganizationResponseDto {
  return {
    organization: toOrganizationResponseDto(row.organization!),
    userCount: row.userCount,
    pendingInvitationCount: row.pendingInvitationCount,
    departmentCount: row.departmentCount,
    deletedAt: fromProtoTimestamp(row.deletedAt) ?? null,
  };
}

/** Builds a `ListPlatformOrganizationsRequest` from the REST query. */
export function toListPlatformOrganizationsRequest(
  query: ListPlatformOrganizationsQueryDto,
): ListPlatformOrganizationsRequest {
  return {
    page: toPageRequest(query),
    status:
      query.status === undefined ? undefined : toProtoOrgStatus(query.status),
    includeDeleted: query.includeDeleted,
  };
}

/** Builds a `ListPlatformUsersRequest` from the REST query. */
export function toListPlatformUsersRequest(
  query: ListPlatformUsersQueryDto,
): ListPlatformUsersRequest {
  return {
    page: toPageRequest(query),
    organizationId: query.organizationId,
    includeDeleted: query.includeDeleted,
  };
}

/** Converts a `ListPlatformOrganizationsResponse` into the paginated REST envelope. */
export function toPlatformOrganizationPageDto(
  response: ListPlatformOrganizationsResponse,
): PaginationResponseDto<PlatformOrganizationResponseDto> {
  return {
    items: response.items.map(toPlatformOrganizationResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `CreatePlatformOrganizationResponse` off the wire into its REST DTO.
 *
 * @throws Error if the organization or its admin is missing.
 */
export function toCreatePlatformOrganizationResponseDto(
  response: CreatePlatformOrganizationResponse,
): CreatePlatformOrganizationResponseDto {
  return {
    organization: toPlatformOrganizationResponseDto(
      requireField(response.organization, 'organization'),
    ),
    admin: toUserResponseDto(requireField(response.admin, 'admin')),
  };
}

/** Converts a `ListPlatformUsersResponse` into the paginated REST envelope. */
export function toPlatformUserPageDto(
  response: ListPlatformUsersResponse,
): PaginationResponseDto<PlatformUserResponseDto> {
  return {
    items: response.items.map((row) => ({
      user: toUserResponseDto(requireField(row.user, 'user')),
      organizationId: row.organizationId ?? null,
      organizationName: row.organizationName ?? null,
      roleNames: row.roleNames,
      deletedAt: fromProtoTimestamp(row.deletedAt) ?? null,
    })),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Converts a `ListGlobalRolesResponse` into the paginated REST envelope. */
export function toGlobalRolePageDto(
  response: ListGlobalRolesResponse,
): PaginationResponseDto<RoleResponseDto> {
  return {
    items: response.items.map(toRoleResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `PlatformMetricsResponse` off the wire into its REST DTO.
 *
 * @throws Error if `generatedAt` is missing, which the proto requires.
 */
export function toPlatformMetricsResponseDto(
  response: PlatformMetricsResponse,
): PlatformMetricsResponseDto {
  return {
    totalOrganizations: response.totalOrganizations,
    organizationsByStatus: response.organizationsByStatus,
    totalUsers: response.totalUsers,
    activeUsers: response.activeUsers,
    pendingInvitations: response.pendingInvitations,
    liveSessions: response.liveSessions,
    seatsAllocated: response.seatsAllocated,
    seatsInUse: response.seatsInUse,
    generatedAt: requireProtoTimestamp(response.generatedAt, 'generatedAt'),
  };
}
