import type { JwtPayload, OrgRoom } from '@synapsedesk/contracts';

/**
 * Whether this caller works the queue: a holder of `ticket.read.all` or
 * `ticket.message.moderate`, as ticket-service decides who sees internal notes.
 * Read from the verified token, so a revoked permission lands on the next
 * connection or join.
 *
 * Never a Super Admin: they reach a tenant's data only through the platform
 * API, so they join neither the agents' room nor a ticket's internal room.
 */
export function isAgent(user: JwtPayload): boolean {
  return (
    !user.isSuperAdmin &&
    (user.permissionCodes.includes('ticket.read.all') ||
      user.permissionCodes.includes('ticket.message.moderate'))
  );
}

/**
 * The tenant's agents ({@link isAgent}), for ticket events an end user must
 * not see: `org:{id}` is joined by every member. Server-side only: no client
 * names it, so it isn't in the contracts.
 */
export const orgAgentsRoom = (organizationId: string): OrgRoom =>
  `org:${organizationId}:agents`;
