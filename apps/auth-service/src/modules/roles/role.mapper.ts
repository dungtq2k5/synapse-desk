import { RoleResponse, toTimestamp } from '@synapsedesk/grpc-proto';
import type { Prisma } from '../../generated/prisma/client';

/** The joins every RoleResponse needs. */
export const ROLE_INCLUDE = {
  permissions: { select: { code: true } },
} satisfies Prisma.RoleInclude;

export type RoleRow = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

/**
 * An ALLOW-LIST, like every other mapper here. Spreading the row would ship
 * `organizationId` and `createdById`, and every column added from now on.
 */
export function toRoleResponse(role: RoleRow): RoleResponse {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? undefined,
    // Derived from the two columns together, not from `isSystemRole` alone: a
    // tenant row could in principle carry the flag, and only the NULL
    // organization makes it global.
    isSystemRole: role.organizationId === null && role.isSystemRole,
    userAssigned: role.userAssigned,
    permissionCodes: role.permissions.map((permission) => permission.code),
    createdAt: toTimestamp(role.createdAt),
    updatedAt: toTimestamp(role.updatedAt),
  };
}
