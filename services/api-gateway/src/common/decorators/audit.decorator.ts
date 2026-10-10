import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

/**
 * Marks a route for audit logging
 * @example
 * `@Patch(':id')`
 * `@Audit('update_user')`
 */
export const Audit = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
