import { RevenueUnavailableReason } from '@synapsedesk/contracts';
import {
  aboutOf,
  changedFields,
  changeLines,
  consequence,
  consoleStatus,
  count,
  jobDetails,
  jobsOf,
  jobWords,
  mrrReason,
  organizationAct,
  overLimitLine,
  overLimitWarning,
  parentOf,
  platformActionWords,
  reachable,
  reasonOf,
  statusAction,
} from './platform';

const GIB = 1024 ** 3;

describe('statuses', () => {
  it('reads offboarded before the status it was left in', () => {
    expect(consoleStatus('FROZEN', '2026-10-02T00:00:00Z')).toBe('OFFBOARDED');
    expect(consoleStatus('FROZEN', null)).toBe('FROZEN');
    expect(consoleStatus(null, null)).toBe('ACTIVE');
  });

  it('says what each status does, past due with its date', () => {
    expect(consequence('ACTIVE')).toBe('Everything works for its people.');
    expect(consequence('SUSPENDED_PAST_DUE', '2026-10-14T09:00:00Z')).toMatch(
      /Billing still works, so it can pay\. Past due since 14 Oct 2026\.$/,
    );
    expect(consequence('SUSPENDED_PAST_DUE')).toMatch(/so it can pay\.$/);
    expect(consequence('OFFBOARDED')).toMatch(/^Closed: nobody can sign in/);
  });

  it('offers only the statuses the server allows, and names the change', () => {
    expect(reachable('FROZEN')).toEqual(['ACTIVE']);
    expect(reachable('ACTIVE')).toEqual(['SUSPENDED_PAST_DUE', 'FROZEN']);
    expect(reachable('OFFBOARDED')).toEqual([]);
    expect(statusAction('FROZEN' as never, 'Lumen Schools')).toBe(
      'Freeze Lumen Schools',
    );
    expect(statusAction('SUSPENDED_PAST_DUE' as never, 'Bluebird')).toBe(
      'Mark Bluebird past due',
    );
    expect(statusAction('ACTIVE' as never, 'Bluebird')).toBe(
      'Make Bluebird Active',
    );
  });
});

describe('mrrReason', () => {
  it('maps each server value to the deck’s sentence, never showing the value', () => {
    expect(mrrReason(RevenueUnavailableReason.MIXED_CURRENCIES)).toBe(
      'subscriptions are in more than one currency, so they can’t be added up.',
    );
    expect(mrrReason(RevenueUnavailableReason.NOT_CONFIGURED)).toMatch(
      /^billing isn’t set up/,
    );
    expect(mrrReason(RevenueUnavailableReason.NO_SNAPSHOT)).toMatch(
      /hasn’t been computed yet/,
    );
    expect(mrrReason(RevenueUnavailableReason.SNAPSHOT_UNREADABLE)).toMatch(
      /couldn’t be read/,
    );
    expect(mrrReason(RevenueUnavailableReason.UNSUPPORTED_PRICING)).toMatch(
      /can’t turn into a monthly amount/,
    );
  });
});

describe('jobs', () => {
  it('names jobs and steps, and reads an unknown one as its code', () => {
    expect(jobWords('analytics-daily')).toBe('Analytics rollup, daily');
    expect(jobWords('ai-generation-rollup')).toBe('AI usage rollup');
    expect(jobWords('something-new')).toBe('something-new');
  });

  it('lists a silent service’s jobs from the schedule', () => {
    expect(jobsOf('notification-service')).toEqual(['webhook-retention']);
    expect(jobsOf('ticket-service')).toEqual(['analytics-daily']);
  });

  it('finds a step’s job, and none for a job named after its only step', () => {
    expect(parentOf('ai-generation-rollup')).toBe('ledger-daily');
    expect(parentOf('billing-snapshot')).toBeNull();
  });

  it('says a run’s counts and a range’s days', () => {
    expect(jobDetails({ tenants: 42, rows: 1268 })).toBe(
      '42 organizations, 1,268 rows',
    );
    expect(
      jobDetails(
        { from: '2026-10-01', to: '2026-10-21', tenants: 1, rows: 1 },
        'Northwind Health',
      ),
    ).toBe(
      '1 Oct 2026 – 21 Oct 2026, Northwind Health · 1 organization, 1 row',
    );
    expect(jobDetails(null)).toBe('');
  });
});

