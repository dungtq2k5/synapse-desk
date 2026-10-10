import { PermissionCode } from '@synapsedesk/common';

/** The minimum a row must expose to be flattened. */
type RoleWithPermissions = { permissions: { code: string }[] };

/**
 * The flattened union of permission codes across a user's roles.
 *
 * ONE function, called by both `buildJwtPayload` and
 * `UserService.GetUserPermissions`. Two copies would drift the first time
 * either changed, and the drift would be invisible: the token would grant a set
 * the "what can this user do?" endpoint disagrees with, and only one of them
 * decides what actually happens.
 *
 * The Set is load-bearing — two roles both granting `ticket.read` would
 * otherwise duplicate it in every token for the user's whole session.
 */
export function flattenPermissionCodes(
  roles: RoleWithPermissions[],
): PermissionCode[] {
  return [
    ...new Set(
      roles.flatMap((role) =>
        role.permissions.map((permission) => permission.code as PermissionCode),
      ),
    ),
  ];
}
