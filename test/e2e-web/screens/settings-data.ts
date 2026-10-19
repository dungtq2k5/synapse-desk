import type {
  AuditLogResponseDto,
  DepartmentMemberResponseDto,
  DepartmentResponseDto,
  InvitationResponseDto,
  OrganizationResponseDto,
  OrganizationSettingsResponseDto,
  OrganizationUsageResponseDto,
  PermissionResponseDto,
  RoleResponseDto,
  SessionResponseDto,
  UserSummaryResponseDto,
  WebhookDeliveryResponseDto,
  WebhookEndpointResponseDto,
} from '@synapsedesk/api-client';
import {
  AuditAction,
  PERMISSION_CODES,
  SYSTEM_ROLE_PERMISSIONS,
} from '@synapsedesk/contracts';
import type { Page, Route } from '@playwright/test';

/**
 * Northwind Health as design 08 draws it: 18 people, six departments, four
 * system roles and two custom ones, three webhook endpoints and the audit
 * log. Every Settings call is answered here by `settings(page)`, so a
 * baseline holds the deck's names on every run; the viewer is real (signed in
 * through the gateway), and so is anything this table doesn't answer.
 */

export const ok = (data: unknown, statusCode = 200) => ({
  status: statusCode,
  json: { success: true, statusCode, message: 'OK', data },
});
export const failed = (
  status: number,
  error = 'Failed!',
  /** The envelope's `details`, for a refusal that carries data. */
  details?: Record<string, unknown>,
) => ({
  status,
  json: {
    success: false,
    statusCode: status,
    path: '/api/v1',
    timestamp: '2026-10-18T00:00:00.000Z',
    error,
    ...(details && { details }),
  },
});
export const paged = (items: unknown[], total = items.length, perPage = 20) =>
  ok({
    items,
    meta: {
      currentPage: 1,
      itemsPerPage: perPage,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      itemCount: items.length,
    },
  });
/** A call that never answers: the state while it's on its way. */
export const hang = Symbol('hang');
type Reply = ReturnType<typeof ok> | ReturnType<typeof failed> | typeof hang;

// From the moment a row asks: "Just now" stays just now.
export const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
export const ahead = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();
const DAY = 24 * 60;

