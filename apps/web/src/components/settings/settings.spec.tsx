import { ApiError } from '@synapsedesk/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { roleDescription } from '@/lib/administration';
import { logTime } from '@/lib/format';
import { fail, ok, stubApi } from '@/test/api';
import { changes, rangeBounds, rangeLabel } from './audit/audit-view';
import { DepartmentView } from './departments/department-view';
import { PersonView } from './people/person-view';
import {
  DepartmentsView,
  stillHasMembers,
} from './departments/departments-view';
import { RoleView } from './roles/role-view';
import { escalationRefusal } from './roles/roles-view';
import { meterLevel } from './usage-meter';
import { EndpointDialog, eventCount, whyOff } from './webhooks/webhooks-view';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/shell/app-header', () => ({
  AppHeader: () => null,
}));

beforeAll(() => {
  // Radix sizes a checkbox's hidden input with it; jsdom has none.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = ((media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

const apiError = (status: number, message: string) =>
  new ApiError(status, { error: message });

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const viewer = (codes: string[]) => ({
  'GET /api/v1/users/me': ok({
    user: { id: 'maya', fullName: 'Maya Chen', email: 'maya@acme.test' },
    permissionCodes: codes,
    departmentIds: [],
  }),
});

describe('the words', () => {
  it('says why an endpoint is off from its data, never from the sentence', () => {
    expect(
      whyOff({
        disabledCode: 'CONSECUTIVE_FAILURES',
        consecutiveFailures: 10,
        // The count comes from the data even when the sentence says another.
        disabledReason: 'Auto-disabled after 3 consecutive failed deliveries',
      }),
    ).toBe('Deliveries failed 10 times in a row.');
    expect(
      whyOff({
        disabledCode: null,
        consecutiveFailures: 0,
        disabledReason: 'Turned off by hand!',
      }),
    ).toBe('Turned off by hand.');
  });

  it('counts events, all of them by name', () => {
    expect(eventCount(1, 10)).toBe('1 event');
    expect(eventCount(2, 10)).toBe('2 events');
    expect(eventCount(10, 10)).toBe('All 10 events');
  });

  it('says how many members block a delete', () => {
    const refusal = stillHasMembers(
      { name: 'HR' },
      apiError(
        409,
        'This department still has 6 member(s). Reassign them before deleting it!',
      ),
    );
    expect(refusal?.title).toBe('HR still has 6 members');
    expect(stillHasMembers({ name: 'HR' }, apiError(500, 'Down!'))).toBeNull();
  });

  it('names what isn’t the viewer’s to give, in words', () => {
    const refusal = escalationRefusal(
      apiError(
        403,
        'You cannot grant permission(s) you do not hold: audit.export, user.lock!',
      ),
    );
    expect(refusal?.title).toBe('You can’t grant permissions you don’t hold');
    expect(refusal?.description).toBe(
      'Export the audit log, Lock and unlock people isn’t yours to give. Untick it, or ask an Org Admin to change this role.',
    );
  });

  it('describes a system role in words, a custom one as written', () => {
    expect(
      roleDescription(
        { name: 'Org Admin', isSystemRole: true, description: null },
        'Acme',
      ),
    ).toBe(
      'Everything in Acme: people, roles, departments, knowledge and settings.',
    );
    expect(
      roleDescription(
        { name: 'Night shift', isSystemRole: false, description: 'Evenings.' },
        'Acme',
      ),
    ).toBe('Evenings.');
  });

  it('writes a log time by day', () => {
    const now = new Date('2026-10-18T15:00:00Z');
    expect(logTime('2026-10-18T14:20:00Z', now, 'UTC')).toBe('Today, 14:20');
    expect(logTime('2026-10-17T18:02:00Z', now, 'UTC')).toBe(
      'Yesterday, 18:02',
    );
    expect(logTime('2026-10-15T08:40:00Z', now, 'UTC')).toBe('15 Oct, 08:40');
  });

  it('turns a preset into its first and last moment', () => {
    const now = new Date(2026, 9, 18, 15, 0);
    expect(rangeBounds('today', now).from).toEqual(new Date(2026, 9, 18));
    expect(rangeBounds('week', now).from).toEqual(new Date(2026, 9, 12));
    expect(rangeBounds('month', now).from).toEqual(new Date(2026, 8, 19));
    expect(rangeBounds('year', now).from).toEqual(new Date(2026, 0, 1));
    expect(rangeLabel(new Date(2026, 9, 1), new Date(2026, 9, 18))).toBe(
      '1 Oct – 18 Oct 2026',
    );
  });

  it('shows what changed: before and after, then each other detail', () => {
    expect(
      changes({
        before: { locked: false },
        after: { locked: true, lockedUntil: '21 Oct' },
        reason: 'Stolen',
      }),
    ).toEqual([
      { field: 'Locked', before: 'No', after: 'Yes' },
      { field: 'Locked until', before: '—', after: '21 Oct' },
      { field: 'Reason', before: '—', after: 'Stolen' },
    ]);
    expect(changes(null)).toEqual([]);
  });
});

describe('a department', () => {
  const member = (id: string, fullName: string, isPrimary: boolean) => ({
    user: { id, fullName, email: `${id}@acme.test`, avatarUrl: null },
    isPrimary,
    assignedByName: 'Maya Chen',
    assignedAt: '2026-03-03T09:00:00Z',
  });
  const routes = (codes: string[]) => ({
    ...viewer(codes),
    'GET /api/v1/departments/hr': ok({
      id: 'hr',
      name: 'HR',
      description: 'People operations.',
      memberCount: 2,
      deletedAt: null,
      deletedByName: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }),
    'GET /api/v1/departments/hr/members': ok({
      items: [
        member('sam', 'Sam Okafor', true),
        member('kai', 'Kai Brandt', false),
      ],
      meta: {
        currentPage: 1,
        totalPages: 1,
        totalItems: 2,
        itemsPerPage: 20,
        itemCount: 2,
      },
    }),
  });

  it('refuses to remove someone whose primary it is, and links their page', async () => {
    stubApi({
      ...routes(['department.read', 'department.member.assign']),
      'DELETE /api/v1/departments/hr/members/sam': fail(
        409,
        "This is the user's primary department. Set another of their departments as primary first!",
      ),
    });
    render(wrap(<DepartmentView departmentId="hr" />));
    const [remove] = await screen.findAllByRole('button', {
      name: 'Remove Sam Okafor from HR',
    });
    await userEvent.click(remove);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('HR is Sam Okafor’s primary department');
    expect(
      within(alert).getByRole('link', { name: 'Open Sam Okafor' }),
    ).toHaveAttribute('href', '/settings/people/sam');
  });

  it('is read-only without department.member.assign', async () => {
    stubApi(routes(['department.read']));
    render(wrap(<DepartmentView departmentId="hr" />));
    expect(await screen.findByText('2 members')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add people' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Remove / }),
    ).not.toBeInTheDocument();
  });
});

describe('a role', () => {
  it('says why a permission the viewer lacks can’t be ticked, and counts unsaved changes', async () => {
    stubApi({
      ...viewer([
        'role.read',
        'role.permission.assign',
        'user.read',
        'audit.read',
      ]),
      'GET /api/v1/roles/r1': ok({
        id: 'r1',
        name: 'Billing Lead',
        description: 'Finance reviews.',
        isSystemRole: false,
        userAssigned: 0,
        permissionCodes: ['user.read'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
      'GET /api/v1/permissions': ok(
        ['user.read', 'audit.read', 'audit.export'].map((code, index) => ({
          id: `p${index}`,
          code,
          name: code,
          group: code.split('.')[0],
          isRetired: false,
        })),
      ),
      'GET /api/v1/users': ok({
        items: [],
        meta: {
          currentPage: 1,
          totalPages: 1,
          totalItems: 0,
          itemsPerPage: 20,
          itemCount: 0,
        },
      }),
      'GET /api/v1/organizations/current': ok({ name: 'Acme' }),
    });
    render(wrap(<RoleView roleId="r1" />));
    const exporting = await screen.findByRole('checkbox', {
      name: 'Export the audit log',
    });
    expect(exporting).toBeDisabled();
    expect(exporting).toHaveAccessibleDescription(
      'You don’t hold it, so you can’t grant it.',
    );
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'View the audit log' }),
    );
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});

describe('a new endpoint', () => {
  it('asks for an https address and at least one event before sending', async () => {
    const calls = stubApi({
      'GET /api/v1/webhook-endpoints/event-types': ok({
        types: ['ticket.assigned'],
      }),
    });
    render(wrap(<EndpointDialog open onOpenChange={() => undefined} />));
    await userEvent.type(screen.getByLabelText('URL'), 'http://ops.acme.test');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create endpoint' }),
    );
    expect(screen.getByText('Use an https:// address.')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one event.')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0),
    );
  });
});

describe('a meter', () => {
  it('warns at 90% and is full at the limit', () => {
    expect(meterLevel(17, 20)).toBe('ok');
    expect(meterLevel(18, 20)).toBe('near');
    expect(meterLevel(20, 20)).toBe('full');
    expect(meterLevel(0, 0)).toBe('full');
  });
});

describe('a deleted person', () => {
  it('says there’s no free seat when Restore is refused', async () => {
    stubApi({
      ...viewer(['user.read', 'user.delete', 'organization.read']),
      'GET /api/v1/users/chris': ok({
        user: {
          id: 'chris',
          organizationId: 'o1',
          fullName: 'Chris Park',
          avatarUrl: null,
          email: 'chris@acme.test',
          isEmailVerified: true,
          phoneNumber: null,
          isPhoneVerified: false,
          dob: null,
          gender: 'UNSPECIFIED',
          lastLoginAt: null,
          isLocked: false,
          lockedUntil: null,
          isTwoFactorEnabled: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        roleIds: [],
        roleNames: [],
        departmentIds: [],
        deletedAt: '2026-09-12T09:00:00Z',
        deletedByName: 'Maya Chen',
      }),
      'GET /api/v1/organizations/current/usage': ok({
        seats: {
          available: true,
          used: 20,
          limit: 20,
          unavailableReason: null,
        },
      }),
      'GET /api/v1/roles': ok({ items: [], meta: {} }),
      'GET /api/v1/departments': ok({ items: [], meta: {} }),
      'GET /api/v1/users/chris/permissions': ok({ permissionCodes: [] }),
      'POST /api/v1/users/chris/restore': fail(
        402,
        'No seats left. Revoke a pending invitation or change the plan to add people!',
      ),
    });
    render(wrap(<PersonView userId="chris" />));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Restore' }),
    );
    expect(
      await screen.findByText('No free seat to restore Chris Park'),
    ).toBeInTheDocument();
  });
});

describe('a confirmation opened from a row’s menu', () => {
  it('takes the focus, on Cancel', async () => {
    stubApi({
      ...viewer(['department.read', 'department.update', 'department.delete']),
      'GET /api/v1/departments': ok({
        items: [
          {
            id: 'p',
            name: 'Payroll',
            description: null,
            memberCount: 0,
            deletedAt: null,
            deletedByName: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        meta: {
          currentPage: 1,
          totalPages: 1,
          totalItems: 1,
          itemsPerPage: 20,
          itemCount: 1,
        },
      }),
    });
    render(wrap(<DepartmentsView />));
    const [actions] = await screen.findAllByRole('button', {
      name: 'Actions for Payroll',
    });
    await userEvent.click(actions);
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete Payroll?',
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      ).toHaveFocus(),
    );
  });
});
