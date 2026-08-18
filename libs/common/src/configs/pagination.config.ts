/**
 * @file Paging, sorting, and the per-entity sortable allowlists.
 *
 * Shared by BOTH edges deliberately — the gateway DTO validates with
 * class-validator and every list RPC clamps again, because a service is
 * reachable over gRPC where no ValidationPipe ever ran.
 */

export const SORT_ORDER_OPTIONS = ['ASC', 'DESC'] as const;
export type SortOrder = (typeof SORT_ORDER_OPTIONS)[number];

/**
 * Pagination defaults and bounds, shared by BOTH edges.
 *
 * The gateway DTO enforces them with class-validator; every list RPC in
 * auth-service clamps `limit` against MAX_LIMIT again. That is not belt-and-
 * braces — a service is reachable from other services over gRPC, where no
 * ValidationPipe ever ran, so an unclamped limit there is an unbounded query.
 * One definition, because two would eventually disagree.
 */
export const DEFAULT_SEARCH = {
  PAGE: 1,
  LIMIT: 10,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  SORT_BY: 'createdAt',
  SORT_ORDER: 'ASC' satisfies SortOrder,
} as const;

/**
 * Sortable columns, per entity, declared ONCE for both edges.
 *
 * Each array drives four things that must agree:
 *
 *   1. `@IsIn(...)` on the list DTO — a bad value is a 400 naming the field at
 *      the REST edge, not a gRPC INVALID_ARGUMENT two hops away.
 *   2. The DTO's `sortBy` TYPE, so a typo is a compile error.
 *   3. That DTO's DEFAULT, which must be a member of its own allowlist —
 *      `user_departments` has no `createdAt`, so listing members with no query
 *      parameters returned 400 until the default was overridden.
 *   4. The service-side allowlist passed to `toPrismaPage`, as defence in
 *      depth: auth-service is reachable over gRPC, where no `ValidationPipe`
 *      ever ran.
 *
 * The `as const` + derived type is what makes (2) work; keep both.
 */
export const USER_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'fullName',
  'email',
  'lastLoginAt',
] as const;
export type UserSortableField = (typeof USER_SORTABLE_FIELDS)[number];

export const ROLE_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'userAssigned',
] as const;
export type RoleSortableField = (typeof ROLE_SORTABLE_FIELDS)[number];

export const DEPARTMENT_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
] as const;
export type DepartmentSortableField =
  (typeof DEPARTMENT_SORTABLE_FIELDS)[number];

/**
 * Members sort by their own JOIN columns. `user_departments` has `assignedAt`
 * and no `createdAt` at all, which is why this list shares no member with the
 * base default — see point 3 above.
 */
export const DEPARTMENT_MEMBER_SORTABLE_FIELDS = [
  'assignedAt',
  'isPrimary',
] as const;
export type DepartmentMemberSortableField =
  (typeof DEPARTMENT_MEMBER_SORTABLE_FIELDS)[number];

export const ORGANIZATION_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'slug',
  'status',
] as const;
export type OrganizationSortableField =
  (typeof ORGANIZATION_SORTABLE_FIELDS)[number];

export const INVITATION_SORTABLE_FIELDS = [
  'createdAt',
  'expiresAt',
  'email',
  'status',
] as const;
export type InvitationSortableField =
  (typeof INVITATION_SORTABLE_FIELDS)[number];
