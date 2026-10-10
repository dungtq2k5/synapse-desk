import {
  DepartmentMemberResponse,
  DepartmentResponse,
  fromProtoTimestamp,
  ListDepartmentMembersRequest,
  ListDepartmentMembersResponse,
  ListDepartmentsRequest,
  ListDepartmentsResponse,
  requireProtoTimestamp,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import {
  ListDepartmentMembersQueryDto,
  ListDepartmentsQueryDto,
} from './dto/rest/department.dto';
import {
  DepartmentMemberResponseDto,
  DepartmentResponseDto,
} from './dto/rest/department-response.dto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto } from '../users/user.mapper';
import { DepartmentResponseGqlDto } from './dto/graphql/department-response.gql-dto';

/**
 * Wire -> REST. The inverse of auth-service's department.mapper: proto's
 * `undefined` becomes JSON's `null`, and Timestamps become Dates.
 */
export function toDepartmentResponseDto(
  department: DepartmentResponse,
): DepartmentResponseDto {
  return {
    id: department.id,
    name: department.name,
    description: department.description ?? null,
    memberCount: department.memberCount,
    deletedAt: fromProtoTimestamp(department.deletedAt) ?? null,
    deletedByName: department.deletedByName ?? null,
    createdAt: requireProtoTimestamp(department.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(department.updatedAt, 'updatedAt'),
  };
}

export function toDepartmentMemberResponseDto(
  member: DepartmentMemberResponse,
): DepartmentMemberResponseDto {
  return {
    user: toUserResponseDto(member.user!),
    isPrimary: member.isPrimary,
    assignedByName: member.assignedByName ?? null,
    assignedAt: requireProtoTimestamp(member.assignedAt, 'assignedAt'),
  };
}

/**
 * Wire `DepartmentResponse` -> the GraphQL `Department` edge type, used for
 * `Ticket.department`, `User.departments` and `Document.departments`.
 *
 * Called by `createDepartmentLoader`, so a resolver reaches an edge through
 * `loaders.departments.load(id)` and never maps for itself. A missing id is the
 * loader's `null`, not this function's.
 *
 * @example
 * const rows = response.items.map((d) => toDepartmentResponseGqlDto(d));
 *
 * @param department - one department off the wire
 * @returns the edge type the GraphQL schema declares
 */
export function toDepartmentResponseGqlDto(
  department: DepartmentResponse,
): DepartmentResponseGqlDto {
  return {
    id: department.id,
    name: department.name,
    description: department.description ?? null,
  };
}

/** Converts a `ListDepartmentsResponse` into the paginated REST envelope. */
export function toDepartmentPageDto(
  response: ListDepartmentsResponse,
): PaginationResponseDto<DepartmentResponseDto> {
  return {
    items: response.items.map(toDepartmentResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Converts a `ListDepartmentMembersResponse` into the paginated REST envelope. */
export function toDepartmentMemberPageDto(
  response: ListDepartmentMembersResponse,
): PaginationResponseDto<DepartmentMemberResponseDto> {
  return {
    items: response.items.map(toDepartmentMemberResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Builds a `ListDepartmentsRequest` from the REST query. */
export function toListDepartmentsRequest(
  query: ListDepartmentsQueryDto,
): ListDepartmentsRequest {
  return { page: toPageRequest(query), includeDeleted: query.includeDeleted };
}

/** Builds a `ListDepartmentMembersRequest` from the REST query. */
export function toListDepartmentMembersRequest(
  departmentId: string,
  query: ListDepartmentMembersQueryDto,
): ListDepartmentMembersRequest {
  return { departmentId, page: toPageRequest(query) };
}
