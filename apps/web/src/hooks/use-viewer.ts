'use client';

import {
  useUsersControllerGetCurrentUserV1,
  type CurrentUserResponseDtoPermissionCodesItem as PermissionCode,
} from '@synapsedesk/api-client';
import { isAgent } from '@/lib/tickets';

/**
 * Who is looking: the signed-in user and what they may do.
 * `isAgent` is ticket-service's own rule (see `isAgent` in `lib/tickets`).
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
    isAgent: isAgent(codes),
  };
}
