/**
 * @file The NATS contract between any service and whoever owns `audit_logs`.
 *
 * That table belongs to Domain D (`ticket-service`), which does not exist yet.
 * Publishing over NATS now — rather than waiting, or adding a second
 * `audit_logs` table to auth-service — means switching on the real sink later
 * is a SUBSCRIBER change and nothing else. Two writers to one logical table is
 * a migration problem; a queue with no consumer is not.
 *
 * Same reasoning as notification.contract.ts: `emit`, never `send`. An audit
 * write must not be able to fail the request it describes, and must not add
 * broker latency to it.
 */

import type { RequestOrigin } from '../configs/identity.config';

export const AUDIT_PATTERNS = {
  record: 'audit.record',
} as const;

/**
 * What happened, in SCREAMING_SNAKE.
 *
 * An enum rather than a free string so a typo is a compile error. A mistyped
 * action produces a row that looks like evidence, is not queryable alongside
 * its siblings, and is discovered during the incident it exists for.
 */
export enum AuditAction {
  // Sessions and credentials
  USER_LOGOUT_ALL = 'USER_LOGOUT_ALL',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  USER_SESSIONS_REVOKED = 'USER_SESSIONS_REVOKED',

  // Departments
  DEPARTMENT_CREATED = 'DEPARTMENT_CREATED',
  DEPARTMENT_UPDATED = 'DEPARTMENT_UPDATED',
  DEPARTMENT_DELETED = 'DEPARTMENT_DELETED',
  DEPARTMENT_RESTORED = 'DEPARTMENT_RESTORED',
  DEPARTMENT_MEMBERS_ADDED = 'DEPARTMENT_MEMBERS_ADDED',
  DEPARTMENT_MEMBER_REMOVED = 'DEPARTMENT_MEMBER_REMOVED',

  // Roles
  ROLE_CREATED = 'ROLE_CREATED',
  ROLE_UPDATED = 'ROLE_UPDATED',
  ROLE_DELETED = 'ROLE_DELETED',
  ROLE_PERMISSIONS_UPDATED = 'ROLE_PERMISSIONS_UPDATED',

  // Users
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_RESTORED = 'USER_RESTORED',
  USER_LOCKED = 'USER_LOCKED',
  USER_UNLOCKED = 'USER_UNLOCKED',
  USER_TWO_FACTOR_RESET = 'USER_TWO_FACTOR_RESET',
  USER_ROLES_UPDATED = 'USER_ROLES_UPDATED',
  USER_DEPARTMENTS_UPDATED = 'USER_DEPARTMENTS_UPDATED',
  /** An avatar was set, replaced or cleared  */
  USER_AVATAR_UPDATED = 'USER_AVATAR_UPDATED',

  // Organization
  ORGANIZATION_UPDATED = 'ORGANIZATION_UPDATED',
  ORGANIZATION_SETTINGS_UPDATED = 'ORGANIZATION_SETTINGS_UPDATED',
  ORGANIZATION_ONBOARDING_COMPLETED = 'ORGANIZATION_ONBOARDING_COMPLETED',
  ORGANIZATION_OFFBOARD_REQUESTED = 'ORGANIZATION_OFFBOARD_REQUESTED',

  // Platform (recorded with organizationId = null — the event belongs to the
  // platform, not to the customer it touched).
  PLATFORM_ORGANIZATION_CREATED = 'PLATFORM_ORGANIZATION_CREATED',
  PLATFORM_ORGANIZATION_UPDATED = 'PLATFORM_ORGANIZATION_UPDATED',
  PLATFORM_ORGANIZATION_STATUS_CHANGED = 'PLATFORM_ORGANIZATION_STATUS_CHANGED',
  PLATFORM_BILLING_CYCLE_RESET = 'PLATFORM_BILLING_CYCLE_RESET',
  PLATFORM_ORGANIZATION_OFFBOARDED = 'PLATFORM_ORGANIZATION_OFFBOARDED',

