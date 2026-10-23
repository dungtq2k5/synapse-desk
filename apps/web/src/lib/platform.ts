import {
  JOB_SEQUENCES,
  JOB_SERVICE,
  ORG_STATUS_TRANSITIONS,
  OrgStatus,
  RevenueUnavailableReason,
  SCHEDULED_JOBS,
  type ScheduledJobName,
} from '@synapsedesk/contracts';
import { dayDate } from './format';

/**
 * The platform console's words (design 11's deck): statuses and what they do,
 * jobs and their health, the platform's audit actions, the MRR's reasons.
 * Pure, so each rule has its own row.
 */

/** An organization's status, or offboarded (deleted, restorable). */
export type ConsoleStatus = `${OrgStatus}` | 'OFFBOARDED';

export const STATUS_WORDS: Record<ConsoleStatus, string> = {
  ACTIVE: 'Active',
  PENDING_ONBOARDING: 'Setting up',
  SUSPENDED_PAST_DUE: 'Past due',
  FROZEN: 'Frozen',
  OFFBOARDED: 'Offboarded',
};

/** An organization's status as the console shows it: offboarded first. */
export function consoleStatus(
  status: string | null | undefined,
  deletedAt: string | null | undefined,
): ConsoleStatus {
  if (deletedAt) return 'OFFBOARDED';
  return (status as OrgStatus | null) ?? OrgStatus.ACTIVE;
}

/**
 * What a status does to the organization's people. Past due says since when,
 * when that's known.
 *
 * @example consequence('FROZEN') // 'Its people are signed out and can’t sign in. Nothing works until it’s made Active again.'
 */
export function consequence(
  status: ConsoleStatus,
  since?: string | null,
): string {
  switch (status) {
    case 'ACTIVE':
      return 'Everything works for its people.';
    case 'PENDING_ONBOARDING':
      return 'Everything works; its admin is finishing setup. It isn’t billed yet.';
    case 'SUSPENDED_PAST_DUE':
      return `Read-only: its people can sign in and open everything, but can’t create or change anything. Billing still works, so it can pay.${since ? ` Past due since ${dayDate(since)}.` : ''}`;
    case 'FROZEN':
      return 'Its people are signed out and can’t sign in. Nothing works until it’s made Active again.';
    case 'OFFBOARDED':
      return 'Closed: nobody can sign in. Its data is kept, and it can be restored.';
  }
}

/** The statuses an organization can move to from this one, in the server's order. */
export function reachable(status: ConsoleStatus): OrgStatus[] {
  if (status === 'OFFBOARDED') return [];
  return [...ORG_STATUS_TRANSITIONS[status]];
}

/**
 * The status dialog's main button: it names the change.
 *
 * @example statusAction('FROZEN', 'Lumen Schools') // 'Freeze Lumen Schools'
 */
export function statusAction(to: OrgStatus, name: string): string {
  switch (to) {
    case OrgStatus.ACTIVE:
      return `Make ${name} Active`;
    case OrgStatus.SUSPENDED_PAST_DUE:
      return `Mark ${name} past due`;
    case OrgStatus.FROZEN:
      return `Freeze ${name}`;
    case OrgStatus.PENDING_ONBOARDING:
      return `Mark ${name} as setting up`;
  }
}

/**
 * The MRR's reason, as the deck words it: the server's value is never shown.
 *
 * @example mrrReason('active subscriptions span more than one currency') // 'subscriptions are in more than one currency, so they can’t be added up.'
 */
export function mrrReason(reason: string | null | undefined): string {
  switch (reason) {
    case RevenueUnavailableReason.NOT_CONFIGURED:
      return 'billing isn’t set up on this deployment.';
    case RevenueUnavailableReason.NO_SNAPSHOT:
      return 'the revenue snapshot hasn’t been computed yet.';
    case RevenueUnavailableReason.SNAPSHOT_UNREADABLE:
      return 'the revenue snapshot couldn’t be read.';
    case RevenueUnavailableReason.MIXED_CURRENCIES:
      return 'subscriptions are in more than one currency, so they can’t be added up.';
    default:
      return 'a subscription uses pricing this estimate can’t turn into a monthly amount.';
  }
}

