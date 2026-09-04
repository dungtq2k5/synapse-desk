import { ConfigService } from '@nestjs/config';
import {
  dropIndexes,
  missingIndexes,
} from '@synapsedesk/common/testing/schema-objects';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';

/**
 * `SEED_ON_BOOTSTRAP` skips rows and does NOT skip schema.
 *
 * **auth is the only service where the flag still exists, so it is the only
 * one that can assert what it now means.** ticket-service's copy of this spec
 * proves the flag's DELETION held; this one proves the SPLIT held, which is the
 * harder half — and the half every existing check was blind to. Measured before
 * this spec existed: moving `applySchemaObjects()` back inside the branch left
 * the static contract spec green (5/5), ticket's behavioural spec green, and
 * auth's own 471-test suite green, because `.env.test` sets the flag false AND
 * the fixture calls `seed()` directly, so the hook is a no-op in the test
 * environment either way.
 *
 * **The two halves are asserted asymmetrically, on purpose.** The DDL half is
 * dropped for real, because a behavioural assertion is the whole point and
 * `applySchemaObjects()` is idempotent, so the test restores what it broke by
 * running the thing under test. The row half is a SPY: deleting seeded rows
 * would invalidate `RolesService`'s process-lifetime memo of the global role
 * ids — which is exactly why `bootstrap.ts`'s `reset()` preserves them — and
 * the next registration in a SIBLING suite would fail with "Expected 1 records
 * to be connected, found only 0" from inside `tx.user.create`. An index and a
 * seeded row are not symmetric: the drop is reversible by the DDL this test is
 * about to run, the delete invalidates in-process state nothing restores.
 * Nothing here needs the rows gone — only the branch named.
 */
describe('Schema objects are not seeding (e2e)', () => {
  /**
   * Two of auth's nine DDL objects, by name.
   *
   * `users_org_email_key` is the partial index ADR 0020 is about — the one the
   * service-layer duplicate check explicitly *"does not replace"* — so its
   * absence is the concrete cost of the defect this spec guards.
   */
  const INDEXES = ['users_org_email_key', 'users_super_admin_email_key'];

  let fx: E2eFixture;
  let seeder: DatabaseSeeder;

  /**
   * Forces the flag AT ITS SOURCE.
   *
   * **`process.env.SEED_ON_BOOTSTRAP = 'false'` does not work here**, and it
   * fails in the direction that looks like success: `ConfigService` validates
   * and caches the environment at module init, so a later mutation changes
   * nothing it returns. `.env.test` already sets the flag false, so the
   * skip-rows test would have passed without ever controlling the branch, and
   * the flag-true test failed outright — which is how this was found.
   */
  const forceFlag = (value: boolean) => {
    const config = fx.moduleRef.get(ConfigService);
    const real = config.getOrThrow.bind(config);

    jest
      .spyOn(config, 'getOrThrow')
      .mockImplementation(((key: string) =>
        key === 'SEED_ON_BOOTSTRAP' ? value : real(key)) as never);
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    seeder = fx.moduleRef.get(DatabaseSeeder);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    // Restore through the method under test, exactly as ticket's copy does:
    // this suite drops real indexes on a database sibling suites use, and a
    // suite inheriting a table without its unique index fails somewhere that
    // says nothing about why.
    await seeder.applySchemaObjects();
    await fx.close();
  });

  it('**with the flag false, the DDL still runs and the rows do not**', async () => {
    const seedRows = jest.spyOn(seeder, 'seedRows');
    forceFlag(false);

    await dropIndexes(fx.prisma, INDEXES);
    // The control: without it the assertion below would be measured against a
    // database that never lost anything.
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual(INDEXES);

    await seeder.onApplicationBootstrap();

    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([]);
    expect(seedRows).not.toHaveBeenCalled();
  });

  it('with the flag true, both halves run', async () => {
    // The other side of the branch, so "the DDL always runs" is not satisfied
    // by a hook that ignores the flag entirely — which would pass the test
    // above and silently re-merge the two jobs.
    const seedRows = jest.spyOn(seeder, 'seedRows').mockResolvedValue();
    forceFlag(true);

    await dropIndexes(fx.prisma, INDEXES);
    await seeder.onApplicationBootstrap();

    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([]);
    expect(seedRows).toHaveBeenCalledTimes(1);
  });
});
