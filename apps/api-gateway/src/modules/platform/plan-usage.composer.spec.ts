import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrichWithUsage } from './plan-usage.composer';
import type { ApplyPlanResponseDto } from './dto/rest/platform-response.dto';

/**
 * The composer reads NUMBERS, and this file is what keeps it that way.
 *
 * It used to parse a display string: `afterValue` took the `after` half of
 * `"before -> after"` and returned `null` when the parse failed — which the
 * caller reads as "this column is not changing", which means "no check". A
 * purely cosmetic edit in `plan-admin.service.ts` (the separator) silently
 * dropped storage and document overruns from a Super Admin dry run with every
 * suite green: measured, by changing `" -> "` to `" → "` and watching all
 * eleven `platform-plans` e2e tests pass while the projection under-reported.
 *
 * `ApplyPlanResponse` now carries `after`, a numeric map, so there is no
 * separator left to reformat (known-gaps #21). Two tests hold the ground that
 * gained:
 *
 *   - **Test 2** proves the parser is gone, by feeding a `changes` string that
 *     no parser could survive alongside a correct `after`. It is written
 *     against `maxStorageBytes` deliberately — see the test.
 *   - **Test 6** asserts the PRODUCER still emits the numbers, against its own
 *     source rather than a copy of it, because a copy drifts in exactly the way
 *     the separator did.
 */
describe('enrichWithUsage', () => {
  const REPO = join(__dirname, '../../../../..');

  /**
   * `after` is the argument because `after` is what the composer reads.
   *
   * `changes` is a display string the composer no longer touches, so it
   * defaults to something obviously unparseable — every test that does not name
   * it is therefore also asserting the parser is dead.
   */
  const projection = (
    after: Record<string, number>,
    {
      changes = { UNREAD: 'this is not parsed' },
      skippedPinned = false,
    }: { changes?: Record<string, string>; skippedPinned?: boolean } = {},
  ): ApplyPlanResponseDto => ({
    subscribers: [
      {
        organizationId: 'org-1',
        organizationName: 'Acme',
        changes,
        after,
        overLimit: [],
        skippedPinned,
        budgetDeferred: false,
      },
    ],
    dryRun: true,
    changedCount: 1,
    skippedPinnedCount: 0,
    overLimitCount: 0,
    evaluatedDimensions: ['seats'],
  });

  const usage = {
    value: new Map([
      [
        'org-1',
        { usedBytes: 8_000, documentCount: 40, organizationId: 'org-1' },
      ],
    ]),
  } as never;

  it('1. Folds an over-storage subscriber in, reading the AFTER value', () => {
    const result = enrichWithUsage(
      projection({ maxStorageBytes: 5_000 }),
      usage,
    );

    expect(result.subscribers[0].overLimit).toEqual([
      'maxStorageBytes: 8000 used, plan grants 5000',
    ]);
    expect(result.overLimitCount).toBe(1);
    expect(result.evaluatedDimensions).toEqual(
      expect.arrayContaining(['seats', 'storage', 'documents']),
    );
  });

  it('2. **Reads `after`, never `changes`**', () => {
    // The sabotage that proves the parser is dead: `changes` says the storage
    // limit is RISING to a number no tenant could exceed, and is not even
    // shaped like something a split could survive. `after` says it is falling
    // to 5000. The fold must follow `after`.
    //
    // **Written against `maxStorageBytes` by name, and that is the point.**
    // Storage is a Prisma `BigInt` in auth-service, so it is the column a
    // `typeof next === 'number'` guard in the producer would silently drop —
    // leaving the key absent, which this composer reads as "not changing",
    // which means no check. `maxDocumentUploads` is a plain `Int` and would
    // pass this test with that bug present.
    const result = enrichWithUsage(
      projection(
        { maxStorageBytes: 5_000 },
        { changes: { maxStorageBytes: '10000 => 999999999' } },
      ),
      usage,
    );

    expect(result.subscribers[0].overLimit).toEqual([
      'maxStorageBytes: 8000 used, plan grants 5000',
    ]);
    expect(result.overLimitCount).toBe(1);
  });

  it('3. An unchanged column is NOT a limit of zero', () => {
    // `null` and not zero: a column this apply does not move is a different
    // statement from a limit of zero, and zero would put every tenant over.
    // The key is ABSENT from `after`, which is the only way this apply says
    // "I do not move that limit".
    const result = enrichWithUsage(projection({ maxAgentSeats: 9 }), usage);

    expect(result.subscribers[0].after).not.toHaveProperty('maxStorageBytes');
    expect(result.subscribers[0].overLimit).toEqual([]);
    expect(result.overLimitCount).toBe(0);
  });

  it('4. A failed leg SUBTRACTS rather than lies', () => {
    // The report's policy, and the opposite of the plan-change block's. A dry
    // run read during an outage says which limits went unchecked instead of
    // reporting nobody affected for two of three.
    const result = enrichWithUsage(projection({ maxStorageBytes: 5_000 }), {
      failure: 'ingestion is down',
    });

    expect(result.subscribers[0].overLimit).toEqual([]);
    expect(result.evaluatedDimensions).toEqual(['seats']);
  });

  it('5. A pinned subscriber is left alone', () => {
    const result = enrichWithUsage(
      projection({ maxStorageBytes: 5_000 }, { skippedPinned: true }),
      usage,
    );

    expect(result.subscribers[0].overLimit).toEqual([]);
  });

  it('6. **The producer writes `after` for BIGINT grants too**', () => {
    // The coupling this file has always existed for, moved to the thing that
    // now carries it. Asserted against the producer's own source rather than a
    // copy, because a copy drifts in exactly the way the separator did.
    const producer = readFileSync(
      join(REPO, 'apps/auth-service/src/modules/billing/plan-admin.service.ts'),
      'utf8',
    );

    // Vacuity guard: the file resolved and still builds the map this reads.
    expect(producer).toContain('const after: Record<string, number> = {}');

    // **The guard, character for character.** Four of the seven grants are
    // Prisma `BigInt` — storage among them — so narrowing this to
    // `typeof next === 'number'` would drop `maxStorageBytes` from `after`, and
    // an absent key reads here as "not changing", which means no check. That is
    // the ORIGINAL defect arriving through its own fix, and it would be
    // invisible: every other test in this file would stay green.
    expect(producer).toContain(
      "typeof next === 'number' || typeof next === 'bigint'",
    );
    expect(producer).toContain('after[field] = Number(next)');
  });
});
