import { useQueryClient } from '@tanstack/react-query';

/** Refetches every view of the organization after a change. */
export function useOrganizationCache() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === 'string' &&
        queryKey[0].startsWith('/api/v1/organizations/current'),
    });
}
