import { randomUUID } from 'node:crypto';
import { systemContext } from '@synapsedesk/contracts';
import { E2eFixture, bootstrapE2eTest } from '../utils/bootstrap';

/**
 * **The tenant-scoped client against real Postgres**: what the unit rows on
 * `scopedArgs` can't show, that Prisma runs the rewritten queries as meant.
 * A unique lookup with the tenant beside its id, a child table filtered
 * through its parent, a create naming another tenant, and a transaction
 * opened on the scoped client.
 */
describe('The tenant-scoped client (e2e)', () => {
  let fx: E2eFixture;
  const A = randomUUID();
  const B = randomUUID();

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  afterAll(async () => fx.close());

  beforeEach(async () => fx.reset());

  const notificationOf = (organizationId: string) =>
    fx.prisma.notification.create({
      data: {
        organizationId,
        recipientId: randomUUID(),
        type: 'TICKET_ASSIGNED',
        title: 'Assigned',
      },
    });

  it('**findUnique by id** finds the tenant’s row and not another tenant’s', async () => {
    const own = await notificationOf(A);
    const theirs = await notificationOf(B);
    const db = fx.prisma.scoped(systemContext(A));

    await expect(
      db.notification.findUnique({ where: { id: own.id } }),
    ).resolves.toMatchObject({ id: own.id });
    await expect(
      db.notification.findUnique({ where: { id: theirs.id } }),
    ).resolves.toBeNull();
  });

  it('**update by id** on another tenant’s row is a miss, and the row is unchanged', async () => {
    const theirs = await notificationOf(B);

    await expect(
      fx.prisma.scoped(systemContext(A)).notification.update({
        where: { id: theirs.id },
        data: { title: 'A was here' },
      }),
    ).rejects.toMatchObject({ code: 'P2025' });
    await expect(
      fx.prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } }),
    ).resolves.toMatchObject({ title: 'Assigned' });
  });

  it('**a child table** (deliveries) is filtered through its notification’s tenant', async () => {
    const theirs = await notificationOf(B);
    await fx.prisma.notificationDelivery.create({
      data: { notificationId: theirs.id, channel: 'EMAIL', status: 'SENT' },
    });

    await expect(
      fx.prisma.scoped(systemContext(A)).notificationDelivery.count(),
    ).resolves.toBe(0);
    await expect(
      fx.prisma.scoped(systemContext(B)).notificationDelivery.count(),
    ).resolves.toBe(1);
  });

  it('**a create naming another tenant** is refused, and nothing is written', async () => {
    await expect(
      fx.prisma.scoped(systemContext(A)).notification.create({
        data: {
          organizationId: B,
          recipientId: randomUUID(),
          type: 'TICKET_ASSIGNED',
          title: 'Assigned',
        },
      }),
    ).rejects.toThrow(`names tenant "${B}"`);
    await expect(fx.prisma.notification.count()).resolves.toBe(0);
  });

  it('**a transaction opened on the scoped client** is scoped inside', async () => {
    await notificationOf(A);
    await notificationOf(B);

    const seen = await fx.prisma
      .scoped(systemContext(A))
      .$transaction(async (tx) => tx.notification.findMany());

    expect(seen.map((row) => row.organizationId)).toEqual([A]);
  });
});
