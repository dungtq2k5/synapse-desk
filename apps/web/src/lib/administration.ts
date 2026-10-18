import {
  AuditAction,
  AuditResourceType,
  type NotificationType,
  type PermissionCode,
  SystemRoleName,
} from '@synapsedesk/contracts';

/**
 * The words people read for the codes the server speaks: permissions, audit
 * actions, resource types and webhook events. Keyed by the contract's own
 * types, so a code added there without words here is a compile error.
 */

/** A permission's area, in the catalog's order. */
export const PERMISSION_GROUPS = [
  'Organization',
  'People',
  'Departments',
  'Roles',
  'Tickets',
  'Documents',
  'Analytics',
  'Audit log',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/** Each permission: its group and what it lets someone do. */
export const PERMISSION_WORDS: Record<
  PermissionCode,
  { group: PermissionGroup; words: string }
> = {
  'organization.read': {
    group: 'Organization',
    words: 'View organization settings',
  },
  'organization.update': {
    group: 'Organization',
    words: 'Change organization settings',
  },
  'organization.delete': {
    group: 'Organization',
    words: 'Delete the organization',
  },
  'user.read': { group: 'People', words: 'View people' },
  'user.create': { group: 'People', words: 'Create accounts directly' },
  'user.update': { group: 'People', words: 'Edit people’s details' },
  'user.delete': { group: 'People', words: 'Delete and restore people' },
  'user.invite': { group: 'People', words: 'Invite people' },
  'user.lock': { group: 'People', words: 'Lock and unlock people' },
  'user.role.assign': { group: 'People', words: 'Give and take away roles' },
  'user.2fa.reset': { group: 'People', words: 'Reset two-step verification' },
  'user.session.read': { group: 'People', words: 'View people’s sessions' },
  'user.session.revoke': { group: 'People', words: 'Sign people out' },
  'department.read': { group: 'Departments', words: 'View departments' },
  'department.create': { group: 'Departments', words: 'Create departments' },
  'department.update': { group: 'Departments', words: 'Edit departments' },
  'department.delete': {
    group: 'Departments',
    words: 'Delete and restore departments',
  },
  'department.member.assign': {
    group: 'Departments',
    words: 'Add and remove department members',
  },
  'role.read': { group: 'Roles', words: 'View roles' },
  'role.create': { group: 'Roles', words: 'Create roles' },
  'role.update': { group: 'Roles', words: 'Rename roles' },
  'role.delete': { group: 'Roles', words: 'Delete roles' },
  'role.permission.assign': {
    group: 'Roles',
    words: 'Change what roles can do',
  },
  'ticket.read.all': { group: 'Tickets', words: 'View all tickets' },
  'ticket.create': { group: 'Tickets', words: 'Open tickets' },
  'ticket.update': { group: 'Tickets', words: 'Update tickets' },
  'ticket.delete': { group: 'Tickets', words: 'Delete tickets' },
  'ticket.assign': { group: 'Tickets', words: 'Assign tickets' },
  'ticket.assign.self': { group: 'Tickets', words: 'Take tickets' },
  'ticket.reassign': { group: 'Tickets', words: 'Reassign tickets' },
  'ticket.escalate': { group: 'Tickets', words: 'Escalate tickets' },
  'ticket.resolve': { group: 'Tickets', words: 'Resolve tickets' },
  'ticket.export': { group: 'Tickets', words: 'Export tickets' },
  'ticket.ai.use': { group: 'Tickets', words: 'Use the AI co-pilot' },
  'ticket.message.moderate': {
    group: 'Tickets',
    words: 'Moderate ticket messages',
  },
  'document.read': { group: 'Documents', words: 'View documents' },
  'document.create': { group: 'Documents', words: 'Upload documents' },
  'document.update': { group: 'Documents', words: 'Edit documents' },
  'document.delete': { group: 'Documents', words: 'Delete documents' },
  'document.share': {
    group: 'Documents',
    words: 'Share documents with departments',
  },
  'document.reindex': { group: 'Documents', words: 'Reindex documents' },
  'analytics.read': { group: 'Analytics', words: 'View analytics' },
  'audit.read': { group: 'Audit log', words: 'View the audit log' },
  'audit.export': { group: 'Audit log', words: 'Export the audit log' },
};

/**
 * A permission in words; a code this build doesn't know reads as itself
 * rather than as nothing.
 *
 * @example permissionWords('user.lock') // 'Lock and unlock people'
 */
export function permissionWords(code: string): string {
  return PERMISSION_WORDS[code as PermissionCode]?.words ?? code;
}

/**
 * What each system role is for. The server keeps no description for them,
 * so these are the words people read.
 */
const SYSTEM_ROLE_WORDS: Record<
  SystemRoleName,
  (organization: string) => string
> = {
  [SystemRoleName.ORG_ADMIN]: (organization) =>
    `Everything in ${organization}: people, roles, departments, knowledge and settings.`,
  [SystemRoleName.KNOWLEDGE_MANAGER]: () =>
    'Keeps the knowledge base: uploads and shares documents, watches quality and analytics.',
  [SystemRoleName.SUPPORT_AGENT]: () =>
    'Works the ticket queue, reassigns across departments and uses the AI co-pilot.',
  [SystemRoleName.END_USER]: () =>
    'Every member: opens tickets, asks the AI and searches the knowledge base.',
};

/**
 * A role's description: a system role's in words, a custom one's as written.
 *
 * @example roleDescription({ name: 'End User', isSystemRole: true, description: null }, 'Acme')
 */
export function roleDescription(
  role: { name: string; isSystemRole: boolean; description: string | null },
  organization: string,
): string | null {
  const words = role.isSystemRole
    ? SYSTEM_ROLE_WORDS[role.name as SystemRoleName]
    : undefined;
  return words ? words(organization) : role.description;
}

/** Each audit action as the sentence the log shows. */
export const AUDIT_ACTION_WORDS: Record<AuditAction, string> = {
  [AuditAction.USER_LOGOUT_ALL]: 'Signed out everywhere',
  [AuditAction.PASSWORD_CHANGED]: 'Changed their password',
  [AuditAction.USER_SESSIONS_REVOKED]: 'Signed a person out everywhere',
  [AuditAction.DEPARTMENT_CREATED]: 'Created a department',
  [AuditAction.DEPARTMENT_UPDATED]: 'Edited a department',
  [AuditAction.DEPARTMENT_DELETED]: 'Deleted a department',
  [AuditAction.DEPARTMENT_RESTORED]: 'Restored a department',
  [AuditAction.DEPARTMENT_MEMBERS_ADDED]: 'Added people to a department',
  [AuditAction.DEPARTMENT_MEMBER_REMOVED]: 'Removed a person from a department',
  [AuditAction.ROLE_CREATED]: 'Created a role',
  [AuditAction.ROLE_UPDATED]: 'Edited a role’s name or description',
  [AuditAction.ROLE_DELETED]: 'Deleted a role',
  [AuditAction.ROLE_PERMISSIONS_UPDATED]: 'Changed a role’s permissions',
  [AuditAction.USER_CREATED]: 'Created an account',
  [AuditAction.USER_UPDATED]: 'Edited a person’s details',
  [AuditAction.USER_DELETED]: 'Deleted a person',
  [AuditAction.USER_RESTORED]: 'Restored a person',
  [AuditAction.USER_LOCKED]: 'Locked a person',
  [AuditAction.USER_UNLOCKED]: 'Unlocked a person',
  [AuditAction.USER_TWO_FACTOR_RESET]: 'Reset a person’s two-step verification',
  [AuditAction.USER_ROLES_UPDATED]: 'Changed a person’s roles',
  [AuditAction.USER_DEPARTMENTS_UPDATED]: 'Changed a person’s departments',
  [AuditAction.USER_AVATAR_UPDATED]: 'Changed their photo',
  [AuditAction.ORGANIZATION_UPDATED]: 'Edited the organization’s profile',
  [AuditAction.ORGANIZATION_SETTINGS_UPDATED]:
    'Changed the organization’s settings',
  [AuditAction.ORGANIZATION_ONBOARDING_COMPLETED]:
    'Finished setting up the organization',
  [AuditAction.ORGANIZATION_OFFBOARD_REQUESTED]:
    'Asked to delete the organization',
  [AuditAction.PLATFORM_ORGANIZATION_CREATED]:
    'SynapseDesk created the organization',
  [AuditAction.PLATFORM_ORGANIZATION_UPDATED]:
    'SynapseDesk edited the organization',
  [AuditAction.PLATFORM_ORGANIZATION_STATUS_CHANGED]:
    'SynapseDesk changed the organization’s status',
  [AuditAction.PLATFORM_BILLING_CYCLE_RESET]:
    'SynapseDesk reset the billing cycle',
  [AuditAction.PLATFORM_ORGANIZATION_OFFBOARDED]:
    'SynapseDesk deleted the organization',
  [AuditAction.PLATFORM_ORGANIZATION_RESTORED]:
    'SynapseDesk restored the organization',
  [AuditAction.DOCUMENT_FLAG_RESOLVED]: 'Resolved a quality flag',
  [AuditAction.DOCUMENT_FLAG_DISMISSED]: 'Dismissed a quality flag',
  [AuditAction.DOCUMENT_FLAG_DELETED]: 'Deleted a quality flag',
  [AuditAction.DATA_EXPORT_REQUESTED]: 'Requested a data export',
  [AuditAction.PLATFORM_GLOBAL_ROLE_CREATED]:
    'SynapseDesk created a system role',
  [AuditAction.PLATFORM_PLAN_CREATED]: 'SynapseDesk created a plan',
  [AuditAction.PLATFORM_PLAN_UPDATED]: 'SynapseDesk changed a plan',
  [AuditAction.PLATFORM_PLAN_DELETED]: 'SynapseDesk deleted a plan',
  [AuditAction.PLATFORM_PLAN_APPLIED]:
    'SynapseDesk changed the organization’s plan',
  [AuditAction.INVITATION_SENT]: 'Invited a person',
  [AuditAction.INVITATION_RESENT]: 'Resent an invitation',
  [AuditAction.INVITATION_REVOKED]: 'Revoked an invitation',
  [AuditAction.WEBHOOK_ENDPOINT_CREATED]: 'Created a webhook endpoint',
  [AuditAction.WEBHOOK_ENDPOINT_UPDATED]: 'Changed a webhook endpoint',
  [AuditAction.WEBHOOK_SECRET_ROTATED]: 'Rotated a webhook’s signing secret',
  [AuditAction.WEBHOOK_ENDPOINT_DELETED]: 'Deleted a webhook endpoint',
  [AuditAction.INBOUND_ADDRESS_ENABLED]: 'Turned on the inbound email address',
  [AuditAction.INBOUND_ADDRESS_ROTATED]: 'Rotated the inbound email address',
  [AuditAction.INBOUND_ADDRESS_DISABLED]:
    'Turned off the inbound email address',
};

/** An audit action in words; an unknown code reads as itself. */
export function auditActionWords(action: string): string {
  return AUDIT_ACTION_WORDS[action as AuditAction] ?? action;
}

/** What an audit entry happened to, in words. */
export const RESOURCE_TYPE_WORDS: Record<AuditResourceType, string> = {
  [AuditResourceType.USER]: 'Person',
  [AuditResourceType.DEPARTMENT]: 'Department',
  [AuditResourceType.ROLE]: 'Role',
  [AuditResourceType.ORGANIZATION]: 'Organization',
  [AuditResourceType.DOCUMENT_FLAG]: 'Quality flag',
  [AuditResourceType.EXPORT]: 'Export',
  [AuditResourceType.SUBSCRIPTION_PLAN]: 'Plan',
  [AuditResourceType.INVITATION]: 'Invitation',
  [AuditResourceType.WEBHOOK_ENDPOINT]: 'Webhook endpoint',
};

/** Each webhook event type, as the endpoint's checkboxes say it. */
export const EVENT_TYPE_WORDS: Record<NotificationType, string> = {
  'ticket.assigned': 'Ticket assigned',
  'ticket.reassigned': 'Ticket reassigned',
  'ticket.escalated': 'Ticket escalated',
  'ticket.status_changed': 'Ticket status changed',
  'ticket.message_created': 'New message on a ticket',
  'quota.threshold': 'AI allowance threshold',
  'limit.threshold': 'Plan limit threshold',
  'billing.payment_failed': 'Payment failed',
  'billing.plan_changed': 'Plan changed',
  'webhook.endpoint_disabled': 'Webhook endpoint turned off',
};
