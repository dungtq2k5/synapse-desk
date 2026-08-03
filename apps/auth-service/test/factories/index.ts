/**
 * One import site for every factory.
 *
 * A barrel here rather than per-file imports in each suite: a test that needs
 * an org, a user and a role should say so in one line, and the alternative
 * (three relative paths that shift whenever a file moves) is churn with no
 * benefit.
 */
export * from './organization.factory';
export * from './user.factory';
export * from './department.factory';
export * from './role.factory';
export * from './session.factory';
export * from './security.factory';
export * from './invitation.factory';
export * from './tenant.factory';
