import {
  DepartmentMemberResponse,
  DepartmentResponse,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import type { Department, User } from '../../generated/prisma/client';
import { toUserResponse } from '../users/user.mapper';

/**
 * A department row as the service reads it, with the two joins the response
 * needs. Declared rather than inferred so a query that forgets `_count` is a
 * compile error at the call site instead of `memberCount: NaN` in a response.
 */
export type DepartmentRow = Department & {
  _count: { userDepartments: number };
  deletedBy?: { fullName: string } | null;
};

/**
 * An ALLOW-LIST, for the same reason `toUserResponse` is one: spreading the row
 * would ship `organizationId` and `deletedById` today, and every column added to
 * the model from now on, with nothing to catch it.
 */
export function toDepartmentResponse(row: DepartmentRow): DepartmentResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    memberCount: row._count.userDepartments,
    // Only ever set on a soft-deleted row, so a list that includes them can be
    // rendered differently instead of showing a deleted department as live.
    deletedAt: toTimestamp(row.deletedAt),
    deletedByName: row.deletedBy?.fullName ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export type DepartmentMemberRow = {
  isPrimary: boolean;
  assignedAt: Date;
  user: User;
  assignedBy: { fullName: string } | null;
};

export function toDepartmentMemberResponse(
  row: DepartmentMemberRow,
): DepartmentMemberResponse {
  return {
    user: toUserResponse(row.user),
    isPrimary: row.isPrimary,
    assignedByName: row.assignedBy?.fullName ?? undefined,
    assignedAt: toTimestamp(row.assignedAt),
  };
}
