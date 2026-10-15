'use client';

import {
  useUsersControllerGetCurrentUserV1,
  type CurrentUserResponseDtoPermissionCodesItem as PermissionCode,
} from '@synapsedesk/api-client';

/**
 * Who is looking: the signed-in user and what they may do.
 *
 * `isAgent` is ticket-service's own rule (`TicketAccessService.isAgent`):
 * holding `ticket.read.all` or `ticket.message.moderate`. An agent sees
 * internal notes and the full queue; anyone else is a requester.
 */
export function useViewer() {
  const query = useUsersControllerGetCurrentUserV1();
  const codes = query.data?.data?.permissionCodes ?? [];
  return {
    query,
    user: query.data?.data?.user ?? null,
    /** False for someone who has only ever signed in with Google. */
    hasPassword: query.data?.data?.hasPassword ?? true,
    /** The departments they belong to, by id. */
    departmentIds: query.data?.data?.departmentIds ?? [],
    can: (code: PermissionCode) => codes.includes(code),
    isAgent:
      codes.includes('ticket.read.all') ||
      codes.includes('ticket.message.moderate'),
  };
}