describe('the platform’s audit words', () => {
  it('words each action, and an unknown one as itself', () => {
    expect(platformActionWords('PLATFORM_JOB_BACKFILLED')).toBe(
      'Recomputed a job’s range',
    );
    expect(platformActionWords('NEW_THING')).toBe('NEW_THING');
    expect(platformActionWords(null)).toBe('—');
  });

  it('says an act on an organization with what changed', () => {
    expect(
      organizationAct('PLATFORM_ORGANIZATION_STATUS_CHANGED', {
        from: 'SUSPENDED_PAST_DUE',
        to: 'ACTIVE',
      }),
    ).toBe('Changed its status: Past due → Active');
    expect(
      organizationAct('PLATFORM_ORGANIZATION_UPDATED', {
        before: { name: 'A', slug: 'a', maxAgentSeats: 25 },
        after: { name: 'A', slug: 'a', maxAgentSeats: 30 },
      }),
    ).toBe('Edited it: seats 25 → 30');
    expect(organizationAct('PLATFORM_ORGANIZATION_UPDATED', {})).toBe(
      'Edited it',
    );
    expect(organizationAct('PLATFORM_ORGANIZATION_CREATED', null)).toBe(
      'Created it',
    );
    expect(organizationAct(undefined, null)).toBe('—');
    expect(changedFields({ before: {}, after: {} })).toBeNull();
  });

  it('reads a reason only when there is one', () => {
    expect(reasonOf({ reason: 'Paid by wire' })).toBe('Paid by wire');
    expect(reasonOf({ reason: '  ' })).toBeNull();
    expect(reasonOf(null)).toBeNull();
  });

  it('says what each kind of entry is about, and where it opens', () => {
    expect(
      aboutOf({
        action: 'PLATFORM_ORGANIZATION_STATUS_CHANGED',
        resourceType: 'ORGANIZATION',
        resourceId: 'org-1',
        resourceName: 'Lumen Schools',
        metadata: { from: 'ACTIVE', to: 'FROZEN', revokedSessionCount: 31 },
      }),
    ).toEqual({
      name: 'Lumen Schools',
      href: '/platform/organizations/org-1',
      kind: 'Organization',
      details: 'Active → Frozen · 31 sessions signed out',
    });
    expect(
      aboutOf({
        action: 'PLATFORM_ORGANIZATION_CREATED',
        resourceType: 'ORGANIZATION',
        resourceId: 'org-2',
        resourceName: null,
        metadata: { adminEmail: 'dana@cedar.test' },
      }),
    ).toMatchObject({
      name: 'An organization',
      details: 'Org Admin: dana@cedar.test',
    });
    expect(
      aboutOf({
        action: 'PLATFORM_PLAN_APPLIED',
        resourceType: 'SUBSCRIPTION_PLAN',
        resourceId: 'plan-1',
        resourceName: 'Pro',
        metadata: { changedCount: 16 },
      }),
    ).toEqual({
      name: 'Pro',
      href: '/platform/plans/plan-1',
      kind: 'Plan',
      details: '16 organizations changed',
    });
    expect(
      aboutOf({
        action: 'PLATFORM_PLAN_DELETED',
        resourceType: 'SUBSCRIPTION_PLAN',
        resourceId: 'plan-2',
        metadata: { name: 'Legacy' },
      }),
    ).toMatchObject({ name: 'Legacy', href: null, details: null });
    expect(
      aboutOf({
        action: 'PLATFORM_GLOBAL_ROLE_CREATED',
        resourceType: 'ROLE',
        metadata: { name: 'Auditor', permissionCodes: ['a', 'b', 'c'] },
      }),
    ).toEqual({
      name: 'Auditor',
      href: '/platform/roles',
      kind: 'Global role',
      details: '3 permissions',
    });
    expect(
      aboutOf({
        action: 'PLATFORM_JOB_RUN',
        resourceType: 'JOB',
        metadata: { jobName: 'analytics-daily', tenants: 42, rows: 1268 },
      }),
    ).toEqual({
      name: 'Analytics rollup, daily',
      href: '/platform/jobs',
      kind: 'Job',
      details: '42 organizations, 1,268 rows',
    });
    expect(aboutOf({ resourceType: 'JOB', metadata: {} })).toMatchObject({
      name: 'A job',
      details: null,
    });
    expect(aboutOf({ resourceType: null })).toMatchObject({ name: '—' });
  });
});