/** Each job and step in words, as the Jobs table names them. */
export const JOB_WORDS: Record<string, string> = {
  [SCHEDULED_JOBS.ANALYTICS_DAILY]: 'Analytics rollup, daily',
  [SCHEDULED_JOBS.LEDGER_DAILY]: 'Usage ledger, daily',
  [SCHEDULED_JOBS.LEDGER_HOURLY]: 'Usage ledger, hourly',
  [SCHEDULED_JOBS.AUTH_HOURLY]: 'Accounts, hourly',
  [SCHEDULED_JOBS.AUTH_DAILY]: 'Accounts, daily',
  [SCHEDULED_JOBS.BILLING_SNAPSHOT]: 'Revenue snapshot',
  [SCHEDULED_JOBS.INGESTION_RECONCILE]: 'Document processing check',
  [SCHEDULED_JOBS.SCOPE_RECONCILE]: 'Sharing check',
  [SCHEDULED_JOBS.WEBHOOK_RETENTION]: 'Webhook history cleanup',
  'ticket-rollup': 'Ticket rollup',
  'chunk-usage-projection': 'Passage usage counts',
  'ai-generation-rollup': 'AI usage rollup',
  'document-flags': 'Document quality flags',
  'discarded-draft-sweep': 'Discarded drafts sweep',
  'quota-reconcile': 'AI allowance reconcile',
  'invitations-expiry': 'Invitation expiry',
  'expired-records': 'Expired records cleanup',
};

/** A job or step in words; an unknown one reads as its code. */
export function jobWords(name: string): string {
  return JOB_WORDS[name] ?? name;
}

/** The two jobs a Super Admin can run now or backfill. */
export const RUNNABLE_JOBS: readonly string[] = [
  SCHEDULED_JOBS.ANALYTICS_DAILY,
  SCHEDULED_JOBS.LEDGER_DAILY,
];

/** The services, as the deck names them. */
export const SERVICE_WORDS: Record<string, string> = {
  'ticket-service': 'Tickets',
  'ingestion-service': 'Documents',
  'auth-service': 'Accounts',
  'notification-service': 'Notifications',
  'rag-service': 'Answers',
  'storage-service': 'Files',
};

export function serviceWords(service: string): string {
  return SERVICE_WORDS[service] ?? service;
}

/**
 * The jobs a service runs, for a service that didn't answer: it can't list
 * them, so they're read from the schedule.
 *
 * @example jobsOf('notification-service') // ['webhook-retention']
 */
export function jobsOf(service: string): ScheduledJobName[] {
  const owner = service.replace(/-service$/, '');
  return (Object.keys(JOB_SERVICE) as ScheduledJobName[]).filter(
    (name) => JOB_SERVICE[name] === owner,
  );
}

/** The job a step belongs to, or null for a job. */
export function parentOf(step: string): ScheduledJobName | null {
  const entry = (
    Object.entries(JOB_SEQUENCES) as [ScheduledJobName, readonly string[]][]
  ).find(([job, steps]) => job !== step && steps.includes(step));
  return entry?.[0] ?? null;
}

export type Health =
  'healthy' | 'stale' | 'failing' | 'never-ran' | 'step' | 'not-reached';

export const HEALTH_WORDS: Record<Health, string> = {
  healthy: 'Healthy',
  stale: 'Stale',
  failing: 'Failing',
  'never-ran': 'Never ran',
  step: 'Step',
  'not-reached': 'Not reached',
};

