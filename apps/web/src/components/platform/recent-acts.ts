import {
  getPlatformAuditLogsControllerListV1QueryKey,
  getPlatformAuditLogsControllerListV1QueryOptions,
  type platformAuditLogsControllerListV1,
  type PlatformAuditLogsControllerListV1Params,
} from '@synapsedesk/api-client';
import type { QueryClient } from '@tanstack/react-query';

type Answer = Awaited<ReturnType<typeof platformAuditLogsControllerListV1>>;

/** The platform's five latest acts on an organization, as its page lists them. */
export const recentActs = (
  organizationId: string,
): PlatformAuditLogsControllerListV1Params => ({
  resourceType: 'ORGANIZATION',
  resourceId: organizationId,
  limit: 5,
  sortOrder: 'DESC',
});

const newestId = (answer: Answer | undefined) => answer?.data?.items?.[0]?.id;

/**
 * Waits for the audit entry of an act on an organization to reach its page's
 * recent acts.
 *
 * The entry is written asynchronously, so one read after the act can miss it.
 * Call this BEFORE sending the act: it notes the newest entry the cache holds
 * then. Call what it returns once the act succeeded: it re-reads the shared
 * query, at once and then up to `reads` more times `gap` ms apart, until the
 * newest entry is another one (any entry, when none was held). It stops
 * quietly at the bound, and at a failed read, whose error the page shows.
 * The reads land in the cache, so a page mounted later sees them too.
 *
 * @example
 * const landed = awaitNewAct(queryClient, organization.id);
 * await platformControllerSetStatusV1(organization.id, body);
 * void landed();
 */
export function awaitNewAct(
  queryClient: QueryClient,
  organizationId: string,
  { reads = 6, gap = 1000 } = {},
): () => Promise<boolean> {
  const params = recentActs(organizationId);
  const held = newestId(
    queryClient.getQueryData<Answer>(
      getPlatformAuditLogsControllerListV1QueryKey(params),
    ),
  );

  return async () => {
    for (let read = 0; read <= reads; read++) {
      if (read > 0) await new Promise((done) => setTimeout(done, gap));
      let answer: Answer;
      try {
        answer = await queryClient.fetchQuery({
          ...getPlatformAuditLogsControllerListV1QueryOptions(params),
          staleTime: 0,
        });
      } catch {
        return false;
      }
      const newest = newestId(answer);
      if (newest && newest !== held) return true;
    }
    return false;
  };
}
