import {
  dropIndexes,
  missingIndexes,
} from '@synapsedesk/common/testing/schema-objects';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';

/**
 * The boot hook checks the schema and no longer creates it.
 *
 * **This spec used to assert the opposite of test 1, and keeping it is the
 * point.** `SEED_ON_BOOTSTRAP=false` once returned before the DDL block,
 * silently removing the partial indexes and CHECK constraints Prisma cannot
 * express — while the catch four lines below said serving without them was
 * worse than not serving. This service has no seed rows, so ADR 0042 removed
 * the flag outright and this test said the removal held.
 *
 * ADR 0043 then moved the DDL itself to the deploy step, so the hook creates
 * nothing. **The invariant did not go with it, it moved one step earlier**: the
 * hook must now REFUSE a database the migration never reached, which is the
 * same "a schema step skipped with nothing noticing" failure arriving through a
 * relocation instead of through a flag.
 *
 * **The hook is called directly, not awaited after a boot.** Every service's
 * `.env.test` turns the flag off *because* "a bare TestingModule does not
 * reliably fire Nest lifecycle hooks" — so a test that boots a module and
 * waits for `onApplicationBootstrap` would be asserting on the one thing that
 * environment documents as unreliable, and would be red, green or flaky for
 * reasons unrelated to the branch under test.
 */
describe('Schema objects are not seeding (e2e)', () => {
  /**
   * A sample of this service's DDL block, by name.
   *
   * Named rather than counted: the assertion is "these specific invariants are
   * enforceable", and `ticket_assignments_current_key` is the one whose
   * absence the seeder's own catch describes — two concurrent reassigns both
   * succeeding, with no way to tell which assignee is real.
   */
  const INDEXES = [
    'ticket_assignments_current_key',
    'ticket_messages_client_key',
  ] as const;

  let fx: E2eFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  afterAll(async () => {
    // Restore before anything else runs: this suite drops real indexes, and a
    // sibling suite inheriting a database without them would fail somewhere
    // that says nothing about why.
    await fx.moduleRef.get(DatabaseSeeder).applySchemaObjects();
    await fx.close();
  });

  it('**1. the hook does NOT apply the DDL — the relocation, behaviourally**', async () => {
    const seeder = fx.moduleRef.get(DatabaseSeeder);

    await dropIndexes(fx.prisma, INDEXES);
    // The control: the drop must actually have removed them, or the assertion
    // below passes against a database that never lost anything.
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([
      ...INDEXES,
    ]);

    await seeder.onApplicationBootstrap();

    // Still missing. `src/schema-apply.ts` owns these now — the init container
    // in a cluster, `npm run db:push` on a developer's machine.
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([
      ...INDEXES,
    ]);

    // And the step that DOES own them puts them back.
    await seeder.applySchemaObjects();
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([]);
  });

  it('**2. the hook REFUSES a database the migration never reached**', async () => {
    // With the DDL gone from the boot path, `assertSchemaExists()` is the only
    // thing between a pod whose init container did not run — or a service
    // started outside Kubernetes entirely — and serving against an empty
    // database.
    //
    // A RENAME rather than a drop: reversible in a `finally`, touches no rows,
    // and makes the table invisible to the `information_schema` query the
    // assertion actually runs.
    const seeder = fx.moduleRef.get(DatabaseSeeder);

    try {
      await fx.prisma.$executeRawUnsafe(
        'ALTER TABLE ticket_messages RENAME TO ticket_messages_hidden_by_test',
      );

      await expect(seeder.onApplicationBootstrap()).rejects.toThrow(
        /missing 1 expected table\(s\): ticket_messages/,
      );
    } finally {
      await fx.prisma.$executeRawUnsafe(
        'ALTER TABLE ticket_messages_hidden_by_test RENAME TO ticket_messages',
      );
    }

    // The control: with the table back the same call succeeds, so test 2 failed
    // on the missing table rather than on something the rename disturbed.
    await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