/** The platform's own audit actions, as its log says them. */
export const PLATFORM_ACTION_WORDS: Record<string, string> = {
  PLATFORM_ORGANIZATION_CREATED: 'Created an organization',
  PLATFORM_ORGANIZATION_UPDATED: 'Edited an organization',
  PLATFORM_ORGANIZATION_STATUS_CHANGED: 'Changed an organization’s status',
  PLATFORM_BILLING_CYCLE_RESET: 'Reset a billing cycle',
  PLATFORM_ORGANIZATION_OFFBOARDED: 'Offboarded an organization',
  PLATFORM_ORGANIZATION_RESTORED: 'Restored an organization',
  PLATFORM_GLOBAL_ROLE_CREATED: 'Created a global role',
  PLATFORM_PLAN_CREATED: 'Created a plan',
  PLATFORM_PLAN_UPDATED: 'Changed a plan',
  PLATFORM_PLAN_DELETED: 'Retired a plan',
  PLATFORM_PLAN_APPLIED: 'Applied a plan',
  PLATFORM_JOB_RUN: 'Ran a job',
  PLATFORM_JOB_BACKFILLED: 'Recomputed a job’s range',
};

export function platformActionWords(action: string | null | undefined): string {
  if (!action) return '—';
  return PLATFORM_ACTION_WORDS[action] ?? action;
}

/** What a platform entry is about, by kind. */
export const PLATFORM_KIND_WORDS: Record<string, string> = {
  ORGANIZATION: 'Organization',
  SUBSCRIPTION_PLAN: 'Plan',
  ROLE: 'Global role',
  JOB: 'Job',
};

/** An organization's own page lists the platform's acts on it in these words. */
export const ORGANIZATION_ACT_WORDS: Record<string, string> = {
  PLATFORM_ORGANIZATION_CREATED: 'Created it',
  PLATFORM_ORGANIZATION_UPDATED: 'Edited it',
  PLATFORM_ORGANIZATION_STATUS_CHANGED: 'Changed its status',
  PLATFORM_BILLING_CYCLE_RESET: 'Reset its billing cycle',
  PLATFORM_ORGANIZATION_OFFBOARDED: 'Offboarded it',
  PLATFORM_ORGANIZATION_RESTORED: 'Restored it',
};

/**
 * One of the platform's acts on an organization, in words, with what changed
 * where the entry says: "Changed its status: Past due → Active".
 *
 * @example organizationAct('PLATFORM_ORGANIZATION_STATUS_CHANGED', { from: 'SUSPENDED_PAST_DUE', to: 'ACTIVE' }) // 'Changed its status: Past due → Active'
 */
export function organizationAct(
  action: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (!action) return '—';
  const words = ORGANIZATION_ACT_WORDS[action] ?? platformActionWords(action);
  if (action === 'PLATFORM_ORGANIZATION_STATUS_CHANGED') {
    const from = STATUS_WORDS[metadata?.from as ConsoleStatus];
    const to = STATUS_WORDS[metadata?.to as ConsoleStatus];
    if (from && to) return `${words}: ${from} → ${to}`;
  }
  if (action === 'PLATFORM_ORGANIZATION_UPDATED') {
    const what = changedFields(metadata);
    if (what) return `${words}: ${what}`;
  }
  return words;
}

const FIELD_WORDS: Record<string, string> = {
  name: 'name',
  slug: 'address',
  maxAgentSeats: 'seats',
};

/**
 * "seats 25 → 30": what an edit changed, from the entry's before and after.
 *
 * @example changedFields({ before: { maxAgentSeats: 25 }, after: { maxAgentSeats: 30 } }) // 'seats 25 → 30'
 */
export function changedFields(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const before = (metadata?.before ?? {}) as Record<string, unknown>;
  const after = (metadata?.after ?? {}) as Record<string, unknown>;
  const words = Object.keys(FIELD_WORDS)
    .filter((key) => key in after && before[key] !== after[key])
    .map(
      (key) =>
        `${FIELD_WORDS[key]} ${String(before[key])} → ${String(after[key])}`,
    );
  return words.length ? words.join(', ') : null;
}

/** The reason an entry carries, or null. */
export function reasonOf(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const reason = metadata?.reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}

/**
 * A job entry's details: a run's counts, a range's days and organization.
 *
 * @example jobDetails({ tenants: 3, rows: 120 }) // '3 organizations, 120 rows'
 */
