import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Call, type Reply } from '@/test/api';
import {
  ORGANIZATION,
  paged,
  renderSettings,
  stubMatchMedia,
  viewer,
} from '@/test/settings';
import {
  AGENTS,
  AI_USAGE,
  DOCUMENTS,
  EMPTY,
  FEEDBACK_PAGE,
  FROM,
  GAPS,
  OVERVIEW,
  PREVIOUS,
  series,
  TO,
} from '@/test/analytics-data';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentsView } from './agents-view';
import { AiUsageView } from './ai-usage-view';
import { FeedbackView } from './feedback-view';
import { KnowledgeView } from './knowledge-view';
import { OverviewView } from './overview-view';

const replace = jest.fn();
let search = new URLSearchParams();
let pathname = '/analytics';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, refresh: jest.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}));
jest.mock('@/components/shell/app-header', () => ({ AppHeader: () => null }));

beforeAll(() => {
  stubMatchMedia();
  // jsdom lays nothing out; the charts draw at a card's width.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  });
});
beforeEach(() => {
  jest.useFakeTimers({
    now: new Date('2026-10-19T18:00:00'),
    advanceTimers: true,
  });
  search = new URLSearchParams(`from=${FROM}&to=${TO}`);
  pathname = '/analytics';
  replace.mockClear();
  localStorage.clear();
});
afterEach(() => jest.useRealTimers());

const READER = ['analytics.read', 'organization.read', 'department.read'];

type Route = Reply | ((body: unknown, url: string) => Reply);

const by = (url: string) =>
  new URL(url, 'http://web').searchParams.get('granularity') ?? 'DAY';

/** Every analytics call answered with the handoff's sample. */
const SAMPLE: Record<string, Route> = {
  'GET /api/v1/analytics/overview': (_, url) =>
    ok(
      new URL(url, 'http://web').searchParams.get('from') === FROM
        ? OVERVIEW
        : PREVIOUS,
    ),
  'GET /api/v1/analytics/volume': (_, url) => ok(series(by(url)).volume),
  'GET /api/v1/analytics/deflection': (_, url) =>
    ok(series(by(url)).deflection),
  'GET /api/v1/analytics/satisfaction': (_, url) =>
    ok(series(by(url)).satisfaction),
  'GET /api/v1/analytics/response-times': (_, url) =>
    ok(series(by(url)).responseTimes),
  'GET /api/v1/analytics/agents': ok(AGENTS),
  'GET /api/v1/analytics/knowledge-gaps': ok(GAPS),
  'GET /api/v1/analytics/documents': ok(DOCUMENTS),
  'GET /api/v1/analytics/ai-usage': ok(AI_USAGE),
  'GET /api/v1/feedback': ok(FEEDBACK_PAGE),
  'GET /api/v1/departments': paged([
    { id: 'hr', name: 'HR', description: null, memberCount: 3 },
  ]),
};

function open(
  ui: React.ReactNode,
  routes: Record<string, Route> = {},
  codes = READER,
  rangeDays = 180,
): Call[] {
  const calls = stubApi({
    ...viewer(codes),
    'GET /api/v1/organizations/current': ok({
      ...ORGANIZATION,
      analyticsRangeDays: rangeDays,
    }),
    ...SAMPLE,
    ...routes,
  });
  renderSettings(<TooltipProvider>{ui}</TooltipProvider>);
  return calls;
}

const user = () =>
  userEvent.setup({ advanceTimers: jest.advanceTimersByTime.bind(jest) });

