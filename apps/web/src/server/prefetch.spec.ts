/**
 * @jest-environment node
 */
jest.mock('server-only', () => ({}));
jest.mock('next/headers', () => ({ headers: jest.fn() }));

import { ApiError } from '@synapsedesk/api-client';
import { prefetch, renderClient } from './prefetch';
import { Unauthenticated } from './server-fetcher';

describe('prefetch', () => {
  it('fills the cache when the gateway answers', async () => {
    const { queryClient } = renderClient();
    await prefetch(queryClient, {
      queryKey: ['tickets'],
      queryFn: () => Promise.resolve({ data: [1] }),
    });
    expect(queryClient.getQueryData(['tickets'])).toEqual({ data: [1] });
  });

  it('renders without data on Unauthenticated: the browser fetches it', async () => {
    const { queryClient } = renderClient();
    await expect(
      prefetch(queryClient, {
        queryKey: ['tickets'],
        queryFn: () => Promise.reject(new Unauthenticated()),
      }),
    ).resolves.toBeUndefined();
    expect(queryClient.getQueryData(['tickets'])).toBeUndefined();
  });

  it('throws anything else, for the error boundary', async () => {
    const { queryClient } = renderClient();
    await expect(
      prefetch(queryClient, {
        queryKey: ['tickets'],
        queryFn: () => Promise.reject(new ApiError(500, null)),
        retry: false,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
