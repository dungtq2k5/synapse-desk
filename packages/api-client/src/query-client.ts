import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

/**
 * A `QueryClient` with the client's defaults: a 4xx is an answer, not a
 * failure, so it is never retried; anything else is retried twice.
 *
 * @example
 * const [queryClient] = useState(createQueryClient);
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status < 500) && failures < 2,
      },
    },
  });
}
