/**
 * @file **A stored value outside its enum fails loudly, at both ends.**
 *
 * Enumerated columns are strings, validated on every write (development
 * conventions §7.3). A value that slips past (a raw SQL write, a migration)
 * reaches the service's `toProto`, which throws naming the value and the set it
 * isn't in; Nest logs that, and the gateway answers the failure rather than a
 * ticket with no status.
 *
 * This writes the one row an API never would, then puts it back.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Session, expectOk } from './client';
import { ticketDb } from './db';
import { DEMO_PASSWORD, manifest, seededActors } from './seeded-actor';

describe('A stored enum value outside its set', () => {
  it('**the service logs the value, and the gateway answers its error**', async () => {
    const { admin } = await seededActors();
    const session = new Session();
    expectOk(
      await session.post('/auth/login', {
        email: admin.email,
        password: DEMO_PASSWORD,
      }),
      `login as the seeded admin ${admin.email}`,
    );

    const db = ticketDb();
    const [tenant] = manifest().tenants;
    const ticket = await db.ticket.findFirstOrThrow({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, status: true },
    });
    const logFile = join(process.env.SYSTEM_LOG_DIR!, 'ticket-service.log');

    try {
      await db.ticket.update({
        where: { id: ticket.id },
        data: { status: 'ARCHIVED' },
      });

      const response = await session.get(`/tickets/${ticket.id}`);

      expect(response.status).toBe(500);
      expect(readFileSync(logFile, 'utf8')).toContain(
        '"ARCHIVED" is not one of',
      );
    } finally {
      await db.ticket.update({
        where: { id: ticket.id },
        data: { status: ticket.status },
      });
      await db.$disconnect();
    }
  });
});
