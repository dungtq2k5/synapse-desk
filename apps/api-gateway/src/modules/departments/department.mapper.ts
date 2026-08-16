import {
  DepartmentMemberResponse,
  DepartmentResponse,
  fromProtoTimestamp,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { toUserResponseDto } from '../users/user.mapper';
import {
  DepartmentMemberResponseDto,
  DepartmentResponseDto,
} from './dto/rest/department.dto';
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
 * Wire -> GraphQL edge type, for `Ticket.department`, `User.departments` and
 * `Document.departments`.
 *
 * Beside the REST mappers rather than in the DTO file, for the reason
 * {@link toUserSummaryGqlDto} spells out: every wire→DTO mapping in this gateway
 * lives in a `<feature>.mapper.ts`, and the near-identical `toDepartmentResponseDto`
 * sitting directly above is exactly the neighbour that makes the difference
 * between them visible.
 *
 * **`null` in, `null` out** — a loader answers `null` for an id the batch RPC
 * omitted, and an empty object would render a blank card the client could not
 * tell apart from a real one.
 */
export function toDepartmentResponseGqlDto(
  department: DepartmentResponse | null,
): DepartmentResponseGqlDto | null {
  if (!department) return null;

  return {
    id: department.id,
    name: department.name,
    description: department.description ?? null,
  };
}
