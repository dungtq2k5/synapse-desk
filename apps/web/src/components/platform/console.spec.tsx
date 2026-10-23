import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { paged, renderSettings, stubMatchMedia } from '@/test/settings';
import { PlatformAuditView } from './audit-view';
import { JobsView, jobRows } from './jobs-view';
import { OverviewView } from './overview-view';
import { GlobalRolesView } from './roles-view';

const params = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/platform',
  useSearchParams: () => params,
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(stubMatchMedia);

const job = (jobName: string, service: string, extra = {}) => ({
  service,
  jobName,
  lastStartedAt: '2026-10-22T02:00:00Z',
  lastSucceededAt: '2026-10-22T02:00:00Z',
  lastDurationMs: 48_000,
  lastError: null,
  consecutiveFailures: 0,
  health: 'healthy',
  ...extra,
});
const HEALTH = {
  items: [
    job('analytics-daily', 'ticket-service'),
    job('ledger-daily', 'ingestion-service', {
      health: 'failing',
      consecutiveFailures: 2,
      lastError: 'document-flags: deadline exceeded',
    }),
    job('ai-generation-rollup', 'ingestion-service', { health: 'step' }),
    job('orphan-step', 'ingestion-service', { health: 'step' }),
  ],
  degraded: true,
  unavailable: ['notification-service'],
};

