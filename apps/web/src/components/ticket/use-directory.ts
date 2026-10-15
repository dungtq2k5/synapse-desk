'use client';

import {
  ApiError,
  getTicketsControllerGetV1QueryKey,
  getTicketsControllerListAssignmentsV1QueryKey,
  getTicketsControllerListStatusChangesV1QueryKey,
  useDepartmentsControllerListV1,
  useUserAdminControllerListV1,
  type ApiResponseTicketResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useViewer } from '@/hooks/use-viewer';

// ponytail: one page of 100; a search box when organizations outgrow it.
const ALL = { page: 1, limit: 100, sortBy: 'name', sortOrder: 'ASC' } as const;

/** The organization's departments, A to Z, with a name for each id. */
export function useDepartments() {
  const { can } = useViewer();
  const query = useDepartmentsControllerListV1(ALL, {
    query: { enabled: can('department.read'), staleTime: 60_000 },
  });
  const items = useMemo(() => query.data?.data?.items ?? [], [query.data]);
  const names = useMemo(
    () => new Map(items.map((department) => [department.id, department.name])),
    [items],
  );
  return { items, names, query };
}

/** The organization's people, with a name for each id. */
export function usePeople() {
  const { can } = useViewer();
  const query = useUserAdminControllerListV1(
    { ...ALL, sortBy: 'fullName' },
    { query: { enabled: can('user.read'), staleTime: 60_000 } },
  );
  const names = useMemo(
    () =>
      new Map(
        (query.data?.data?.items ?? []).map(({ user }) => [
          user.id,
          user.fullName,
        ]),
      ),
    [query.data],
  );
  return { names, query };
}

/** The people in a department, A to Z; nothing until one is chosen. */
export function usePeopleIn(departmentId: string | null) {
  const { can } = useViewer();
  const query = useUserAdminControllerListV1(
    { ...ALL, sortBy: 'fullName', departmentId: departmentId ?? undefined },
    {
      query: {
        enabled: Boolean(departmentId) && can('user.read'),
        staleTime: 60_000,
      },
    },
  );
  return { items: query.data?.data?.items ?? [], query };
}

/**
 * Keeps a ticket's cached views true after an action. An answer that is the
 * ticket replaces it in place; anything else refetches it. Either way its
 * history and assignments refetch, since the action wrote to them.
 */
export function useTicketCache(ticketId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (answer?: ApiResponseTicketResponseDto) => {
      const key = getTicketsControllerGetV1QueryKey(ticketId);
      if (answer?.data) queryClient.setQueryData(key, answer);
      else void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({
        queryKey: getTicketsControllerListStatusChangesV1QueryKey(ticketId),
      });
      void queryClient.invalidateQueries({
        queryKey: getTicketsControllerListAssignmentsV1QueryKey(ticketId),
      });
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/tickets'] });
    },
    [queryClient, ticketId],
  );
}

/** The server's own words for a refusal, or a generic line without any. */
export const serverMessage = (error: unknown): string =>
  error instanceof ApiError
    ? error.message
    : 'Check your connection and try again.';