export const ORGANIZATION: OrganizationResponseDto = {
  id: 'org',
  name: 'Northwind Health',
  slug: 'northwind-health',
  domain: 'northwind.health',
  status: 'ACTIVE',
  enforceTwoFactor: false,
  allowedEmailDomains: ['northwind.health', 'northwind.de'],
  maxAgentSeats: 20,
  maxStorageBytes: 5 * 1024 ** 3,
  monthlyAiTokenBudget: 1_000_000,
  billingCycleStart: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

export const SETTINGS: OrganizationSettingsResponseDto = {
  enforceTwoFactor: false,
  allowedEmailDomains: ['northwind.health', 'northwind.de'],
  publicDomainWarnings: [],
  inboundAddress: null,
  maxDocumentBytesOverride: 25 * 1024 ** 2,
  maxAttachmentBytesOverride: 10 * 1024 ** 2,
  maxAttachmentsPerMessageOverride: 3,
};

const meter = (used: number, limit: number) => ({
  available: true,
  used,
  limit,
  unavailableReason: null,
});
export const USAGE: OrganizationUsageResponseDto = {
  seats: meter(18, 20),
  storage: meter(Math.round(3.9 * 1024 ** 3), 5 * 1024 ** 3),
  aiTokens: meter(620_000, 1_000_000),
  billingCycleStart: '2026-10-01T00:00:00.000Z',
  aiModelTier: 'FAST',
  planName: 'Business',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
};

export const DEPARTMENTS: DepartmentResponseDto[] = [
  ['hr', 'HR', 'People operations, leave and benefits.', 6],
  ['it', 'IT support', 'Laptops, accounts, access and the VPN.', 5],
  ['finance', 'Finance', 'Expenses, invoices and payroll questions.', 4],
  ['billing', 'Billing', 'Customer invoices and payment plans.', 2],
  ['facilities', 'Facilities', 'Offices, desks and parking.', 1],
  ['payroll', 'Payroll', 'Pay runs and payslips.', 0],
].map(([id, name, description, memberCount]) => ({
  id: id as string,
  name: name as string,
  description: description as string,
  memberCount: memberCount as number,
  deletedAt: null,
  deletedByName: null,
  createdAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
}));

const role = (
  id: string,
  name: string,
  codes: readonly string[],
  userAssigned: number,
  description: string | null = null,
): RoleResponseDto =>
  ({
    id,
    name,
    description,
    isSystemRole: description === null,
    userAssigned,
    permissionCodes: [...codes],
    createdAt: '2026-01-10T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  }) as RoleResponseDto;

export const ROLES: RoleResponseDto[] = [
  role(
    'r-admin',
    'Org Admin',
    SYSTEM_ROLE_PERMISSIONS['Org Admin' as never],
    1,
  ),
  role(
    'r-km',
    'Knowledge Manager',
    SYSTEM_ROLE_PERMISSIONS['Knowledge Manager' as never],
    2,
  ),
  role(
    'r-agent',
    'Support Agent (Tier 2)',
    SYSTEM_ROLE_PERMISSIONS['Support Agent (Tier 2)' as never],
    6,
  ),
  role('r-end', 'End User', SYSTEM_ROLE_PERMISSIONS['End User' as never], 9),
  role(
    'r-billing',
    'Billing Lead',
    [
      'organization.read',
      'organization.update',
      'user.read',
      'analytics.read',
      'audit.read',
      'audit.export',
    ],
    1,
    'Reads usage, analytics and the audit log for finance reviews.',
  ),
  role(
    'r-night',
    'Night shift',
    [
      'ticket.read.all',
      'ticket.update',
      'ticket.resolve',
      'ticket.assign.self',
    ],
    0,
    'Covers evenings: works and resolves tickets, nothing else.',
  ),
];

export const PERMISSIONS: PermissionResponseDto[] = PERMISSION_CODES.map(
  (code, index) => ({
    id: `p${index}`,
    code,
    name: code,
    group: code.split('.')[0],
    isRetired: false,
  }),
);

type PersonSpec = {
  id: string;
  fullName: string;
  roles: string[];
  departments: string[];
  twoStep?: boolean;
  lastLogin?: number;
  locked?: 'locked' | 'until';
  deleted?: boolean;
};

/** The first page of People, in the deck's order; Maya is the viewer's id. */
export function people(viewer: string): PersonSpec[] {
  return [
    {
      id: viewer,
      fullName: 'Maya Chen',
      roles: ['r-admin'],
      departments: ['hr'],
      twoStep: true,
      lastLogin: 0,
    },
    {
      id: 'u-jordan',
      fullName: 'Jordan Lee',
      roles: ['r-agent'],
      departments: ['it'],
      twoStep: true,
      lastLogin: 120,
    },
    {
      id: 'u-sam',
      fullName: 'Sam Okafor',
      roles: ['r-km', 'r-agent'],
      departments: ['hr', 'finance'],
      lastLogin: DAY + 60,
    },
    {
      id: 'u-priya',
      fullName: 'Priya Shah',
      roles: ['r-end'],
      departments: ['finance'],
      lastLogin: 3 * DAY,
    },
    {
      id: 'u-alex',
      fullName: 'Alex Rivera',
      roles: ['r-agent'],
      departments: ['it'],
      twoStep: true,
      lastLogin: 5 * DAY,
      locked: 'until',
    },
    {
      id: 'u-dana',
      fullName: 'Dana Novak',
      roles: ['r-billing'],
      departments: ['billing'],
      lastLogin: 10 * DAY,
      locked: 'locked',
    },
    {
      id: 'u-chris',
      fullName: 'Chris Park',
      roles: ['r-end'],
      departments: ['hr'],
      deleted: true,
    },
  ];
}

export function summary(spec: PersonSpec): UserSummaryResponseDto {
  const first = spec.fullName.split(' ')[0].toLowerCase();
  return {
    user: {
      id: spec.id,
      organizationId: 'org',
      fullName: spec.fullName,
      avatarUrl: null,
      email: `${first}@northwind.health`,
      isEmailVerified: true,
      phoneNumber: spec.id === 'u-sam' ? '+49 30 1234 5678' : null,
      isPhoneVerified: false,
      dob: null,
      gender: 'UNSPECIFIED',
      lastLoginAt: spec.lastLogin === undefined ? null : ago(spec.lastLogin),
      isLocked: spec.locked !== undefined,
      lockedUntil: spec.locked === 'until' ? '2026-10-21T09:00:00.000Z' : null,
      isTwoFactorEnabled: spec.twoStep ?? false,
      createdAt: '2026-03-03T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
    },
    roleIds: spec.roles,
    roleNames: spec.roles.map(
      (id) => ROLES.find((each) => each.id === id)!.name,
    ),
    departmentIds: spec.departments,
    deletedAt: spec.deleted ? '2026-09-12T09:00:00.000Z' : null,
    deletedByName: spec.deleted ? 'Maya Chen' : null,
  };
}

export const invitation = (
  id: string,
  email: string,
  status: InvitationResponseDto['status'],
  over: Partial<InvitationResponseDto> = {},
): InvitationResponseDto => ({
  id,
  email,
  status,
  roleIds: ['r-end'],
  departmentIds: ['finance'],
  primaryDepartmentId: 'finance',
  invitedByName: 'Maya Chen',
  resentCount: 0,
  lastSentAt: ago(30),
  createdAt: ago(30),
  expiresAt: ahead(6 * DAY + 60),
  ...over,
});

export const INVITATIONS: InvitationResponseDto[] = [
  invitation('i1', 'omar@northwind.health', 'PENDING'),
  invitation('i2', 'lena@northwind.health', 'PENDING', {
    roleIds: ['r-agent'],
    departmentIds: ['it'],
    primaryDepartmentId: 'it',
    resentCount: 2,
    lastSentAt: ago(2 * DAY),
    createdAt: ago(5 * DAY),
    expiresAt: ahead(5 * DAY + 60),
  }),
  invitation('i3', 'tom@northwind.health', 'ACCEPTED', {
    createdAt: '2026-10-02T09:00:00.000Z',
  }),
  invitation('i4', 'ines@northwind.health', 'EXPIRED', {
    createdAt: '2026-09-20T09:00:00.000Z',
    expiresAt: '2026-09-27T09:00:00.000Z',
  }),
  invitation('i5', 'kim@northwind.health', 'REVOKED', {
    createdAt: '2026-09-28T09:00:00.000Z',
  }),
];

export const SESSIONS: SessionResponseDto[] = [
  {
    id: 's1',
    deviceName: null,
    ipAddress: '81.2.69.142',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    current: false,
    isTrusted: true,
    trustedUntil: '2026-11-01T09:00:00.000Z',
    expiresAt: ahead(5 * DAY - 120),
    createdAt: ago(120),
  },
  {
    id: 's2',
    deviceName: null,
    ipAddress: '81.2.69.160',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    current: false,
    isTrusted: false,
    trustedUntil: null,
    expiresAt: ahead(6 * DAY - 120),
    createdAt: ago(DAY + 60),
  },
];

/** HR's six, the primary marked, oldest first. */
export function hrMembers(viewer: string): DepartmentMemberResponseDto[] {
  return [
    [viewer, 'Maya Chen', true, 'Maya Chen', '2026-03-03T09:00:00.000Z'],
    ['u-sam', 'Sam Okafor', true, 'Maya Chen', '2026-03-12T09:00:00.000Z'],
    ['u-chrisp', 'Chris Park', true, 'Maya Chen', '2026-04-01T09:00:00.000Z'],
    ['u-rosa', 'Rosa Diaz', true, 'Maya Chen', '2026-10-03T09:00:00.000Z'],
    ['u-kai', 'Kai Brandt', false, 'Sam Okafor', '2026-10-05T09:00:00.000Z'],
    ['u-nina', 'Nina Berg', false, 'Maya Chen', '2026-10-14T09:00:00.000Z'],
  ].map(([id, fullName, isPrimary, assignedByName, assignedAt]) => ({
    user: {
      id,
      fullName,
      email: `${String(fullName).split(' ')[0].toLowerCase()}@northwind.health`,
      avatarUrl: null,
    },
    isPrimary: isPrimary as boolean,
    assignedByName: assignedByName as string,
    assignedAt: assignedAt as string,
  }));
}

const endpoint = (
  id: string,
  url: string,
  description: string,
  eventTypes: string[],
  isActive = true,
  disabledReason: string | null = null,
): WebhookEndpointResponseDto =>
  ({
    id,
    url,
    description,
    eventTypes,
    isActive,
    disabledReason,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  }) as WebhookEndpointResponseDto;

export const EVENT_TYPES = [
  'ticket.assigned',
  'ticket.reassigned',
  'ticket.escalated',
  'ticket.status_changed',
  'ticket.message_created',
  'quota.threshold',
  'limit.threshold',
  'billing.payment_failed',
  'billing.plan_changed',
  'webhook.endpoint_disabled',
];

export const ENDPOINTS: WebhookEndpointResponseDto[] = [
  endpoint(
    'w-slack',
    'https://hooks.slack.com/services/T0/B0',
    'Slack alerts for escalations',
    ['ticket.assigned', 'ticket.reassigned'],
  ),
  endpoint(
    'w-ops',
    'https://ops.northwind.health/synapse',
    'Ops dashboard',
    EVENT_TYPES,
    false,
    'Auto-disabled after 50 consecutive failed deliveries',
  ),
  endpoint(
    'w-zapier',
    'https://hooks.zapier.com/hooks/catch/123/abc',
    'Zapier: new tickets to the CRM',
    ['ticket.assigned'],
    false,
  ),
];

const delivery = (
  id: string,
  eventType: string,
  status: WebhookDeliveryResponseDto['status'],
  attempts: number,
  responseStatus: number | null,
  lastError: string | null,
  occurredAt: string,
): WebhookDeliveryResponseDto => ({
  id,
  eventId: `e-${id}`,
  eventType,
  status,
  attempts,
  responseStatus,
  lastError,
  occurredAt,
  deliveredAt: status === 'DELIVERED' ? occurredAt : null,
});

export const DELIVERIES: WebhookDeliveryResponseDto[] = [
  delivery('d1', 'ticket.escalated', 'DELIVERED', 1, 200, null, ago(2)),
  delivery('d2', 'ticket.assigned', 'DELIVERED', 1, 200, null, ago(60)),
  delivery(
    'd3',
    'ticket.escalated',
    'FAILED',
    5,
    503,
    'Service Unavailable',
    '2026-10-17T18:02:00.000Z',
  ),
  delivery(
    'd4',
    'ticket.assigned',
    'PENDING',
    2,
    null,
    null,
    '2026-10-17T17:40:00.000Z',
  ),
  delivery(
    'd5',
    'ticket.escalated',
    'DELIVERED',
    3,
    200,
    null,
    '2026-10-15T08:40:00.000Z',
  ),
];

const entry = (
  id: string,
  userId: string | null,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  createdAt: string,
  metadata: Record<string, unknown> = {},
): AuditLogResponseDto =>
  ({
    id,
    organizationId: 'org',
    userId,
    action,
    resourceType,
    resourceId,
    ipAddress: userId ? '81.2.69.142' : null,
    userAgent: userId
      ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0.0.0'
      : null,
    metadata,
    createdAt,
  }) as AuditLogResponseDto;

/** The log the deck draws, newest first; the times are fixed days. */
export function auditEntries(viewer: string): AuditLogResponseDto[] {
  return [
    entry(
      'a1',
      viewer,
      'USER_LOCKED',
      'USER',
      'u-alex',
      '2026-10-18T14:20:07.000Z',
      {
        before: { locked: false, until: null, reason: null },
        after: {
          locked: true,
          until: '21 Oct 2026, 09:00',
          reason: 'Laptop reported stolen; waiting for IT to reissue.',
        },
      },
    ),
    entry(
      'a2',
      viewer,
      'ROLE_PERMISSIONS_UPDATED',
      'ROLE',
      'r-billing',
      '2026-10-18T13:05:00.000Z',
    ),
    entry(
      'a3',
      'u-sam',
      'DOCUMENT_FLAG_DISMISSED',
      'DOCUMENT_FLAG',
      'f1',
      '2026-10-18T11:47:00.000Z',
      {
        fileName: 'Remote Work Policy.pdf',
      },
    ),
    entry(
      'a4',
      viewer,
      'ORGANIZATION_SETTINGS_UPDATED',
      'ORGANIZATION',
      'org',
      '2026-10-18T09:12:00.000Z',
      {
        name: 'Northwind Health',
      },
    ),
    entry(
      'a5',
      viewer,
      'DEPARTMENT_MEMBERS_ADDED',
      'DEPARTMENT',
      'hr',
      '2026-10-17T17:30:00.000Z',
    ),
    entry(
      'a6',
      viewer,
      'INVITATION_SENT',
      'INVITATION',
      'i1',
      '2026-10-17T16:02:00.000Z',
      {
        email: 'omar@northwind.health',
      },
    ),
    entry(
      'a7',
      viewer,
      'WEBHOOK_SECRET_ROTATED',
      'WEBHOOK_ENDPOINT',
      'w-slack',
      '2026-10-16T10:15:00.000Z',
      {
        url: 'https://hooks.slack.com/services/T0/B0',
      },
    ),
    entry(
      'a8',
      null,
      'PLATFORM_PLAN_APPLIED',
      'SUBSCRIPTION_PLAN',
      'plan',
      '2026-10-15T08:40:00.000Z',
      {
        name: 'Business',
      },
    ),
  ];
}

/** What a row answers instead of the tables below, by method and path. */
export type Overrides = Record<string, Reply | ((route: Route) => unknown)>;

/**
 * Answers every Settings call from the tables above. A key in `overrides`
 * ("GET /departments", "POST /roles", or a path with its id) wins over the
 * table; anything neither answers goes to the gateway.
 */
export async function settings(
  page: Page,
  viewer: string,
  overrides: Overrides = {},
): Promise<void> {
  const everyone = people(viewer).map(summary);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const key = `${request.method()} ${path}`;
    const override = overrides[key];
    if (override !== undefined) {
      if (override === hang) return;
      if (typeof override === 'function') return override(route);
      return route.fulfill(override);
    }
    const answer = table(key, url.searchParams, viewer, everyone);
    if (answer === undefined) return route.fallback();
    return route.fulfill(answer);
  });
}

function table(
  key: string,
  query: URLSearchParams,
  viewer: string,
  everyone: UserSummaryResponseDto[],
): ReturnType<typeof ok> | undefined {
  const [method, path] = key.split(' ');
  if (method !== 'GET') return undefined;
  if (path === '/organizations/current') return ok(ORGANIZATION);
  if (path === '/organizations/current/settings') return ok(SETTINGS);
  if (path === '/organizations/current/usage') return ok(USAGE);
  if (path === '/users') {
    const roleId = query.get('roleId');
    const search = query.get('searchTerm')?.toLowerCase();
    const departmentId = query.get('departmentId');
    let found = everyone.filter(
      (each) => query.get('includeDeleted') === 'true' || !each.deletedAt,
    );
    if (roleId) found = found.filter((each) => each.roleIds.includes(roleId));
    if (departmentId)
      found = found.filter((each) => each.departmentIds.includes(departmentId));
    if (search) {
      found = found.filter(
        (each) =>
          each.user.fullName.toLowerCase().includes(search) ||
          each.user.email.includes(search),
      );
    }
    const total = roleId || search || departmentId ? found.length : 18;
    return paged(found, total, Number(query.get('limit') ?? 20));
  }
  if (path === '/users/invitations') {
    const status = query.get('status');
    const found = INVITATIONS.filter(
      (each) => !status || each.status === status,
    );
    return paged(found, found.length, 10);
  }
  const person = /^\/users\/([\w-]+)$/.exec(path)?.[1];
  if (person && person !== 'me') {
    const found = everyone.find((each) => each.user.id === person);
    return found ? ok(found) : undefined;
  }
  const permissionsOf = /^\/users\/([\w-]+)\/permissions$/.exec(path)?.[1];
  if (permissionsOf && permissionsOf !== 'me') {
    const found = everyone.find((each) => each.user.id === permissionsOf);
    const codes = new Set(
      (found?.roleIds ?? []).flatMap(
        (id) => ROLES.find((each) => each.id === id)?.permissionCodes ?? [],
      ),
    );
    return ok({ permissionCodes: [...codes] });
  }
  if (
    /^\/users\/[\w-]+\/sessions$/.test(path) &&
    !path.startsWith('/users/me')
  ) {
    return ok(SESSIONS);
  }
  if (path === '/departments') {
    const search = query.get('searchTerm')?.toLowerCase();
    const found = DEPARTMENTS.filter(
      (each) => !search || each.name.toLowerCase().includes(search),
    );
    return paged(found, found.length, Number(query.get('limit') ?? 20));
  }
  const department = /^\/departments\/([\w-]+)$/.exec(path)?.[1];
  if (department) {
    const found = DEPARTMENTS.find((each) => each.id === department);
    return found ? ok(found) : undefined;
  }
  const membersOf = /^\/departments\/([\w-]+)\/members$/.exec(path)?.[1];
  if (membersOf) {
    const search = query.get('searchTerm')?.toLowerCase();
    // Sam's other department, for his page: Finance, not his primary.
    const all =
      membersOf === 'hr'
        ? hrMembers(viewer)
        : membersOf === 'finance'
          ? [
              {
                user: {
                  id: 'u-sam',
                  fullName: 'Sam Okafor',
                  email: 'sam@northwind.health',
                  avatarUrl: null,
                },
                isPrimary: false,
                assignedByName: 'Maya Chen',
                assignedAt: '2026-03-12T09:00:00.000Z',
              },
            ]
          : [];
    const found = all.filter(
      (each) => !search || String(each.user.email).includes(search),
    );
    return paged(found, found.length);
  }
  if (path === '/roles') return paged(ROLES, ROLES.length, 100);
  const roleId = /^\/roles\/([\w-]+)$/.exec(path)?.[1];
  if (roleId) {
    const found = ROLES.find((each) => each.id === roleId);
    return found ? ok(found) : undefined;
  }
  if (path === '/permissions') return ok(PERMISSIONS);
  if (path === '/webhook-endpoints') return ok({ items: ENDPOINTS });
  if (path === '/webhook-endpoints/event-types')
    return ok({ types: EVENT_TYPES });
  const hook = /^\/webhook-endpoints\/([\w-]+)$/.exec(path)?.[1];
  if (hook) {
    const found = ENDPOINTS.find((each) => each.id === hook);
    return found ? ok(found) : undefined;
  }
  if (/^\/webhook-endpoints\/[\w-]+\/deliveries$/.test(path)) {
    return ok({ items: DELIVERIES });
  }
  if (path === '/audit-logs') {
    const action = query.get('action');
    const userId = query.get('userId');
    const found = auditEntries(viewer).filter(
      (each) =>
        (!action || each.action === action) &&
        (!userId || each.userId === userId),
    );
    return paged(found, action || userId ? found.length : 1284, 20);
  }
  if (path === '/audit-logs/actions') {
    return ok({ actions: Object.values(AuditAction) });
  }
  return undefined;
}