describe('the jobs', () => {
  it('nests steps under their job and lists a silent service’s jobs as not reached', () => {
    const rows = jobRows(HEALTH.items as never, HEALTH.unavailable);
    expect(rows.map((row) => [row.jobName, row.health, row.step])).toEqual([
      ['analytics-daily', 'healthy', false],
      ['ledger-daily', 'failing', false],
      ['ai-generation-rollup', 'step', true],
      ['orphan-step', 'step', true],
      ['webhook-retention', 'not-reached', false],
    ]);
  });

  it('runs a job with a reason, and says what it counted', async () => {
    const calls = stubApi({
      'GET /api/v1/platform/jobs': ok(HEALTH),
      'POST /api/v1/platform/jobs/analytics-daily/run': ok({
        service: 'ticket-service',
        jobName: 'analytics-daily',
        tenants: 42,
        rows: 1268,
      }),
    });
    renderSettings(<JobsView />);
    const user = userEvent.setup();

    expect(
      await screen.findByText('The Notifications service didn’t answer'),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole('button', {
        name: 'Run now: Analytics rollup, daily',
      })[0],
    );
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Run now' }));
    expect(
      within(dialog).getByText('A reason is required.'),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Reason'), 'After an import');
    await user.click(within(dialog).getByRole('button', { name: 'Run now' }));
    expect(
      await screen.findByText('42 organizations, 1,268 rows.'),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      reason: 'After an import',
    });
  });

  it('a run the service refuses says so in the dialog', async () => {
    stubApi({
      'GET /api/v1/platform/jobs': ok(HEALTH),
      'POST /api/v1/platform/jobs/analytics-daily/run': fail(
        504,
        'ticket-service did not respond in time!',
      ),
    });
    renderSettings(<JobsView />);
    const user = userEvent.setup();
    await user.click(
      (
        await screen.findAllByRole('button', {
          name: 'Run now: Analytics rollup, daily',
        })
      )[0],
    );
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Try');
    await user.click(within(dialog).getByRole('button', { name: 'Run now' }));
    expect(
      await within(dialog).findByText(
        'ticket-service did not respond in time.',
      ),
    ).toBeInTheDocument();
  });

  it('backfills a range for one organization, and refuses a range that ends first', async () => {
    const calls = stubApi({
      'GET /api/v1/platform/jobs': ok(HEALTH),
      'GET /api/v1/platform/organizations': paged([
        { organization: { id: 'org-1', name: 'Northwind Health' } },
      ]),
      'POST /api/v1/platform/jobs/ledger-daily/backfill': ok({
        service: 'ingestion-service',
        jobName: 'ledger-daily',
        tenants: 1,
        rows: 42,
      }),
    });
    renderSettings(<JobsView />);
    const user = userEvent.setup();
    await user.click(
      (
        await screen.findAllByRole('button', {
          name: 'Backfill: Usage ledger, daily',
        })
      )[0],
    );
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText(/Only its AI usage rollup is redone\./),
    ).toBeInTheDocument();

    const from = within(dialog).getByLabelText('From');
    const to = within(dialog).getByLabelText('To');
    await user.clear(from);
    await user.type(from, '2026-10-05');
    await user.clear(to);
    await user.type(to, '2026-10-01');
    await user.click(within(dialog).getByRole('button', { name: 'Backfill' }));
    expect(
      within(dialog).getByText('The start must be on or before the end.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('A reason is required.'),
    ).toBeInTheDocument();

    await user.clear(to);
    await user.type(to, '2026-10-06');
    await user.type(within(dialog).getByLabelText('Reason'), 'Late import');
    await user.click(within(dialog).getByLabelText('Organization'));
    await user.click(
      await screen.findByRole('option', { name: 'Northwind Health' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Backfill' }));

    expect(await screen.findByText('Backfill complete')).toBeInTheDocument();
    expect(calls.find((call) => call.url.includes('backfill'))?.body).toEqual({
      from: '2026-10-05',
      to: '2026-10-06',
      reason: 'Late import',
      organizationId: 'org-1',
    });
  });

  it('a list that can’t be read says so', async () => {
    stubApi({ 'GET /api/v1/platform/jobs': fail(500, 'Broken!') });
    renderSettings(<JobsView />);
    expect(await screen.findByText('Couldn’t load jobs')).toBeInTheDocument();
  });
});

describe('global roles', () => {
  const routes = (post = ok({ id: 'r-new' }, 201)) => ({
    'GET /api/v1/platform/roles': paged([
      {
        id: 'r1',
        name: 'Auditor',
        description: 'Reads the audit log.',
        isSystemRole: false,
        permissionCodes: ['audit.read'],
      },
    ]),
    'GET /api/v1/platform/metrics': ok({ totalOrganizations: 42 }),
    'POST /api/v1/platform/roles': post,
  });

  it('creates one every organization gets, with the permissions ticked', async () => {
    const calls = stubApi(routes());
    renderSettings(<GlobalRolesView />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'New global role' }),
    );
    expect(
      await screen.findByText(/^All 42 organizations see it/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Create global role' }),
    );
    expect(screen.getByText('Required.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'Billing viewer');
    await user.type(screen.getByLabelText('What it’s for'), 'Sees billing.');
    await user.click(screen.getByLabelText('View the audit log'));
    await user.click(
      screen.getByRole('button', { name: 'Create global role' }),
    );

    expect(
      await screen.findByText('Billing viewer is created'),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Billing viewer',
      description: 'Sees billing.',
      permissionCodes: ['audit.read'],
    });
  });

  it('a taken name is said under the field', async () => {
    stubApi(routes(fail(409, 'A role with this name already exists!')));
    renderSettings(<GlobalRolesView />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'New global role' }),
    );
    await user.type(screen.getByLabelText('Name'), 'Auditor');
    await user.click(
      screen.getByRole('button', { name: 'Create global role' }),
    );
    expect(
      await screen.findByText('A role named Auditor already exists.'),
    ).toBeInTheDocument();
  });
});

describe('the platform’s audit log', () => {
  const ENTRY = {
    id: 'a1',
    organizationId: null,
    userId: 'sa-1',
    action: 'PLATFORM_JOB_BACKFILLED',
    resourceType: 'JOB',
    resourceId: null,
    ipAddress: '203.0.113.9',
    userAgent: 'x',
    metadata: {
      jobName: 'analytics-daily',
      reason: 'Late import',
      from: '2026-10-01',
      to: '2026-10-03',
      organizationId: 'org-1',
      tenants: 1,
      rows: 42,
    },
    createdAt: '2026-10-22T10:30:00Z',
    actorName: 'Ana Ruiz',
    resourceName: null,
  };

  it('reads each entry in words, opens one, and filters by who and when', async () => {
    const calls = stubApi({
      'GET /api/v1/platform/audit-logs': paged([ENTRY]),
      'GET /api/v1/platform/audit-logs/actions': ok({
        actions: ['PLATFORM_JOB_BACKFILLED'],
      }),
      'GET /api/v1/platform/organizations': paged([
        { organization: { id: 'org-1', name: 'Northwind Health' } },
      ]),
    });
    renderSettings(<PlatformAuditView />);
    const user = userEvent.setup();

    expect(
      await screen.findAllByText(
        'Job · 1 Oct 2026 – 3 Oct 2026, Northwind Health · 1 organization, 42 rows',
      ),
    ).not.toHaveLength(0);
    await user.click(
      screen.getAllByRole('button', { name: /Recomputed|Oct 2026/ })[0],
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent('Late import');
    await user.keyboard('{Escape}');

    await user.click(screen.getByLabelText('Person'));
    await user.click(await screen.findByRole('option', { name: 'Ana Ruiz' }));
    await user.click(screen.getByLabelText('When'));
    await user.click(
      await screen.findByRole('option', { name: 'Last 7 days' }),
    );
    await waitFor(() => expect(calls.at(-1)?.url).toContain('userId=sa-1'));
  });

  it('filtered to one organization, shows it as a chip that clears', async () => {
    params.set('resourceType', 'ORGANIZATION');
    params.set('resourceId', 'org-1');
    const calls = stubApi({
      'GET /api/v1/platform/audit-logs': paged([]),
      'GET /api/v1/platform/audit-logs/actions': ok({ actions: [] }),
      'GET /api/v1/platform/organizations': paged([
        { organization: { id: 'org-1', name: 'Northwind Health' } },
      ]),
    });
    renderSettings(<PlatformAuditView />);
    const user = userEvent.setup();

    expect(await screen.findByText('No entries match')).toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', { name: /Northwind Health/ }),
    );
    await waitFor(() => expect(calls.at(-1)?.url).not.toContain('resourceId'));
    params.delete('resourceType');
    params.delete('resourceId');
  });
});

describe('the overview', () => {
  it('is an error only when none of its reads answered', async () => {
    stubApi({
      'GET /api/v1/platform/metrics': fail(500, 'x'),
      'GET /api/v1/platform/finance': fail(500, 'x'),
      'GET /api/v1/platform/jobs': fail(500, 'x'),
    });
    renderSettings(<OverviewView />);
    expect(
      await screen.findByText('Couldn’t load the overview'),
    ).toBeInTheDocument();
  });

  it('keeps each part that answered when one doesn’t', async () => {
    stubApi({
      'GET /api/v1/platform/metrics': fail(500, 'x'),
      'GET /api/v1/platform/finance': fail(500, 'x'),
      'GET /api/v1/platform/jobs': ok({
        items: [],
        degraded: false,
        unavailable: [],
      }),
      'GET /api/v1/platform/finance/events': fail(500, 'x'),
    });
    renderSettings(<OverviewView />);
    expect(
      await screen.findByText('The platform’s numbers couldn’t be read'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('The plan mix couldn’t be read'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('The billing events couldn’t be read'),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing needs attention.')).toBeInTheDocument();
  });
});
