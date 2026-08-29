import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrichWithUsage } from './plan-usage.composer';
import type { ApplyPlanResponseDto } from './dto/rest/platform-response.dto';

/**
 * The composer parses a DISPLAY STRING, and nothing else guarded that.
 *
 * `afterValue` reads the `after` half of `"before -> after"` out of the
 * projection DTO and returns `null` when the parse fails — which the caller
 * reads as "this column is not changing", which means "no check". So a purely
 * cosmetic edit in `plan-admin.service.ts` (the separator) silently drops
 * storage and document overruns from a Super Admin dry run, and every suite
 * stays green: measured, by changing `" -> "` to `" → "` and watching all
 * eleven `platform-plans` e2e tests pass while the projection under-reported.
 *
 * This is the same fail-open the plan-change BLOCK refuses to inherit — the
 * block takes its grants as numbers off `subscription_plans` — but the report
 * still has to be right, and until now the separator was a contract between two
 * services with nothing asserting it.
 */
describe('enrichWithUsage', () => {
  const REPO = join(__dirname, '../../../../..');

  const projection = (
    changes: Record<string, string>,
    skippedPinned = false,
  ): ApplyPlanResponseDto => ({
    subscribers: [
      {
        organizationId: 'org-1',
        organizationName: 'Acme',
        changes,
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
      projection({ maxStorageBytes: '10000 -> 5000' }),
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

  it('2. **The separator it parses is the one the producer writes**', () => {
    // The coupling this file exists for. Asserted against the producer's own
    // source rather than against a copy of the string, because a copy drifts in
    // exactly the way the original did.
    const producer = readFileSync(
      join(REPO, 'apps/auth-service/src/modules/billing/plan-admin.service.ts'),
      'utf8',
    );

    // Vacuity guard: the file resolved and still builds the map this parses.
    expect(producer).toContain('const changes: Record<string, string> = {}');
    expect(producer).toContain('${String(before)} -> ${String(after)}');
  });

  it('3. An unchanged column is NOT a limit of zero', () => {
    // `null` and not zero: a column this apply does not move is a different
    // statement from a limit of zero, and zero would put every tenant over.
    const result = enrichWithUsage(
      projection({ maxAgentSeats: '10 -> 9' }),
      usage,
    );

    expect(result.subscribers[0].overLimit).toEqual([]);
    expect(result.overLimitCount).toBe(0);
  });

  it('4. A failed leg SUBTRACTS rather than lies', () => {
    // The report's policy, and the opposite of the plan-change block's. A dry
    // run read during an outage says which limits went unchecked instead of
    // reporting nobody affected for two of three.
    const result = enrichWithUsage(
      projection({ maxStorageBytes: '10000 -> 5000' }),
      { failure: 'ingestion is down' },
    );

    expect(result.subscribers[0].overLimit).toEqual([]);
    expect(result.evaluatedDimensions).toEqual(['seats']);
  });

  it('5. A pinned subscriber is left alone', () => {
    const result = enrichWithUsage(
      projection({ maxStorageBytes: '10000 -> 5000' }, true),
      usage,
    );

    expect(result.subscribers[0].overLimit).toEqual([]);
  });
});
