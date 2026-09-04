import {
  dropIndexes,
  missingIndexes,
} from '@synapsedesk/common/testing/schema-objects';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';

/**
 * The schema objects survive a boot that skips seeding.
 *
 * **This is the check the gate needed and never had.** `SEED_ON_BOOTSTRAP=false`
 * used to return before the DDL block, silently removing the partial indexes
 * and CHECK constraints Prisma cannot express and nothing else creates — while
 * the catch four lines below it said serving without them was worse than not
 * serving. In this service the flag guarded nothing else at all: there are no
 * seed rows, so it has been removed outright, and this test is what says the
 * removal held.
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

  it('**the boot hook applies them with SEED_ON_BOOTSTRAP unset**', async () => {
    const seeder = fx.moduleRef.get(DatabaseSeeder);

    await dropIndexes(fx.prisma, INDEXES);
    // The control: the drop must actually have removed them, or the assertion
    // below passes against a database that never lost anything.
    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([
      ...INDEXES,
    ]);

    // No `SEED_ON_BOOTSTRAP` in this service's schema at all any more — the
    // hook has no branch left to take.
    await seeder.onApplicationBootstrap();

    await expect(missingIndexes(fx.prisma, INDEXES)).resolves.toEqual([]);
  });
});
