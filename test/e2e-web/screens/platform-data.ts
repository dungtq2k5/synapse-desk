import type {
  ApplyPlanResponseDto,
  BillingEventsResponseDto,
  FinanceSnapshotResponseDto,
  JobHealthResponseDto,
  PlatformAuditLogResponseDto,
  PlatformMetricsResponseDto,
  PlatformOrganizationDetailResponseDto,
  PlatformOrganizationResponseDto,
  PlatformUserResponseDto,
  RoleResponseDto,
  SubscriptionPlanResponseDto,
} from '@synapsedesk/api-client';

/**
 * The platform console's sample (design 11's handoff): 42 organizations, among
 * them Northwind Health (Pro, Active), Cedar Clinic (Free, Setting up),
 * Bluebird Logistics (Starter, Past due), Lumen Schools (Pro, Frozen) and
 * Quarry Labs (an assigned plan). Today is 22 Oct 2026. The console's reads
 * are answered from here; the Super Admin is real.
 */

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
export const NOW = '2026-10-22T10:58:00Z';
const at = (iso: string) => new Date(`${iso}Z`).toISOString();

type Org = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  stripe: boolean;
  people: number;
  seats: number;
  created: string;
  left?: string;
  domain?: string;
  storageGb?: number;
  ai?: number;
  analytics?: number;
  since?: string;
};

const ORGS: Org[] = [
  {
    id: 'org-northwind',
    name: 'Northwind Health',
    slug: 'northwind-health',
    status: 'ACTIVE',
    plan: 'Pro',
    stripe: true,
    people: 18,
    seats: 25,
    created: '2026-03-02T14:20:00',
    domain: 'northwind.health',
    storageGb: 50,
    ai: 10_000_000,
    analytics: 180,
    since: '2026-10-21T17:02:00',
  },
  {
    id: 'org-bluebird',
    name: 'Bluebird Logistics',
    slug: 'bluebird',
    status: 'SUSPENDED_PAST_DUE',
    plan: 'Starter',
    stripe: true,
    people: 7,
    seats: 5,
    created: '2026-01-14T09:00:00',
    domain: 'bluebird.logistics',
    since: '2026-10-14T06:00:00',
  },
  {
    id: 'org-cedar',
    name: 'Cedar Clinic',
    slug: 'cedar-clinic',
    status: 'PENDING_ONBOARDING',
    plan: 'Free',
    stripe: false,
    people: 1,
    seats: 10,
    created: '2026-10-21T09:31:00',
    domain: 'cedarclinic.com',
    since: '2026-10-21T09:31:00',
  },
  {
    id: 'org-harbor',
    name: 'Harbor Dental',
    slug: 'harbor-dental',
    status: 'SUSPENDED_PAST_DUE',
    plan: 'Pro',
    stripe: true,
    people: 22,
    seats: 25,
    created: '2026-02-09T09:00:00',
  },
  {
    id: 'org-kestrel',
    name: 'Kestrel Legal',
    slug: 'kestrel-legal',
    status: 'SUSPENDED_PAST_DUE',
    plan: 'Starter',
    stripe: true,
    people: 6,
    seats: 5,
    created: '2026-04-30T09:00:00',
  },
  {
    id: 'org-lumen',
    name: 'Lumen Schools',
    slug: 'lumen-schools',
    status: 'FROZEN',
    plan: 'Pro',
    stripe: true,
    people: 40,
    seats: 25,
    created: '2026-03-03T09:00:00',
    domain: 'lumenschools.org',
    since: '2026-10-20T13:45:00',
  },
  {
    id: 'org-orbit',
    name: 'Orbit Retail',
    slug: 'orbit-retail',
    status: 'ACTIVE',
    plan: 'Enterprise',
    stripe: true,
    people: 156,
    seats: 200,
    created: '2025-12-12T09:00:00',
  },
  {
    id: 'org-quarry',
    name: 'Quarry Labs',
    slug: 'quarry-labs',
    status: 'ACTIVE',
    plan: 'Quarry agreement',
    stripe: false,
    people: 48,
    seats: 60,
    created: '2026-06-05T09:00:00',
  },
  {
    id: 'org-marlow',
    name: 'Marlow Studio',
    slug: 'marlow-studio',
    status: 'FROZEN',
    plan: 'Starter',
    stripe: true,
    people: 4,
    seats: 5,
    created: '2026-01-08T09:00:00',
    left: '2026-10-02T09:00:00',
  },
  {
    id: 'org-pine',
    name: 'Pine Ridge Council',
    slug: 'pine-ridge',
    status: 'FROZEN',
    plan: 'Free',
    stripe: false,
    people: 12,
    seats: 10,
    created: '2026-05-19T09:00:00',
    left: '2026-10-11T09:00:00',
  },
];

