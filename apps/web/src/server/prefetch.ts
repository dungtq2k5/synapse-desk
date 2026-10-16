import 'server-only';
import { createQueryClient } from '@synapsedesk/api-client';
import {
  dehydrate,
  type DehydratedState,
  type QueryClient,
  type QueryExecuteOptions,
  type QueryKey,
} from '@tanstack/react-query';
import { Unauthenticated } from './server-fetcher';

/**
 * Fetches a page's data during server rendering, through the server fetcher.
 *
 * **`Unauthenticated` is not an error:** the access cookie expired, so the
 * query is left empty and the browser fetches it, refreshing first. Anything
 * else (a 5xx, a 404) throws, for the page to handle or its error boundary to
 * show. `query`, not `prefetchQuery`, because the latter swallows every error,
 * a 500 included.
 *
 * @example await prefetch(queryClient, getTicketsControllerListV1QueryOptions(params, { request: { fetcher } }));
 */
export async function prefetch<T, K extends QueryKey>(
  queryClient: QueryClient,
  options: QueryExecuteOptions<T, Error, T, T, K>,
): Promise<void> {
  try {
    await queryClient.query(options);
  } catch (error) {
    if (!(error instanceof Unauthenticated)) throw error;
  }
}

/** A fresh client for one render, and its state for `HydrationBoundary`. */
export function renderClient(): {
  queryClient: QueryClient;
  state: () => DehydratedState;
} {
  const queryClient = createQueryClient();
  return { queryClient, state: () => dehydrate(queryClient) };
}
