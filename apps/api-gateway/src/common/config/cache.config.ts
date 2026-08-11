/**
 * Every cache scope in the gateway, named once — 29-doc §3, §4.
 *
 * **A scope is written in two places by nature**: at the read that caches it
 * and at the write that evicts it. Two string literals is how a mutation ends
 * up invalidating `department` while the read caches `departments`, which is
 * not a failure anything reports — the read simply never sees an eviction and
 * serves its TTL out, forever, correctly by its own lights.
 */
export const CACHE_SCOPES = {
  permissions: 'permissions',
  roles: 'roles',
  departments: 'departments',
  organizations: 'organizations',
  documents: 'documents',
  tickets: 'tickets',
  users: 'users',
  /** The AI settings and tier — 15-doc §1.3. */
  settings: 'settings',
} as const;

export type CacheScope = (typeof CACHE_SCOPES)[keyof typeof CACHE_SCOPES];

/**
 * The scope for ONE cached entity — 30-doc §2.
 *
 * `entity:user:abc` rather than a `entity:user` scope with an `id` parameter,
 * and the difference is what makes eviction work at two granularities with one
 * mechanism:
 *
 *   - `invalidateScope(org, entityScope('user', id))` drops exactly that user,
 *     because the pattern is `…|entity:user:abc[|:]*`.
 *   - `invalidateScope(org, 'entity:user')` drops every cached user in the
 *     tenant, because `entity:user` is followed by `:` — which the same
 *     character class matches.
 *
 * The precise form is the one a mutation uses. The coarse one is there for the
 * day something changes users in bulk.
 */
export const entityScope = (kind: 'user' | 'department', id: string): string =>
  `entity:${kind}:${id}`;

/**
 * How long a cached entity lives — 30-doc §2.
 *
 * **The TTL is the backstop, not the mechanism.** Every writer of a
 * `UserSummary`'s fields is a gateway mutation (`updateOwnProfile`,
 * `updateUser`, `confirmAvatarUpload`, `deleteAvatar`), and `PATCH
 * /departments/:id` is the only writer of a department — so `@InvalidateCache`
 * is precise invalidation here rather than a fallback, and this bound exists
 * for the writer nobody has enumerated yet.
 *
 * Five minutes rather than an hour for that reason: the shorter the backstop,
 * the smaller the damage from the origin we have not thought of.
 */
export const ENTITY_TTL_SECONDS = 5 * 60;
