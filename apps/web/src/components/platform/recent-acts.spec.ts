import { getPlatformAuditLogsControllerListV1QueryKey } from '@synapsedesk/api-client';
import { QueryClient } from '@tanstack/react-query';
import { fail, stubApi } from '@/test/api';
import { paged } from '@/test/settings';
import { awaitNewAct, recentActs } from './recent-acts';

const ROUTE = 'GET /api/v1/platform/audit-logs';
const entry = (id: string) => ({ id, action: 'PLATFORM_ORGANIZATION_FROZEN' });
const key = getPlatformAuditLogsControllerListV1QueryKey(recentActs('org-1'));

describe('awaitNewAct', () => {
  it('re-reads until an entry newer than the one held arrives, and the cache shows it', async () => {
    const client = new QueryClient();
    client.setQueryData(key, paged([entry('old')]).body);
    const replies = [
      [entry('old')],
      [entry('old')],
      [entry('new'), entry('old')],
    ];
    const calls = stubApi({ [ROUTE]: () => paged(replies.shift() ?? []) });

    const landed = awaitNewAct(client, 'org-1', { gap: 0 });

    await expect(landed()).resolves.toBe(true);
    expect(calls).toHaveLength(3);
    expect(
      client.getQueryData<{ data: { items: { id: string }[] } }>(key)?.data
        .items[0].id,
    ).toBe('new');
  });

  it('stops quietly at the bound when no entry arrives', async () => {
    const client = new QueryClient();
    client.setQueryData(key, paged([entry('old')]).body);
    const calls = stubApi({ [ROUTE]: paged([entry('old')]) });

    await expect(awaitNewAct(client, 'org-1', { gap: 0 })()).resolves.toBe(
      false,
    );
    // The immediate read and six more.
    expect(calls).toHaveLength(7);
  });

  it('takes any entry when the page held none', async () => {
    const client = new QueryClient();
    const calls = stubApi({ [ROUTE]: paged([entry('first')]) });

    await expect(awaitNewAct(client, 'org-1', { gap: 0 })()).resolves.toBe(
      true,
    );
    expect(calls).toHaveLength(1);
  });

  it('stops at a failed read, leaving the error to the page', async () => {
    const client = new QueryClient();
    const calls = stubApi({ [ROUTE]: fail(500, 'Something went wrong.') });

    await expect(awaitNewAct(client, 'org-1', { gap: 0 })()).resolves.toBe(
      false,
    );
    expect(calls).toHaveLength(1);
    expect(client.getQueryState(key)?.status).toBe('error');
  });
});