describe('the Analytics frame', () => {
  it('shows the unavailable page without analytics.read', async () => {
    open(<OverviewView />, {}, ['organization.read']);
    expect(
      await screen.findByText('This page isn’t available'),
    ).toBeInTheDocument();
  });

  it('keeps the granularity and the department in the address', async () => {
    open(<OverviewView />);
    await user().click(await screen.findByRole('radio', { name: 'Week' }));
    expect(replace).toHaveBeenLastCalledWith(
      expect.stringContaining('by=week'),
      { scroll: false },
    );
    await user().click(screen.getByRole('combobox', { name: 'Department' }));
    await user().click(await screen.findByRole('option', { name: 'HR' }));
    expect(replace).toHaveBeenLastCalledWith(
      expect.stringContaining('department=hr'),
      { scroll: false },
    );
  });

  it('clamps a range past the plan, once, with a toast', async () => {
    search = new URLSearchParams('from=2026-01-01&to=2026-10-19');
    open(<OverviewView />, {}, READER, 30);
    expect(
      await screen.findByText('Showing the last 30 days'),
    ).toBeInTheDocument();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('applies a preset from the range picker, and locks those past the plan', async () => {
    open(<OverviewView />, {}, READER, 30);
    await user().click(
      await screen.findByRole('button', { name: /20 Sept – 19 Oct 2026/ }),
    );
    const presets = await screen.findByRole('listbox', { name: 'Presets' });
    const locked = within(presets).getByRole('option', {
      name: 'Last 90 days',
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('link', { name: 'See plans in Billing' }),
    ).toHaveAttribute('href', '/settings/billing');
    await user().click(locked);
    fireEvent.keyDown(
      within(presets).getByRole('option', { name: 'Last 7 days' }),
      { key: 'Enter' },
    );
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    expect(replace).toHaveBeenLastCalledWith(
      expect.stringContaining('from=2026-10-13&to=2026-10-19'),
      { scroll: false },
    );
  });

  it('picks a custom range on the calendar', async () => {
    open(<OverviewView />);
    await user().click(
      await screen.findByRole('button', { name: /20 Sept – 19 Oct 2026/ }),
    );
    const month = await screen.findByRole('group', { name: 'October 2026' });
    await user().click(
      within(month).getByRole('button', { name: /^5 October/ }),
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.keyDown(month, { key: 'ArrowRight' });
    await user().click(
      within(month).getByRole('button', { name: /^12 October/ }),
    );
    await user().click(screen.getByRole('button', { name: 'Previous month' }));
    expect(
      screen.getByRole('group', { name: 'September 2026' }),
    ).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Next month' }));
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    expect(replace).toHaveBeenLastCalledWith(
      expect.stringContaining('from=2026-10-05&to=2026-10-12'),
      { scroll: false },
    );
  });
});

describe('Overview', () => {
  it('draws the tiles with their change, the charts and the breakdowns', async () => {
    open(<OverviewView />);
    expect(await screen.findByText('Tickets created')).toBeInTheDocument();
    expect(
      await screen.findByText('Data through 19 Oct 2026'),
    ).toBeInTheDocument();
    for (const title of [
      'Volume',
      'Deflection',
      'Satisfaction',
      'Response times',
    ]) {
      expect(
        await screen.findByRole('figure', { name: title }),
      ).toBeInTheDocument();
    }
  });

  it('turns a chart into a table and reads it out by keyboard', async () => {
    open(<OverviewView />);
    const volume = await screen.findByRole('figure', { name: 'Volume' });
    const plot = await within(volume).findByRole('group', {
      name: /Volume\. Use the arrow keys/,
    });
    fireEvent.keyDown(plot, { key: 'End' });
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    fireEvent.keyDown(plot, { key: 'Home' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.mouseMove(plot, { clientX: 200 });
    fireEvent.mouseLeave(plot);
    await user().click(within(volume).getByRole('radio', { name: 'Table' }));
    expect(
      within(volume).getByRole('region', { name: 'Volume as a table' }),
    ).toBeInTheDocument();
  });

  it('says a new organization has nothing yet', async () => {
    open(<OverviewView />, {
      'GET /api/v1/analytics/overview': ok(EMPTY.overview),
      'GET /api/v1/analytics/volume': ok(EMPTY.volume),
      'GET /api/v1/analytics/deflection': ok(EMPTY.deflection),
      'GET /api/v1/analytics/satisfaction': ok(EMPTY.satisfaction),
      'GET /api/v1/analytics/response-times': ok(EMPTY.responseTimes),
    });
    expect(
      await screen.findByText('No tickets in this period'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('No ratings yet')).not.toHaveLength(0);
  });

  it('says when nothing is computed yet', async () => {
    const none = { dataThrough: null, computedAt: null };
    open(<OverviewView />, {
      'GET /api/v1/analytics/overview': ok({ ...EMPTY.overview, ...none }),
      'GET /api/v1/analytics/volume': ok({ ...EMPTY.volume, ...none }),
    });
    expect(await screen.findAllByText('Not computed yet')).not.toHaveLength(0);
  });

  it('shows each chart’s failure on its own', async () => {
    const calls = open(<OverviewView />, {
      'GET /api/v1/analytics/volume': fail(500, 'Internal'),
      'GET /api/v1/analytics/deflection': fail(500, 'Internal'),
      'GET /api/v1/analytics/satisfaction': fail(500, 'Internal'),
      'GET /api/v1/analytics/response-times': fail(500, 'Internal'),
    });
    expect(
      await screen.findByText(/Couldn’t load the volume/),
    ).toBeInTheDocument();
    expect(screen.getByText('Tickets created')).toBeInTheDocument();
    const before = calls.length;
    for (const button of screen.getAllByRole('button', { name: 'Try again' })) {
      await user().click(button);
    }
    await waitFor(() =>
      expect(calls.length).toBeGreaterThanOrEqual(before + 4),
    );
  });

  it('fails as a whole when the overview fails, and tries again', async () => {
    const calls = open(<OverviewView />, {
      'GET /api/v1/analytics/overview': fail(500, 'Internal'),
    });
    expect(
      await screen.findByText(/Couldn’t load analytics/),
    ).toBeInTheDocument();
    const before = calls.length;
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it('dashes a week the range only partly covers', async () => {
    search = new URLSearchParams(`from=${FROM}&to=${TO}&by=week`);
    open(<OverviewView />);
    expect(
      (await screen.findAllByText(/so it’s dashed\./)).length,
    ).toBeGreaterThan(0);
  });
});

describe('Agents', () => {
  it('lists the agents by name and sorts by a column', async () => {
    pathname = '/analytics/agents';
    open(<AgentsView />);
    const table = await screen.findByRole('table');
    const names = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(names()[0]).toContain('Alex Rivera');
    await user().click(within(table).getByRole('button', { name: /Resolved/ }));
    expect(names()[0]).toContain('Jordan Lee');
    await user().click(within(table).getByRole('button', { name: /Resolved/ }));
    expect(names()[0]).toContain('Maya Chen');
  });

  it('names each unavailable block and keeps the rest', async () => {
    open(<AgentsView />, {
      'GET /api/v1/analytics/agents': ok({
        ...AGENTS,
        unavailable: [
          { source: 'auth-service', reason: 'down' },
          { source: 'ingestion-service', reason: 'down' },
        ],
      }),
    });
    expect(
      await screen.findByText('Agent names couldn’t be read'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('AI draft acceptance couldn’t be read'),
    ).toBeInTheDocument();
    expect(screen.queryByText('down')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });

  it('offers to clear the department when it has nobody', async () => {
    search = new URLSearchParams(`from=${FROM}&to=${TO}&department=hr`);
    open(<AgentsView />, {
      'GET /api/v1/analytics/agents': ok({ ...AGENTS, items: [] }),
    });
    expect(
      await screen.findByText('No agent activity in this period'),
    ).toBeInTheDocument();
    await user().click(
      screen.getByRole('button', { name: 'Clear the department' }),
    );
    expect(replace).toHaveBeenLastCalledWith(
      expect.not.stringContaining('department='),
      { scroll: false },
    );
  });
});

describe('Knowledge', () => {
  it('shows the gaps, the open flags and the document lists', async () => {
    open(<KnowledgeView />);
    expect(
      await screen.findByText('Answers that found no documents'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'All quality flags' }),
    ).toHaveAttribute('href', '/knowledge/flags');
    expect(screen.getByText('Most cited')).toBeInTheDocument();
    expect(
      screen.getByText('These numbers are for the whole organization.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Department' }),
    ).not.toBeInTheDocument();
  });

  it('says what’s empty', async () => {
    open(<KnowledgeView />, {
      'GET /api/v1/analytics/knowledge-gaps': ok(EMPTY.gaps),
      'GET /api/v1/analytics/documents': ok(EMPTY.documents),
    });
    expect(await screen.findByText('No open flags')).toBeInTheDocument();
    expect(screen.getByText('No rated citations yet')).toBeInTheDocument();
    expect(screen.getAllByText('No answers yet')).toHaveLength(2);
  });

  it('shows each unavailable block in its place', async () => {
    open(<KnowledgeView />, {
      'GET /api/v1/analytics/knowledge-gaps': ok({
        ...GAPS,
        unavailable: [{ source: 'ingestion-service', reason: 'down' }],
      }),
      'GET /api/v1/analytics/documents': ok({
        ...DOCUMENTS,
        unavailable: [
          { source: 'ingestion-service', reason: 'down' },
          { source: 'ticket-service', reason: 'down' },
        ],
      }),
    });
    expect(
      await screen.findByText('The gaps couldn’t be read'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The open flags couldn’t be read'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Citation accuracy couldn’t be read'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The document lists couldn’t be read'),
    ).toBeInTheDocument();
  });

  it('fails as a whole when both calls fail', async () => {
    open(<KnowledgeView />, {
      'GET /api/v1/analytics/knowledge-gaps': fail(500, 'Internal'),
      'GET /api/v1/analytics/documents': fail(500, 'Internal'),
    });
    expect(
      await screen.findByText(/Couldn’t load analytics/),
    ).toBeInTheDocument();
  });
});

describe('AI usage', () => {
  it('shows the allowance, the spend and the purposes', async () => {
    open(<AiUsageView />);
    expect(
      await screen.findByText('This month’s AI allowance'),
    ).toBeInTheDocument();
    expect(screen.getByText('$4.59 of $10.00')).toBeInTheDocument();
    expect(
      screen.getByText('The allowance resets on 1 Nov 2026.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Where it goes: by purpose')).toBeInTheDocument();
  });

  it('warns when the allowance is spent', async () => {
    open(<AiUsageView />, {
      'GET /api/v1/analytics/ai-usage': ok({
        ...AI_USAGE,
        cycleSpentMicros: 10_420_000,
      }),
    });
    expect(
      await screen.findByText('Over this month’s AI allowance'),
    ).toBeInTheDocument();
    expect(screen.getByText('104% used')).toBeInTheDocument();
  });

  it('says when the spend couldn’t be read', async () => {
    open(<AiUsageView />, {
      'GET /api/v1/analytics/ai-usage': ok({
        ...AI_USAGE,
        cycleSpentMicros: null,
      }),
    });
    expect(
      await screen.findByText(/The spend couldn’t be read/),
    ).toBeInTheDocument();
  });

  it('says when there’s no AI use yet', async () => {
    open(<AiUsageView />, {
      'GET /api/v1/analytics/ai-usage': ok({
        ...AI_USAGE,
        points: [],
        byPurpose: [],
        byModel: [],
        totalCostMicros: 0,
        totalGenerations: 0,
      }),
    });
    expect(await screen.findAllByText('No AI use yet')).not.toHaveLength(0);
  });
});

describe('Feedback', () => {
  it('lists ratings live, each opening its ticket, without names', async () => {
    open(<FeedbackView />);
    expect(
      (await screen.findAllByRole('link', { name: 'Ticket #1042' }))[0],
    ).toHaveAttribute('href', `/tickets/${FEEDBACK_PAGE.items[0].ticketId}`);
    expect(
      screen.getByText('Live: new ratings appear as they come in'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: 'Week' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Maya Chen')).not.toBeInTheDocument();
  });

  it('filters by rating, citations and words', async () => {
    const calls = open(<FeedbackView />);
    await screen.findAllByRole('link', { name: 'Ticket #1042' });
    await user().click(screen.getByRole('combobox', { name: 'Rating' }));
    await user().click(
      await screen.findByRole('option', { name: 'Not helpful' }),
    );
    await user().click(screen.getByRole('combobox', { name: 'Citations' }));
    await user().click(
      await screen.findByRole('option', { name: 'Inaccurate' }),
    );
    await user().type(screen.getByRole('searchbox'), 'policy');
    await waitFor(() => {
      const last = calls
        .filter((call) => call.url.includes('/feedback'))
        .at(-1);
      expect(last?.url).toEqual(
        expect.stringMatching(
          /rating=-1.*citationAccurate=false|citationAccurate=false.*rating=-1/,
        ),
      );
      expect(last?.url).toContain('searchTerm=policy');
    });
  });

  it('offers to clear filters that match nothing', async () => {
    open(<FeedbackView />, {
      'GET /api/v1/feedback': (_, url) =>
        url.includes('searchTerm') ? paged([]) : ok(FEEDBACK_PAGE),
    });
    await screen.findAllByRole('link', { name: 'Ticket #1042' });
    await user().type(screen.getByRole('searchbox'), 'zzz');
    await user().click(
      await screen.findByRole('button', { name: 'Clear filters' }),
    );
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('says when there’s no feedback yet', async () => {
    open(<FeedbackView />, { 'GET /api/v1/feedback': paged([]) });
    expect(await screen.findByText('No feedback yet')).toBeInTheDocument();
  });
});

describe('Export', () => {
  const READY = {
    id: 'x1',
    kind: 'TICKET',
    status: 'READY',
    downloadUrl: 'https://files.test/x1.csv',
    rollupComputedAt: null,
  };

  it('asks for an export and shows it ready, across pages', async () => {
    const calls = open(<OverviewView />, {
      'POST /api/v1/analytics/export': ok({ id: 'x1', status: 'PENDING' }, 201),
      'GET /api/v1/analytics/export/x1': ok(READY),
    });
    await user().click(await screen.findByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Export analytics',
    });
    await user().click(
      within(dialog).getByRole('radio', { name: 'Agents per day' }),
    );
    await user().click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Your export is ready')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      kind: 'AGENT_DAILY',
      from: FROM,
      to: TO,
      departmentId: null,
    });
    const open_ = jest.spyOn(window, 'open').mockReturnValue(null);
    await user().click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(open_).toHaveBeenCalledWith(READY.downloadUrl);
  });

  it('refuses a range longer than an export takes', async () => {
    search = new URLSearchParams('from=2026-04-01&to=2026-10-19');
    open(<OverviewView />);
    await user().click(await screen.findByRole('button', { name: 'Export' }));
    expect(
      await screen.findByText(
        /An export can cover up to 92 days\. This range is 180\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Export',
      }),
    ).toBeDisabled();
  });

  it('shows a waiting export, then a failed one to try again', async () => {
    localStorage.setItem(
      'synapsedesk.analytics-export',
      JSON.stringify({
        id: 'x1',
        kind: 'TICKET_DAILY',
        from: FROM,
        to: TO,
        departmentId: null,
        department: 'all departments',
      }),
    );
    let status = 'PENDING';
    const calls = open(<OverviewView />, {
      'GET /api/v1/analytics/export/x1': () =>
        ok({ ...READY, status, downloadUrl: null }),
      'POST /api/v1/analytics/export': ok({ id: 'x2', status: 'PENDING' }, 201),
      'GET /api/v1/analytics/export/x2': ok({
        ...READY,
        id: 'x2',
        rollupComputedAt: '2026-10-20T02:10:00.000Z',
      }),
    });
    expect(
      await screen.findByText('Preparing your export…'),
    ).toBeInTheDocument();
    status = 'FAILED';
    await act(() => jest.advanceTimersByTimeAsync(2500));
    await user().click(
      await screen.findByRole('button', { name: 'Try again' }),
    );
    expect(
      await screen.findByText(/Data computed 20 Oct 2026/),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('forgets an export that’s gone', async () => {
    localStorage.setItem(
      'synapsedesk.analytics-export',
      JSON.stringify({
        id: 'gone',
        kind: 'TICKET',
        from: FROM,
        to: TO,
        departmentId: null,
        department: 'all departments',
      }),
    );
    open(<OverviewView />, {
      'GET /api/v1/analytics/export/gone': fail(404, 'Not found'),
    });
    await screen.findByText('Tickets created');
    await waitFor(() =>
      expect(localStorage.getItem('synapsedesk.analytics-export')).toBeNull(),
    );
  });
});
