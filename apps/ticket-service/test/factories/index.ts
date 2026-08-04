/**
 * One import site for every factory — the same barrel auth-service's test
 * suites use, for the same reason: a test that needs a tenant, a ticket and a
 * message should say so in one line.
 */
export * from './ticket.factory';
export * from './assignment.factory';
export * from './message.factory';
export * from './ai.factory';
export * from './audit.factory';