export function jobDetails(
  metadata: Record<string, unknown> | null | undefined,
  organizationName?: string | null,
): string {
  const parts: string[] = [];
  if (typeof metadata?.from === 'string' && typeof metadata.to === 'string') {
    parts.push(
      `${dayDate(metadata.from)} – ${dayDate(metadata.to)}${organizationName ? `, ${organizationName}` : ''}`,
    );
  }
  if (typeof metadata?.tenants === 'number') {
    parts.push(
      `${count(metadata.tenants, 'organization')}, ${count(Number(metadata.rows ?? 0), 'row')}`,
    );
  }
  return parts.join(' · ');
}

/**
 * A number and its noun, plural unless one.
 *
 * @example count(1, 'session') // '1 session'
 */
export function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? noun : `${noun}s`}`;
}

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const gbText = (bytes: number) => `${Number((bytes / GIB).toFixed(1))} GB`;
const mbText = (bytes: number) => `${Number((bytes / MIB).toFixed(1))} MB`;
const usd = (micros: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    micros / 1_000_000,
  );
const plain = (n: number) => n.toLocaleString('en-US');
const TIER: Record<string, string> = { FAST: 'Fast', QUALITY: 'Quality' };

/** Each grant an apply can change: its words and how its values read. */
const GRANT_WORDS: Record<
  string,
  [string, (value: number) => string, string?]
> = {
  maxAgentSeats: ['Seats', plain],
  maxStorageBytes: ['Storage', gbText],
  monthlyAiTokenBudget: ['AI allowance', usd, ' a month'],
  maxDocumentBytes: ['Largest document', mbText],
  maxAttachmentBytes: ['Largest attachment', mbText],
  maxDocumentUploads: ['Documents', plain],
  maxAnalyticsRangeDays: ['Analytics ranges', plain, ' days'],
};

/**
 * What applying changes for one subscriber, a line per grant: "Seats 20 →
 * 25", "AI allowance $12.00 → $10.00 a month, from its next cycle".
 *
 * @example changeLines({ maxAgentSeats: '20 -> 25' }, false) // ['Seats 20 → 25']
 */
export function changeLines(
  changes: Record<string, unknown>,
  budgetDeferred: boolean,
): string[] {
  return Object.entries(changes).map(([field, text]) => {
    const [before, after] = String(text).split(' -> ');
    if (field === 'aiModelTier') {
      return `AI model ${TIER[before] ?? before} → ${TIER[after] ?? after}`;
    }
    const words = GRANT_WORDS[field];
    if (!words) return `${field} ${before} → ${after}`;
    const [label, format, unit = ''] = words;
    const line = `${label} ${format(Number(before))} → ${format(Number(after))}${unit}`;
    return field === 'monthlyAiTokenBudget' && budgetDeferred
      ? `${line}, from its next cycle`
      : line;
  });
}

export type OverLimitItem = {
  dimension: string;
  inUse: number;
  allowed: number;
};

/**
 * One limit a subscriber would break, in words.
 *
 * @example overLimitLine({ dimension: 'SEATS', inUse: 31, allowed: 25 }) // 'Seats: 31 in use, the plan grants 25'
 */
export function overLimitLine(item: OverLimitItem): string {
  switch (item.dimension) {
    case 'SEATS':
      return `Seats: ${plain(item.inUse)} in use, the plan grants ${plain(item.allowed)}`;
    case 'STORAGE':
      return `Storage: ${gbText(item.inUse)} used, the plan grants ${gbText(item.allowed)}`;
    default:
      return `Documents: ${plain(item.inUse)} held, the plan grants ${plain(item.allowed)}`;
  }
}

const DIMENSION_WORDS: Record<string, string> = {
  SEATS: 'seats',
  STORAGE: 'storage',
  DOCUMENTS: 'documents',
};

/**
 * The warning above Apply: who'd be over, and the limit each breaks.
 *
 * @example overLimitWarning([{ name: 'Lumen Schools', items: [{ dimension: 'SEATS', inUse: 31, allowed: 25 }] }], 'Pro') // 'Lumen Schools (seats) uses more than Pro grants. …'
 */
export function overLimitWarning(
  over: { name: string; items: OverLimitItem[] }[],
  plan: string,
): { title: string; description: string } {
  const named = over.map(
    ({ name, items }) =>
      `${name} (${items.map((item) => DIMENSION_WORDS[item.dimension] ?? item.dimension.toLowerCase()).join(', ')})`,
  );
  const list =
    named.length <= 1
      ? named.join('')
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return {
    title: `${count(over.length, 'organization')} will be over a limit after this`,
    description: `${list} ${over.length === 1 ? 'uses' : 'use'} more than ${plan} grants. Applying still changes ${over.length === 1 ? 'it' : 'them'}: that’s your call to make here.`,
  };
}

/** What a platform audit entry is about: a name, where it opens, and details. */
export type About = {
  name: string;
  href: string | null;
  kind: string;
  details: string | null;
};

type Entry = {
  action?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * An entry's About column: the organization, plan, global role or job as a
 * link, its kind, and what changed in words.
 *
 * @example aboutOf({ action: 'PLATFORM_JOB_RUN', resourceType: 'JOB', metadata: { jobName: 'analytics-daily', tenants: 42, rows: 1268 } }).details // '42 organizations, 1,268 rows'
 */
export function aboutOf(entry: Entry, organizationName?: string | null): About {
  const metadata = entry.metadata ?? {};
  const name = (fallback: string) =>
    entry.resourceName ??
    (typeof metadata.name === 'string' ? metadata.name : fallback);
  switch (entry.resourceType) {
    case 'ORGANIZATION': {
      const sessions =
        typeof metadata.revokedSessionCount === 'number'
          ? `${count(metadata.revokedSessionCount, 'session')} signed out`
          : null;
      const details =
        entry.action === 'PLATFORM_ORGANIZATION_CREATED' &&
        typeof metadata.adminEmail === 'string'
          ? `Org Admin: ${metadata.adminEmail}`
          : entry.action === 'PLATFORM_ORGANIZATION_STATUS_CHANGED'
            ? [organizationAct(entry.action, metadata).split(': ')[1], sessions]
                .filter(Boolean)
                .join(' · ')
            : entry.action === 'PLATFORM_ORGANIZATION_UPDATED'
              ? changedFields(metadata)
              : sessions;
      return {
        name: name('An organization'),
        href: entry.resourceId
          ? `/platform/organizations/${entry.resourceId}`
          : null,
        kind: PLATFORM_KIND_WORDS.ORGANIZATION,
        details: details || null,
      };
    }
    case 'SUBSCRIPTION_PLAN':
      return {
        name: name('A plan'),
        href:
          entry.resourceId && entry.action !== 'PLATFORM_PLAN_DELETED'
            ? `/platform/plans/${entry.resourceId}`
            : null,
        kind: PLATFORM_KIND_WORDS.SUBSCRIPTION_PLAN,
        details:
          entry.action === 'PLATFORM_PLAN_APPLIED' &&
          typeof metadata.changedCount === 'number'
            ? `${count(metadata.changedCount, 'organization')} changed`
            : null,
      };
    case 'ROLE':
      return {
        name: name('A global role'),
        href: '/platform/roles',
        kind: PLATFORM_KIND_WORDS.ROLE,
        details: Array.isArray(metadata.permissionCodes)
          ? count(metadata.permissionCodes.length, 'permission')
          : null,
      };
    case 'JOB':
      return {
        name:
          typeof metadata.jobName === 'string'
            ? jobWords(metadata.jobName)
            : 'A job',
        href: '/platform/jobs',
        kind: PLATFORM_KIND_WORDS.JOB,
        details: jobDetails(metadata, organizationName) || null,
      };
    default:
      return {
        name: entry.resourceType ?? '—',
        href: null,
        kind: '',
        details: null,
      };
  }
}