export function organization(
  id: string,
  change: Partial<Org> = {},
): PlatformOrganizationResponseDto {
  const org = { ...ORGS.find((one) => one.id === id)!, ...change };
  return {
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      domain: org.domain ?? `${org.slug}.example`,
      status: org.status as never,
      enforceTwoFactor: false,
      allowedEmailDomains: [org.domain ?? `${org.slug}.example`],
      maxAgentSeats: org.seats,
      maxStorageBytes: (org.storageGb ?? 10) * GIB,
      monthlyAiTokenBudget: org.ai ?? 1_000_000,
      billingCycleStart: at('2026-10-01T00:00:00'),
      analyticsRangeDays: org.analytics ?? 90,
      createdAt: at(org.created),
      updatedAt: at(org.created),
    },
    userCount: org.people,
    pendingInvitationCount: org.id === 'org-northwind' ? 2 : 0,
    departmentCount: org.id === 'org-northwind' ? 6 : 3,
    deletedAt: org.left ? at(org.left) : null,
    planName: org.plan,
    billedThroughStripe: org.stripe,
    statusChangedAt: org.since ? at(org.since) : null,
  };
}

const meter = (used: number, limit: number) => ({
  available: true,
  used,
  limit,
  unavailableReason: null,
});

export function detail(
  id: string,
  change: Partial<Org> = {},
): PlatformOrganizationDetailResponseDto {
  const row = organization(id, change);
  return {
    ...row,
    usage: {
      seats: meter(
        id === 'org-lumen' ? 23 : 18,
        row.organization.maxAgentSeats,
      ),
      storage: meter(
        id === 'org-lumen' ? 31.2 * GIB : 3.9 * GIB,
        row.organization.maxStorageBytes,
      ),
      aiTokens: meter(id === 'org-lumen' ? 1_200_000 : 6_200_000, 10_000_000),
    },
  };
}

export const page = <T>(items: T[], total = items.length, perPage = 10) => ({
  items,
  meta: {
    totalItems: total,
    itemCount: items.length,
    itemsPerPage: perPage,
    totalPages: Math.ceil(total / perPage),
    currentPage: 1,
  },
});

/** The list, with or without the offboarded. */
export const organizations = (withOffboarded: boolean) =>
  withOffboarded
    ? page(
        ORGS.map((one) => organization(one.id)),
        44,
      )
    : page(
        ORGS.filter((one) => !one.left).map((one) => organization(one.id)),
        42,
      );

export const METRICS: PlatformMetricsResponseDto = {
  totalOrganizations: 42,
  organizationsByStatus: {
    ACTIVE: 31,
    PENDING_ONBOARDING: 4,
    SUSPENDED_PAST_DUE: 3,
    FROZEN: 2,
  },
  totalUsers: 1284,
  activeUsers: 1102,
  pendingInvitations: 37,
  liveSessions: 214,
  seatsAllocated: 1250,
  seatsInUse: 1031,
  generatedAt: at('2026-10-22T09:12:00'),
};

