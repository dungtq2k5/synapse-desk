import { E2eFixture, bootstrapE2eTest } from '../utils';
import { buildTenant, createDocument } from '../factories';
import { PlatformUsageService } from '../../src/modules/platform/platform.service';

/**
 * The cross-tenant usage read, and the one property that decides whether it was
 * worth building: **a tenant with no documents is a ZERO, not a gap.**
 *
 * A sparse response leaves the caller to decide what a missing id means, and
 * the two available readings — "under the limit" and "not checked" — are the
 * pair every limit projection in this system is built to keep apart. Getting it
 * wrong here reproduces the silent zero one layer down, where nothing is
 * watching.
 */
describe('Platform usage (e2e)', () => {
  let fx: E2eFixture;
  let usage: PlatformUsageService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    usage = fx.moduleRef.get(PlatformUsageService);
  });

  beforeEach(() => fx.reset());
  afterAll(() => fx.close());

  it('1. **A row per REQUESTED id, zero-filled — never a row per id that has documents**', async () => {
    const busy = buildTenant();
    const quiet = buildTenant();

    await createDocument(fx.prisma, busy, { fileSizeBytes: 900n });
    await createDocument(fx.prisma, busy, { fileSizeBytes: 100n });

    const response = await usage.getPlatformUsage({
      organizationIds: [busy.organizationId, quiet.organizationId],
    });

    expect(response.usage).toHaveLength(2);

    const byId = new Map(
      response.usage.map((row) => [row.organizationId, row]),
    );
    expect(byId.get(busy.organizationId)).toMatchObject({
      usedBytes: 1000,
      documentCount: 2,
    });
    // **The whole test.** `groupBy` returns nothing for this tenant, so an
    // unfilled response would omit it — and a caller reading absence as "under
    // the limit" is the silent zero all over again.
    expect(byId.get(quiet.organizationId)).toMatchObject({
      usedBytes: 0,
      documentCount: 0,
    });
  });

  it('1b. A SOFT-DELETED document frees its slot and its bytes', async () => {
    // The count limit is about what a tenant HOLDS, and the storage quota
    // beside it already makes the same choice. A count that included deleted
    // rows would make a tenant who tidied up still be refused.
    const tenant = buildTenant();
    await createDocument(fx.prisma, tenant, { fileSizeBytes: 500n });
    await createDocument(fx.prisma, tenant, {
      fileSizeBytes: 500n,
      deletedAt: new Date(),
    });

    const [row] = (
      await usage.getPlatformUsage({
        organizationIds: [tenant.organizationId],
      })
    ).usage;

    expect(row).toMatchObject({ usedBytes: 500, documentCount: 1 });
  });

  it('2. **ONE query answers N tenants** — the batching that justifies the surface', async () => {
    // The reason this is not `GetStorageUsage` in a loop: the projection asks
    // about every subscriber of a plan at once, from a caller with no tenant.
    // Counted at the Prisma client, because "one call" is a property of the
    // database traffic rather than of the method signature.
    const tenants = [buildTenant(), buildTenant(), buildTenant()];
    for (const tenant of tenants) {
      await createDocument(fx.prisma, tenant);
    }

    const groupBy = jest.spyOn(fx.prisma.document, 'groupBy');

    const response = await usage.getPlatformUsage({
      organizationIds: tenants.map((tenant) => tenant.organizationId),
    });

    expect(response.usage).toHaveLength(3);
    expect(groupBy).toHaveBeenCalledTimes(1);

    groupBy.mockRestore();
  });

  it('2b. An EMPTY id list asks the database nothing', async () => {
    // `IN ()` is not a query worth sending, and a plan with no subscribers is
    // the ordinary case for a catalogue row somebody just created.
    const groupBy = jest.spyOn(fx.prisma.document, 'groupBy');

    await expect(
      usage.getPlatformUsage({ organizationIds: [] }),
    ).resolves.toEqual({ usage: [] });
    expect(groupBy).not.toHaveBeenCalled();

    groupBy.mockRestore();
  });

  it('2c. A REPEATED id yields one row, not two', async () => {
    // The response is keyed by id downstream, so a duplicate would build a Map
    // that silently dropped one — or a count rendered twice.
    const tenant = buildTenant();
    await createDocument(fx.prisma, tenant);

    const response = await usage.getPlatformUsage({
      organizationIds: [tenant.organizationId, tenant.organizationId],
    });

    expect(response.usage).toHaveLength(1);
  });
});