describe('applying a plan', () => {
  it('says each change in units, the deferred allowance from its next cycle', () => {
    expect(
      changeLines(
        {
          maxAgentSeats: '20 -> 25',
          maxStorageBytes: `${40 * GIB} -> ${50 * GIB}`,
          monthlyAiTokenBudget: '12000000 -> 10000000',
          maxAnalyticsRangeDays: '90 -> 180',
          maxDocumentUploads: '8000 -> 10000',
          aiModelTier: 'FAST -> QUALITY',
          somethingNew: '1 -> 2',
        },
        true,
      ),
    ).toEqual([
      'Seats 20 → 25',
      'Storage 40 GB → 50 GB',
      'AI allowance $12.00 → $10.00 a month, from its next cycle',
      'Analytics ranges 90 → 180 days',
      'Documents 8,000 → 10,000',
      'AI model Fast → Quality',
      'somethingNew 1 → 2',
    ]);
    expect(changeLines({ monthlyAiTokenBudget: '1 -> 2' }, false)).toEqual([
      'AI allowance $0.00 → $0.00 a month',
    ]);
  });

  it('says each limit a subscriber would break', () => {
    expect(overLimitLine({ dimension: 'SEATS', inUse: 31, allowed: 25 })).toBe(
      'Seats: 31 in use, the plan grants 25',
    );
    expect(
      overLimitLine({
        dimension: 'STORAGE',
        inUse: 60 * GIB,
        allowed: 50 * GIB,
      }),
    ).toBe('Storage: 60 GB used, the plan grants 50 GB');
    expect(
      overLimitLine({ dimension: 'DOCUMENTS', inUse: 10412, allowed: 10000 }),
    ).toBe('Documents: 10,412 held, the plan grants 10,000');
  });

  it('names each organization over a limit and the limit it breaks', () => {
    expect(
      overLimitWarning(
        [
          {
            name: 'Lumen Schools',
            items: [{ dimension: 'SEATS', inUse: 31, allowed: 25 }],
          },
          {
            name: 'Gale Insurance',
            items: [{ dimension: 'DOCUMENTS', inUse: 2, allowed: 1 }],
          },
        ],
        'Pro',
      ),
    ).toEqual({
      title: '2 organizations will be over a limit after this',
      description:
        'Lumen Schools (seats) and Gale Insurance (documents) use more than Pro grants. Applying still changes them: that’s your call to make here.',
    });
    expect(
      overLimitWarning(
        [
          {
            name: 'Acme',
            items: [{ dimension: 'STORAGE', inUse: 2, allowed: 1 }],
          },
        ],
        'Pro',
      ).description,
    ).toBe(
      'Acme (storage) uses more than Pro grants. Applying still changes it: that’s your call to make here.',
    );
  });

  it('counts with the noun’s plural', () => {
    expect(count(1, 'session')).toBe('1 session');
    expect(count(1200, 'row')).toBe('1,200 rows');
    expect(count(1, 'person', 'people')).toBe('1 person');
    expect(count(48, 'person', 'people')).toBe('48 people');
  });
});

describe('assigning and releasing a plan', () => {
  it('words the two actions in the trail and on the organization’s page', () => {
    expect(platformActionWords('PLATFORM_PLAN_ASSIGNED')).toBe(
      'Assigned a plan',
    );
    expect(platformActionWords('PLATFORM_PLAN_RELEASED')).toBe(
      'Released to self-service',
    );
    expect(
      organizationAct('PLATFORM_PLAN_ASSIGNED', {
        planName: 'Quarry agreement',
      }),
    ).toBe('Assigned it Quarry agreement');
    expect(organizationAct('PLATFORM_PLAN_RELEASED', {})).toBe(
      'Released it to self-service',
    );
    expect(
      aboutOf({
        action: 'PLATFORM_PLAN_ASSIGNED',
        resourceType: 'ORGANIZATION',
        resourceId: 'org-1',
        resourceName: 'Quarry Labs',
        metadata: { planName: 'Quarry agreement' },
      }).details,
    ).toBe('Plan: Quarry agreement');
  });

  it('says when an edit pinned or unpinned the limits', () => {
    expect(
      changedFields({
        before: { entitlementsPinned: false },
        after: { entitlementsPinned: true },
      }),
    ).toBe('limits pinned');
    expect(
      changedFields({
        before: { maxAgentSeats: 25, entitlementsPinned: true },
        after: { maxAgentSeats: 30, entitlementsPinned: false },
      }),
    ).toBe('seats 25 → 30, limits unpinned');
  });
});