  // Document quality flags. Only the acts a PERSON takes: `raise()` is a sweep
  // writing many rows per run, and `document_flags.detected_at` already records
  // when it found something.
  DOCUMENT_FLAG_RESOLVED = 'DOCUMENT_FLAG_RESOLVED',
  // Separate from RESOLVED because a dismissal SUPPRESSES the detector for
  // `DISMISSAL_SUPPRESSION_DAYS`, which the other two resolutions do not.
  DOCUMENT_FLAG_DISMISSED = 'DOCUMENT_FLAG_DISMISSED',
  // The row is hard-deleted and `document_flags` has no `deleted_at`, so this
  // is the ONLY trace that it ever existed.
  DOCUMENT_FLAG_DELETED = 'DOCUMENT_FLAG_DELETED',

  /**
   * Somebody asked for a copy of tenant data.
   *
   * Recorded at REQUEST time, not on completion: the act being audited is that
   * a person asked, which is true whether or not the file ever renders. For the
   * audit-log export it also closes a circularity — the one export whose
   * purpose is compliance was the one act absent from the log it exports.
   */
  DATA_EXPORT_REQUESTED = 'DATA_EXPORT_REQUESTED',
  PLATFORM_ORGANIZATION_RESTORED = 'PLATFORM_ORGANIZATION_RESTORED',
  PLATFORM_GLOBAL_ROLE_CREATED = 'PLATFORM_GLOBAL_ROLE_CREATED',
}

/**
 * What an audit event happened TO.
 *
 * Was a bare `string` on `RecordAuditCommand.resourceType`, with a comment
 * listing the intended values — which is exactly the gap that let
 * `sessions.service.ts` and `departments.service.ts` each declare their OWN
 * local `RESOURCE_TYPE` constant, and let `auth.service.ts` skip the constant
 * entirely and write the literal `'user'` twice. None of the three could
 * disagree at compile time; a typo in any of them silently produces a
 * resource type that matches nothing this enum's siblings use.
 *
 * Add a member here — and nowhere else — the moment a new resource starts
 * publishing audit events.
 */
export enum AuditResourceType {
  USER = 'USER',
  DEPARTMENT = 'DEPARTMENT',
  ROLE = 'ROLE',
  ORGANIZATION = 'ORGANIZATION',
  DOCUMENT_FLAG = 'DOCUMENT_FLAG',
  /** An export request — the row, not the file it produces. */
  EXPORT = 'EXPORT',
}

/**
 * A single audit event.
 *
 * Three properties make these rows worth keeping, and each is a field decision
 * rather than a convention:
 *
 *  1. **Actor and target are separate.** `userId` is who acted; `resourceId` is
 *     who or what it happened to. An admin locking a user needs both, and
 *     collapsing them makes the trail useless in exactly the incident it exists
 *     for.
 *  2. **`metadata` carries a REDACTED before/after diff.** Never
 *     `password_hash`, `two_factor_secret`, any `*_token_hash`, any
 *     `code_hash`. Whitelist the fields worth recording per resource type — a
 *     blacklist forgets the next secret someone adds to the model.
 *  3. **`occurredAt` is stamped by the PUBLISHER.** If the consumer stamped it,
 *     a restart would backdate a week of events to the moment it caught up, and
 *     the ordering that makes a trail readable would be gone.
 */
export type RecordAuditCommand = {
  action: AuditAction;

  /**
   * null for platform-level acts (RDM) — the event belongs to the
   * platform, not to the customer it touched.
   */
  organizationId: string | null;

  /** null for system and cron actors, which have no user row acting for them. */
  userId: string | null;

  /** Observed by the gateway, never claimed by the caller. */
  origin: RequestOrigin;

  resourceType: AuditResourceType;
  resourceId: string | null;

  metadata?: Record<string, unknown>;

  /**
   * Stamped by the publisher, and it does two jobs with one field.
   *
   * As `Nats-Msg-Id` it is the stream's PUBLISH dedupe — one act published
   * twice inside `DUPLICATE_WINDOW_MS` becomes one message. As a UNIQUE column
   * on `audit_logs` it makes a REDELIVERY a no-op. Those defend different
   * failures and neither substitutes for the other: the window cannot see a
   * redelivery, and the column cannot see a republish that never reached the
   * consumer.
   *
   * Generated rather than derived from the event's contents. Two genuinely
   * distinct acts can be identical in every other field — the same admin
   * locking the same user twice in one second is two events, and a content
   * hash would silently record one.
   */
  eventId: string;

  /** ISO 8601, from the publisher's clock. */
  occurredAt: string;
};
