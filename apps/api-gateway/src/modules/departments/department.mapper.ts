import {
  DepartmentMemberResponse,
  DepartmentResponse,
  fromTimestamp,
  requireTimestamp,
} from '@synapsedesk/grpc-proto';
import { toUserResponseDto } from '../users/user.mapper';
import {
  DepartmentMemberResponseDto,
  DepartmentResponseDto,
} from './dto/rest/department.dto';

/**
 * Wire -> REST. The inverse of auth-service's department.mapper: proto's
 * `undefined` becomes JSON's `null`, and Timestamps become Dates.
 */
export function toDepartmentDto(
  department: DepartmentResponse,
): DepartmentResponseDto {
  return {
    id: department.id,
    name: department.name,
    description: department.description ?? null,
    memberCount: department.memberCount,
    deletedAt: fromTimestamp(department.deletedAt) ?? null,
    deletedByName: department.deletedByName ?? null,
    createdAt: requireTimestamp(department.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(department.updatedAt, 'updatedAt'),
  };
}

export function toDepartmentMemberDto(
  member: DepartmentMemberResponse,
): DepartmentMemberResponseDto {
  return {
    user: toUserResponseDto(member.user!),
    isPrimary: member.isPrimary,
    assignedByName: member.assignedByName ?? null,
    assignedAt: requireTimestamp(member.assignedAt, 'assignedAt'),
  };
}