export const FINANCE: FinanceSnapshotResponseDto = {
  tenants: { total: 42, byStatus: METRICS.organizationsByStatus },
  plans: [
    {
      planId: 'plan-free',
      planName: 'Free',
      subscribers: 12,
      seatsAllocated: 120,
    },
    {
      planId: 'plan-starter',
      planName: 'Starter',
      subscribers: 9,
      seatsAllocated: 45,
    },
    {
      planId: 'plan-pro',
      planName: 'Pro',
      subscribers: 17,
      seatsAllocated: 425,
    },
    {
      planId: 'plan-enterprise',
      planName: 'Enterprise',
      subscribers: 3,
      seatsAllocated: 600,
    },
    {
      planId: 'plan-quarry',
      planName: 'Quarry agreement',
      subscribers: 1,
      seatsAllocated: 60,
    },
  ],
  dunning: {
    pastDue: 3,
    tenants: [
      {
        id: 'org-bluebird',
        name: 'Bluebird Logistics',
        updatedAt: at('2026-10-14T06:00:00'),
        pastDueSince: at('2026-10-14T06:00:00'),
      },
      {
        id: 'org-harbor',
        name: 'Harbor Dental',
        updatedAt: at('2026-10-18T06:00:00'),
        pastDueSince: at('2026-10-18T06:00:00'),
      },
      {
        id: 'org-kestrel',
        name: 'Kestrel Legal',
        updatedAt: at('2026-10-20T06:00:00'),
        pastDueSince: at('2026-10-20T06:00:00'),
      },
    ],
  },
  revenue: {
    available: true,
    unavailableReason: null,
    estimatedMrr: 841_200,
    currency: 'usd',
    activeSubscriptions: 29,
    computedAt: at('2026-10-22T09:00:00'),
    excludes: ['discounts', 'trials', 'past-due subscriptions'],
  },
  generatedAt: at('2026-10-22T09:12:00'),
};

/** Finance with the revenue snapshot unreadable. */
export const FINANCE_PARTIAL: FinanceSnapshotResponseDto = {
  ...FINANCE,
  revenue: {
    ...FINANCE.revenue,
    available: false,
    unavailableReason: 'the revenue snapshot could not be read',
    estimatedMrr: null,
    currency: null,
  },
};

