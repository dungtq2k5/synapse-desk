import { PLAN_LIMIT_DIMENSIONS, exceedsLimit } from '@synapsedesk/common';
import type { ApplyPlanResponseDto } from './dto/rest/platform-response.dto';
import type { UsageLeg } from './platform-usage.client';

/**
 * The dimensions ingestion answers. Everything else in
 * `PLAN_LIMIT_DIMENSIONS` is auth's, and auth already reported its own.
 */
const INGESTION_DIMENSIONS = ['storage', 'documents'] as const;

/**
 * Folds ingestion's usage into the projection auth computed.
 *
 * **The coverage list is UNIONED, never overwritten.** Auth reports what auth
 * evaluated; this adds what ingestion evaluated. Two honest sources, so the
 * auth-level suite keeps testing auth's own claim and neither layer has to know
 * the other's answer to state its own.
 *
 * **A failed leg subtracts rather than lies.** When ingestion does not respond
 * the dimensions it owns simply do not appear, so a dry run read during an
 * outage says which limits went unchecked instead of reporting nobody affected
 * for two of three. That is what `evaluated_dimensions` was for, and it only
 * becomes true once something can actually fail — a static list could never
 * express it.
 *
 * @param projection what `auth-service` computed, already in REST shape.
 * @param usage ingestion's leg: a map keyed by organization id, or a failure.
 * @returns the projection with storage and document overruns folded in.
 */
export function enrichWithUsage(
  projection: ApplyPlanResponseDto,
  usage: UsageLeg,
): ApplyPlanResponseDto {
  if ('failure' in usage) return projection;

  const subscribers = projection.subscribers.map((row) => {
    // A pinned tenant is not being changed at all, so there is nothing to be
    // over: reporting an overrun for one would send an operator looking at a
    // limit this apply is not touching.
    if (row.skippedPinned) return row;

    const used = usage.value.get(row.organizationId);
    if (!used) return row;

    const overLimit = [...row.overLimit];

    // The grants come off the projection's own `after` map, which carries the
    // target value of every NUMERIC column this apply would write. Reading the
    // after value is what makes this a projection of the new plan rather than a
    // report on the current one.
    const storageLimit = afterValue(row.after, 'maxStorageBytes');
    if (storageLimit !== null && exceedsLimit(used.usedBytes, storageLimit)) {
      overLimit.push(
        `maxStorageBytes: ${used.usedBytes} used, plan grants ${storageLimit}`,
      );
    }

    const documentLimit = afterValue(row.after, 'maxDocumentUploads');
    if (
      documentLimit !== null &&
      exceedsLimit(used.documentCount, documentLimit)
    ) {
      overLimit.push(
        `maxDocumentUploads: ${used.documentCount} held, plan grants ${documentLimit}`,
      );
    }

    return { ...row, overLimit };
  });

  return {
    ...projection,
    subscribers,
    overLimitCount: subscribers.filter((row) => row.overLimit.length > 0)
      .length,
    evaluatedDimensions: [
      ...new Set([
        ...projection.evaluatedDimensions,
        ...INGESTION_DIMENSIONS.filter((dimension) =>
          PLAN_LIMIT_DIMENSIONS.includes(dimension),
        ),
      ]),
    ],
  };
}

/**
 * The target grant for one column, or `null` when the column is not changing.
 *
 * **A map read, not a parse.** This used to take the `"before -> after"` string
 * out of `changes` and split it on `->`. The separator was a contract between
 * two services that nothing typed: changing `" -> "` to `" → "` in
 * `plan-admin.service.ts` dropped storage and document overruns from every dry
 * run while all eleven `platform-plans` e2e tests stayed green (known-gaps #21).
 * `ApplyPlanResponse` now carries the numbers, so there is nothing left to
 * reformat.
 *
 * `null` and not zero: a column absent from `after` means this apply does not
 * move that limit, which is a different statement from a limit of zero — and
 * zero would put every tenant over.
 */
function afterValue(
  after: Record<string, number>,
  field: string,
): number | null {
  const value = after[field];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
