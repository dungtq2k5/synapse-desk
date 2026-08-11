import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@synapsedesk/common';

/**
 * The query-parameter permission rules, and the decorator that declares them.
 *
 * **Here rather than in `query-permission.guard.ts`**, which is where they were
 * declared beside the guard that reads them. Every other guard in the gateway
 * already splits this way — `require-permission.decorator.ts` and
 * `permission.guard.ts` are two files — and a controller that only wants to
 * DECLARE a rule should not import the enforcement machinery to do it.
 */
export const QUERY_PERMISSION_KEY = 'permission:query';

export type QueryPermissionRule = {
  /** The query parameter that widens the answer when truthy. */
  query: string;
  /** What the caller must hold to pass it. */
  permission: PermissionCode;
};

/**
 * A permission required only when a particular query parameter is used.
 *
 * ```ts
 * ＠Get()
 * ＠RequirePermission('department.read')
 * ＠RequirePermissionForQuery({ query: 'includeDeleted', permission: 'department.delete' })
 * list(...) { … }
 * ```
 *
 * **Why this exists rather than a second `@RequirePermission`**: that decorator
 * gates the WHOLE route and its semantics are ANY, so adding `department.delete`
 * there would either deny plain reads to everyone without it, or grant the
 * widened view to anyone holding either code.
 *
 * **And why it is a GUARD rather than a check in the handler**, and this is
 * the load-bearing part. It was a handler check, and `@Cacheable`
 * short-circuits the handler on a hit:
 *
 * ```txt
 * caller with department.delete  →  ?includeDeleted=true  →  200, cached
 * caller without it              →  ?includeDeleted=true  →  200, FROM CACHE
 * ```
 *
 * The 403 never ran. Guards execute before interceptors, so authorization
 * expressed here cannot be skipped by a cache hit — which is the general rule a
 * response cache imposes on everything behind it, and the reason 30-doc §1
 * refuses response caching on the GraphQL surface for exactly this hazard.
 */
export const RequirePermissionForQuery = (...rules: QueryPermissionRule[]) =>
  SetMetadata(QUERY_PERMISSION_KEY, rules);
