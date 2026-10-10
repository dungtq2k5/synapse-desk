import { ConfigService } from '@nestjs/config';
import {
  dropIndexes,
  missingIndexes,
} from '@synapsedesk/common/testing/schema-objects';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';

/**
 * What the boot hook owes after ADR 0043 moved the DDL out of it.
 *
 * **This spec used to assert the opposite of test 1, and that is the point of
 * keeping it.** ADR 0042 split `applySchemaObjects()` out of the seeding gate
 * and this suite proved the hook applied the DDL regardless of
 * `SEED_ON_BOOTSTRAP`. ADR 0043 then moved the DDL to the deploy step, so the
 * hook applies nothing — and the invariant ADR 0042 was protecting did not go
 * away with it, it moved one step earlier. The hook must now REFUSE a database
 * the migration never reached (test 3), which is the same "a schema step that
 * could be skipped without anything noticing" failure, arriving through the
 * relocation instead of through a flag.
 *
 * **auth is the only service where the flag still exists**, so it is the only
 * one that can assert what it means. ticket-service's copy proves the flag's
 * DELETION held.
 *
 * **The three assertions are deliberately asymmetric.** Indexes are dropped for
 * REAL, because `applySchemaObjects()` is idempotent and restores what the test
 * broke by running the thing under test. A missing TABLE is a rename, reversed
 * in a `finally`, for the same reason. The row half is a SPY: deleting seeded
 * rows would invalidate `RolesService`'s process-lifetime memo of the global
 * role ids — which is exactly why `bootstrap.ts`'s `reset()` preserves them —
 * and the next registration in a SIBLING suite would fail with "Expected 1
 * records to be connected, found only 0" from inside `tx.user.create`. The drop
 * and the rename are reversible; the delete invalidates in-process state
 * nothing restores.
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

  it('**1. the hook does NOT apply the DDL — the relocation, behaviourally**', async () => {
    // The inverse of what this test asserted before ADR 0043, and the only
    // direct proof that the move happened. A hook that still applied would
    // leave `missingIndexes` empty here and nothing else in the tree would
    // notice: the static check accepts either method name, and every fixture
    // calls `seed()` by hand.
    forceFlag(false);

    await dropIndexes(fx.prisma, INDEXES);
    // The control: without it the assertion below is measured against a
    // database that never lost anything.
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual(INDEXES);

    await seeder.onApplicationBootstrap();

    // Still missing. The deploy step owns these now.
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual(INDEXES);

    // And the step that DOES own them puts them back — which is what
    // `src/schema-apply.ts` calls in the init container and what `db:push`
    // chains in development.
    await seeder.applySchemaObjects();
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([]);
  });

  it('2. the flag still gates ROWS, in both directions', async () => {
    const skipped = jest.spyOn(seeder, 'seedRows');
    forceFlag(false);
    await seeder.onApplicationBootstrap();
    expect(skipped).not.toHaveBeenCalled();

    jest.restoreAllMocks();

    // The other side, so "rows are gated" is not satisfied by a hook that
    // never seeds at all.
    const seeded = jest.spyOn(seeder, 'seedRows').mockResolvedValue();
    forceFlag(true);
    await seeder.onApplicationBootstrap();
    expect(seeded).toHaveBeenCalledTimes(1);
  });

  it('**3. the hook REFUSES a database the migration never reached**', async () => {
    // ADR 0042's invariant, one step earlier. With the DDL gone from the boot
    // path, `assertSchemaExists()` is the ONLY thing standing between a pod
    // whose init container did not run — or a service started outside
    // Kubernetes entirely — and serving 500s against an empty database.
    //
    // A RENAME rather than a drop: it is reversible in a `finally`, it does not
    // touch a single row, and it makes the table invisible to the
    // `information_schema` query the assertion actually runs. `permissions` is
    // one of the four auth counts and the one no sibling suite writes to
    // mid-run.
    forceFlag(false);

    try {
      await fx.prisma.$executeRawUnsafe(
        'ALTER TABLE permissions RENAME TO permissions_hidden_by_test',
      );

      await expect(seeder.onApplicationBootstrap()).rejects.toThrow(
        /missing 1 expected table\(s\): permissions/,
      );
    } finally {
      await fx.prisma.$executeRawUnsafe(
        'ALTER TABLE permissions_hidden_by_test RENAME TO permissions',
      );
    }

    // The control: with the table back, the same call succeeds — so test 3
    // failed on the missing table and not on something the rename disturbed.
    await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