const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const day = new Date(`${from}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });

/** 30 days of events ending 22 Oct, the handoff's totals: 14, 27, 3 and 5. */
export const EVENTS: BillingEventsResponseDto = (() => {
  const range = days('2026-09-23', 30);
  const spread = (type: string, at: number[], counts: number[]) =>
    at.map((index, n) => ({
      day: range[index],
      eventType: type,
      count: counts[n],
    }));
  return {
    points: [
      ...spread(
        'customer.subscription.created',
        [2, 5, 7, 10, 14, 17, 22, 24, 26, 29],
        [1, 2, 1, 1, 2, 1, 1, 1, 2, 2],
      ),
      ...spread(
        'customer.subscription.updated',
        [1, 3, 4, 6, 8, 10, 11, 12, 15, 17, 19, 21, 22, 23, 25, 27],
        [2, 1, 3, 1, 2, 1, 1, 1, 2, 3, 2, 1, 1, 1, 3, 2],
      ),
      ...spread('customer.subscription.deleted', [4, 13, 26], [1, 1, 1]),
      ...spread('invoice.payment_failed', [4, 9, 15, 20, 23], [1, 1, 1, 1, 1]),
    ],
    currentlyOffboarded: [
      { day: range[9], eventType: 'organization.offboarded', count: 1 },
      { day: range[18], eventType: 'organization.offboarded', count: 1 },
    ],
    observedEventTypes: [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ],
  };
})();

type Job = Partial<JobHealthResponseDto['items'][number]> & {
  jobName: string;
  service: string;
};

const job = (row: Job) => ({
  lastStartedAt: row.lastSucceededAt ?? null,
  lastSucceededAt: null,
  lastDurationMs: null,
  lastError: null,
  consecutiveFailures: 0,
  health: 'healthy',
  ...row,
});

export const JOBS: JobHealthResponseDto = {
  items: [
    job({
      service: 'ticket-service',
      jobName: 'analytics-daily',
      lastSucceededAt: at('2026-10-22T02:00:00'),
      lastDurationMs: 48_000,
    }),
    job({
      service: 'ingestion-service',
      jobName: 'ledger-daily',
      health: 'failing',
      lastSucceededAt: at('2026-10-20T02:04:00'),
      lastDurationMs: 130_000,
      consecutiveFailures: 2,
      lastError: 'document-flags: deadline exceeded',
    }),
    job({
      service: 'ingestion-service',
      jobName: 'ledger-hourly',
      lastSucceededAt: at('2026-10-22T10:00:00'),
      lastDurationMs: 6_000,
    }),
    job({
      service: 'auth-service',
      jobName: 'auth-hourly',
      lastSucceededAt: at('2026-10-22T10:00:00'),
      lastDurationMs: 1_000,
    }),
    job({
      service: 'auth-service',
      jobName: 'auth-daily',
      lastSucceededAt: at('2026-10-22T03:00:00'),
      lastDurationMs: 4_000,
    }),
    job({
      service: 'auth-service',
      jobName: 'billing-snapshot',
      health: 'never-ran',
    }),
    job({
      service: 'ingestion-service',
      jobName: 'ingestion-reconcile',
      lastSucceededAt: at('2026-10-22T10:50:00'),
      lastDurationMs: 2_000,
    }),
    job({
      service: 'ingestion-service',
      jobName: 'scope-reconcile',
      lastSucceededAt: at('2026-10-22T10:00:00'),
      lastDurationMs: 3_000,
    }),
    job({
      service: 'notification-service',
      jobName: 'webhook-retention',
      health: 'stale',
      lastSucceededAt: at('2026-10-19T04:00:00'),
      lastDurationMs: 3_000,
    }),
    job({
      service: 'ingestion-service',
      jobName: 'chunk-usage-projection',
      health: 'step',
      lastSucceededAt: at('2026-10-22T02:01:00'),
      lastDurationMs: 31_000,
    }),
    job({
      service: 'ingestion-service',
      jobName: 'ai-generation-rollup',
      health: 'step',
      lastSucceededAt: at('2026-10-22T02:02:00'),
      lastDurationMs: 22_000,
    }),
    job({
      service: 'ingestion-service',
      jobName: 'document-flags',
      health: 'step',
      lastSucceededAt: at('2026-10-20T02:04:00'),
      lastDurationMs: 77_000,
      consecutiveFailures: 2,
      lastError: 'deadline exceeded',
    }),
  ],
  degraded: true,
  unavailable: [],
} as JobHealthResponseDto;

/** The notification service didn't answer: its job isn't listed. */
export const JOBS_PARTIAL: JobHealthResponseDto = {
  ...JOBS,
  items: JOBS.items.filter((row) => row.service !== 'notification-service'),
  unavailable: ['notification-service'],
};

const price = (id: string, interval: string, unitAmount: number | null) => ({
  id: `p-${id}`,
  stripePriceId: id,
  interval,
  unitAmount,
  currency: unitAmount === null ? null : 'usd',
});

const plan = (
  row: Partial<SubscriptionPlanResponseDto> & { id: string; name: string },
): SubscriptionPlanResponseDto => ({
  stripeProductId: null,
  maxAgentSeats: 10,
  maxStorageBytes: 5 * GIB,
  monthlyAiTokenBudget: 1_000_000,
  aiModelTier: 'FAST',
  maxDocumentBytes: 100 * MIB,
  maxAttachmentBytes: 10 * MIB,
  maxDocumentUploads: 100_000,
  maxAnalyticsRangeDays: 400,
  isActive: true,
  prices: [],
  subscriberCount: 0,
  createdAt: at('2026-01-01T00:00:00'),
  updatedAt: at('2026-10-22T10:42:00'),
  deletedAt: null,
  ...row,
});

export const PLANS: SubscriptionPlanResponseDto[] = [
  plan({ id: 'plan-free', name: 'Free', subscriberCount: 12 }),
  plan({
    id: 'plan-starter',
    name: 'Starter',
    stripeProductId: 'prod_Starter01',
    maxAgentSeats: 5,
    maxDocumentBytes: 5 * MIB,
    maxAttachmentBytes: 2 * MIB,
    maxDocumentUploads: 1000,
    maxAnalyticsRangeDays: 30,
    subscriberCount: 9,
    prices: [
      price('price_1StarterM', 'month', 2900),
      price('price_1StarterY', 'year', 29000),
    ],
  }),
  plan({
    id: 'plan-pro',
    name: 'Pro',
    stripeProductId: 'prod_Q8xK2mLr4fT1',
    maxAgentSeats: 25,
    maxStorageBytes: 50 * GIB,
    monthlyAiTokenBudget: 10_000_000,
    aiModelTier: 'QUALITY',
    maxDocumentBytes: 25 * MIB,
    maxAttachmentBytes: 5 * MIB,
    maxDocumentUploads: 10_000,
    maxAnalyticsRangeDays: 180,
    subscriberCount: 17,
    prices: [
      price('price_1PxM9kQ2sV', 'month', 9900),
      price('price_1PxNa3Lw8Z', 'year', 99000),
    ],
  }),
  plan({
    id: 'plan-enterprise',
    name: 'Enterprise',
    stripeProductId: 'prod_Enterprise1',
    maxAgentSeats: 200,
    maxStorageBytes: 500 * GIB,
    monthlyAiTokenBudget: 100_000_000,
    aiModelTier: 'QUALITY',
    maxDocumentBytes: 100 * MIB,
    maxAttachmentBytes: 10 * MIB,
    subscriberCount: 3,
    prices: [
      price('price_1EntM', 'month', 49900),
      price('price_1EntY', 'year', 499000),
    ],
  }),
  plan({
    id: 'plan-quarry',
    name: 'Quarry agreement',
    maxAgentSeats: 60,
    maxStorageBytes: 200 * GIB,
    monthlyAiTokenBudget: 40_000_000,
    aiModelTier: 'QUALITY',
    maxDocumentBytes: 50 * MIB,
    maxDocumentUploads: 40_000,
    subscriberCount: 1,
  }),
  plan({
    id: 'plan-legacy',
    name: 'Legacy Team',
    stripeProductId: 'prod_Legacy01',
    isActive: false,
    maxStorageBytes: 10 * GIB,
    monthlyAiTokenBudget: 5_000_000,
    maxDocumentBytes: 10 * MIB,
    maxAttachmentBytes: 5 * MIB,
    maxDocumentUploads: 2000,
    maxAnalyticsRangeDays: 90,
    prices: [price('price_1LegacyM', 'month', 4900)],
  }),
];

const subscriber = (
  organizationId: string,
  organizationName: string,
  changes: Record<string, string>,
  extra: Partial<ApplyPlanResponseDto['subscribers'][number]> = {},
) => ({
  organizationId,
  organizationName,
  changes,
  after: {},
  overLimit: [],
  overLimitItems: [],
  skippedPinned: false,
  budgetDeferred: false,
  ...extra,
});

/** Applying Pro: 16 change (2 of them over a limit), one is negotiated. */
export const APPLY = (dryRun: boolean): ApplyPlanResponseDto => ({
  subscribers: [
    subscriber('org-northwind', 'Northwind Health', {
      maxAgentSeats: '20 -> 25',
      monthlyAiTokenBudget: '8000000 -> 10000000',
    }),
    subscriber(
      'org-fenwick',
      'Fenwick Partners',
      {
        maxStorageBytes: `${40 * GIB} -> ${50 * GIB}`,
        monthlyAiTokenBudget: '12000000 -> 10000000',
      },
      { budgetDeferred: true },
    ),
    subscriber('org-harbor', 'Harbor Dental', {
      maxAnalyticsRangeDays: '90 -> 180',
    }),
    subscriber(
      'org-lumen',
      'Lumen Schools',
      { maxAgentSeats: '30 -> 25' },
      {
        overLimit: ['maxAgentSeats: 31 in use, plan grants 25'],
        overLimitItems: [{ dimension: 'SEATS', inUse: 31, allowed: 25 }],
      },
    ),
    subscriber(
      'org-gale',
      'Gale Insurance',
      { maxDocumentUploads: '8000 -> 10000' },
      {
        overLimit: ['maxDocumentUploads: 10412 held, plan grants 10000'],
        overLimitItems: [
          { dimension: 'DOCUMENTS', inUse: 10_412, allowed: 10_000 },
        ],
      },
    ),
    subscriber('org-iris', 'Iris Health', {}, { skippedPinned: true }),
    ...Array.from({ length: 11 }, (_, index) =>
      subscriber(`org-pro-${index + 1}`, `Pro subscriber ${index + 1}`, {
        maxAgentSeats: '20 -> 25',
      }),
    ),
  ],
  dryRun,
  changedCount: 16,
  skippedPinnedCount: 1,
  overLimitCount: 2,
  evaluatedDimensions: ['seats', 'storage', 'documents'],
});

const person = (
  id: string,
  fullName: string,
  email: string,
  organizationId: string,
  organizationName: string,
  roleNames: string[],
  extra: Partial<PlatformUserResponseDto['user']> = {},
): PlatformUserResponseDto =>
  ({
    user: {
      id,
      organizationId,
      fullName,
      avatarUrl: null,
      email,
      isEmailVerified: true,
      phoneNumber: null,
      isPhoneVerified: false,
      dob: null,
      gender: null,
      lastLoginAt: at('2026-10-22T08:10:00'),
      isLocked: false,
      lockedUntil: null,
      isTwoFactorEnabled: false,
      createdAt: at('2026-03-02T14:20:00'),
      updatedAt: at('2026-03-02T14:20:00'),
      ...extra,
    },
    organizationId,
    organizationName,
    roleNames,
    deletedAt: null,
  }) as PlatformUserResponseDto;

export const PEOPLE: PlatformUserResponseDto[] = [
  person(
    'u-maya',
    'Maya Chen',
    'maya@northwind.health',
    'org-northwind',
    'Northwind Health',
    ['Org Admin'],
    { isTwoFactorEnabled: true },
  ),
  person(
    'u-jordan',
    'Jordan Lee',
    'jordan@northwind.health',
    'org-northwind',
    'Northwind Health',
    ['Support Agent'],
  ),
  person(
    'u-dana',
    'Dana Ortiz',
    'dana@cedarclinic.com',
    'org-cedar',
    'Cedar Clinic',
    ['Org Admin'],
    { lastLoginAt: null },
  ),
  person(
    'u-sam',
    'Sam Okafor',
    'sam@bluebird.logistics',
    'org-bluebird',
    'Bluebird Logistics',
    ['Org Admin'],
    { isLocked: true },
  ),
  person(
    'u-priya',
    'Priya Shah',
    'priya@northwind.health',
    'org-northwind',
    'Northwind Health',
    ['End User'],
    { isEmailVerified: false, lastLoginAt: at('2026-10-21T16:02:00') },
  ),
];

const role = (
  id: string,
  name: string,
  isSystemRole: boolean,
  codes: number,
  description: string | null = null,
): RoleResponseDto =>
  ({
    id,
    name,
    description,
    isSystemRole,
    userAssigned: 12,
    permissionCodes: Array.from(
      { length: codes },
      (_, index) => `code.${index}`,
    ),
    createdAt: at('2026-01-01T00:00:00'),
    updatedAt: at('2026-01-01T00:00:00'),
  }) as RoleResponseDto;

export const GLOBAL_ROLES: RoleResponseDto[] = [
  role('r-admin', 'Org Admin', true, 38),
  role('r-km', 'Knowledge Manager', true, 9),
  role('r-agent', 'Support Agent', true, 7),
  role('r-end', 'End User', true, 2),
  role(
    'r-auditor',
    'Auditor',
    false,
    3,
    'Reads the audit log and analytics, changes nothing.',
  ),
];

const entry = (
  id: string,
  when: string,
  actorName: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  resourceName: string | null,
  metadata: Record<string, unknown>,
): PlatformAuditLogResponseDto =>
  ({
    id,
    organizationId: null,
    userId: actorName === 'Ravi Patel' ? 'sa-ravi' : 'sa-ana',
    action,
    resourceType,
    resourceId,
    ipAddress: '203.0.113.9',
    userAgent: 'Mozilla/5.0',
    metadata,
    createdAt: at(when),
    actorName,
    resourceName,
  }) as PlatformAuditLogResponseDto;

export const AUDIT: PlatformAuditLogResponseDto[] = [
  entry(
    'a1',
    '2026-10-22T10:58:00',
    'Ravi Patel',
    'PLATFORM_PLAN_APPLIED',
    'SUBSCRIPTION_PLAN',
    'plan-pro',
    'Pro',
    { name: 'Pro', changedCount: 16 },
  ),
  entry(
    'a2',
    '2026-10-22T10:42:00',
    'Ravi Patel',
    'PLATFORM_PLAN_UPDATED',
    'SUBSCRIPTION_PLAN',
    'plan-pro',
    'Pro',
    { name: 'Pro', subscriberCount: 17 },
  ),
  entry(
    'a3',
    '2026-10-22T10:30:00',
    'Ana Ruiz',
    'PLATFORM_JOB_BACKFILLED',
    'JOB',
    null,
    null,
    {
      jobName: 'analytics-daily',
      reason: 'Ticket import on 30 Sept arrived after the daily run.',
      from: '2026-10-01',
      to: '2026-10-21',
      organizationId: 'org-northwind',
      tenants: 1,
      rows: 42,
    },
  ),
  entry(
    'a4',
    '2026-10-22T10:05:00',
    'Ana Ruiz',
    'PLATFORM_JOB_RUN',
    'JOB',
    null,
    null,
    {
      jobName: 'analytics-daily',
      reason: 'Checking the rollup after the import.',
      tenants: 42,
      rows: 1268,
    },
  ),
  entry(
    'a5',
    '2026-10-22T09:31:00',
    'Ana Ruiz',
    'PLATFORM_ORGANIZATION_CREATED',
    'ORGANIZATION',
    'org-cedar',
    'Cedar Clinic',
    { slug: 'cedar-clinic', adminEmail: 'dana@cedarclinic.com' },
  ),
  entry(
    'a6',
    '2026-10-21T17:02:00',
    'Ravi Patel',
    'PLATFORM_ORGANIZATION_STATUS_CHANGED',
    'ORGANIZATION',
    'org-northwind',
    'Northwind Health',
    {
      from: 'SUSPENDED_PAST_DUE',
      to: 'ACTIVE',
      reason: 'Payment received by wire; Stripe will catch up.',
      revokedSessionCount: 0,
    },
  ),
  entry(
    'a7',
    '2026-10-20T13:45:00',
    'Ravi Patel',
    'PLATFORM_ORGANIZATION_STATUS_CHANGED',
    'ORGANIZATION',
    'org-lumen',
    'Lumen Schools',
    {
      from: 'ACTIVE',
      to: 'FROZEN',
      reason:
        'Chargeback dispute opened with the bank; frozen until it’s resolved.',
      revokedSessionCount: 31,
    },
  ),
  entry(
    'a8',
    '2026-10-18T11:20:00',
    'Ana Ruiz',
    'PLATFORM_ORGANIZATION_OFFBOARDED',
    'ORGANIZATION',
    'org-pine',
    'Pine Ridge Council',
    {
      reason: 'Council merged with the county office; contract ended.',
      revokedSessionCount: 12,
    },
  ),
  entry(
    'a9',
    '2026-10-15T16:05:00',
    'Ana Ruiz',
    'PLATFORM_GLOBAL_ROLE_CREATED',
    'ROLE',
    'r-auditor',
    null,
    {
      name: 'Auditor',
      permissionCodes: ['audit.read', 'audit.export', 'analytics.read'],
    },
  ),
];

/** Northwind's own trail, newest first. */
export const NORTHWIND_ACTS: PlatformAuditLogResponseDto[] = [
  AUDIT[5],
  entry(
    'n2',
    '2026-09-03T10:15:00',
    'Ana Ruiz',
    'PLATFORM_ORGANIZATION_UPDATED',
    'ORGANIZATION',
    'org-northwind',
    'Northwind Health',
    {
      reason: 'Temporary seats for their onboarding week.',
      before: {
        name: 'Northwind Health',
        slug: 'northwind-health',
        maxAgentSeats: 25,
      },
      after: {
        name: 'Northwind Health',
        slug: 'northwind-health',
        maxAgentSeats: 30,
      },
    },
  ),
  entry(
    'n3',
    '2026-09-01T08:00:00',
    'Ana Ruiz',
    'PLATFORM_BILLING_CYCLE_RESET',
    'ORGANIZATION',
    'org-northwind',
    'Northwind Health',
    { reason: 'AI allowance ran out on day 1 after a migration import.' },
  ),
  entry(
    'n4',
    '2026-03-02T14:20:00',
    'Ravi Patel',
    'PLATFORM_ORGANIZATION_CREATED',
    'ORGANIZATION',
    'org-northwind',
    'Northwind Health',
    { slug: 'northwind-health' },
  ),
];
