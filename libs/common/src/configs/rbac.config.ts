/**
 * @file The permission registry and the system roles built from it.
 *
 * `PERMISSION_CODES` is the single source of truth twice over: it derives the
 * `PermissionCode` union used by `@RequirePermission`, and it is the seed input
 * for the `permissions` table.
 */

/**
 * The canonical permission registry (api-endpoints-plan), in `target.action`
 * form per RDM Table 6.
 *
 * This array is the single source of truth twice over: it derives the
 * `PermissionCode` union used by `@RequirePermission`, and it is the seed input
 * for the `permissions` table — so a typo'd code fails at compile time instead
 * of silently 403-ing at runtime.
 *
 * Platform Super Admin routes (`/platform/*`) are NOT represented here: they are
 * gated by `users.is_super_admin`, not by RBAC rows.
 */
export const PERMISSION_CODES = [
  // Organization (own tenant)
  'organization.read',
  'organization.update',
  'organization.delete',

  // Departments
  'department.read',
  'department.create',
  'department.update',
  'department.delete',
  'department.member.assign',

  // Users & identity administration
  'user.read',
  'user.create',
  'user.update',
  'user.delete',
  'user.invite',
  'user.lock',
  'user.role.assign',
  'user.2fa.reset',
  'user.session.read',
  'user.session.revoke',

  // Roles & RBAC
  'role.read',
  'role.create',
  'role.update',
  'role.delete',
  'role.permission.assign',

  // Tickets
  'ticket.read.all',
  'ticket.create',
  'ticket.update',
  'ticket.delete',
  'ticket.assign',
  'ticket.assign.self',
  'ticket.reassign',
  'ticket.escalate',
  'ticket.resolve',
  'ticket.export',
  'ticket.ai.use',
  'ticket.message.moderate',

  // Knowledge base documents
  'document.read',
  'document.create',
  'document.update',
  'document.delete',
  'document.share',
  'document.reindex',

  // Analytics & compliance
  'analytics.read',
  'audit.read',
  'audit.export',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

/**
 * Human-readable labels written to `permissions.name`. Drives the role-editor
 * UI (`GET /permissions`), which groups rows by the `target` prefix of the code.
 */
export const PERMISSION_NAMES: Record<PermissionCode, string> = {
  'organization.read': 'View Organization Settings',
  'organization.update': 'Update Organization Settings',
  'organization.delete': 'Offboard Organization',

  'department.read': 'View Departments',
  'department.create': 'Create Departments',
  'department.update': 'Update Departments',
  'department.delete': 'Delete Departments',
  'department.member.assign': 'Assign Department Members',

  'user.read': 'View Users',
  'user.create': 'Create Users',
  'user.update': 'Update Users',
  'user.delete': 'Deactivate Users',
  'user.invite': 'Invite Users',
  'user.lock': 'Lock and Unlock Users',
  'user.role.assign': 'Assign User Roles',
  'user.2fa.reset': 'Reset User Two-Factor Auth',
  'user.session.read': 'View User Sessions',
  'user.session.revoke': 'Revoke User Sessions',

  'role.read': 'View Roles',
  'role.create': 'Create Roles',
  'role.update': 'Update Roles',
  'role.delete': 'Delete Roles',
  'role.permission.assign': 'Assign Role Permissions',

  'ticket.read.all': 'View All Tickets',
  'ticket.create': 'Create Tickets',
  'ticket.update': 'Update Tickets',
  'ticket.delete': 'Delete Tickets',
  'ticket.assign': 'Assign Tickets',
  'ticket.assign.self': 'Claim Tickets',
  'ticket.reassign': 'Reassign Tickets',
  'ticket.escalate': 'Escalate Tickets',
  'ticket.resolve': 'Resolve Tickets',
  'ticket.export': 'Export Tickets',
  'ticket.ai.use': 'Use AI Co-Pilot',
  'ticket.message.moderate': 'Moderate Ticket Messages',

  'document.read': 'View Documents',
  'document.create': 'Upload Documents',
  'document.update': 'Update Documents',
  'document.delete': 'Delete Documents',
  'document.share': 'Share Documents With Departments',
  'document.reindex': 'Reindex Documents',

  'analytics.read': 'View Analytics',
  'audit.read': 'View Audit Logs',
  'audit.export': 'Export Audit Logs',
};

/**
 * Global system roles — `organization_id IS NULL`, `is_system_role = true`.
 * Seeded once by auth-service and shared by every tenant; tenant admins may not
 * rename or delete them (api-endpoints-plan).
 *
 * The value IS the `roles.name` column, so it is also what the UI displays.
 */
export enum SystemRoleName {
  ORG_ADMIN = 'Org Admin',
  KNOWLEDGE_MANAGER = 'Knowledge Manager',
  SUPPORT_AGENT = 'Support Agent (Tier 2)',
  END_USER = 'End User',
}

/**
 * Default grants per system role (api-endpoints-plan).
 *
 * END_USER holds no permission rows on purpose: own-ticket access, `/chat/*`
 * and `/knowledge/search` are authorized by ownership and tenancy, not RBAC.
 * It exists so every registered user has a role to carry.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<
  SystemRoleName,
  readonly PermissionCode[]
> = {
  [SystemRoleName.ORG_ADMIN]: PERMISSION_CODES,

  [SystemRoleName.KNOWLEDGE_MANAGER]: [
    'document.read',
    'document.create',
    'document.update',
    'document.delete',
    'document.share',
    'document.reindex',
    'analytics.read',
    'ticket.read.all',
  ],

  [SystemRoleName.SUPPORT_AGENT]: [
    'ticket.read.all',
    'ticket.create',
    'ticket.update',
    'ticket.assign',
    'ticket.assign.self',
    'ticket.reassign',
    'ticket.escalate',
    'ticket.resolve',
    'ticket.ai.use',
    'ticket.message.moderate',
    'document.read',
    'user.read',
  ],

  [SystemRoleName.END_USER]: [],
};

export const SYSTEM_ROLE_DESCRIPTIONS: Record<SystemRoleName, string> = {
  [SystemRoleName.ORG_ADMIN]:
    'Full administrative control over the tenant: members, roles, departments, knowledge base and billing settings.',
  [SystemRoleName.KNOWLEDGE_MANAGER]:
    'Curates the knowledge base — uploads and scopes documents, monitors content quality and answer analytics.',
  [SystemRoleName.SUPPORT_AGENT]:
    'Tier 2 human agent: works the ticket queue, reassigns across departments and uses the AI co-pilot.',
  [SystemRoleName.END_USER]:
    'Default role for every registered member: raises tickets, chats with the AI assistant and searches the knowledge base.',
};
