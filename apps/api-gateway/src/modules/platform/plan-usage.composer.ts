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

    // The grants come off the projection's own `changes` map, which carries
    // "before -> after" for every column this apply would write. Reading the
    // AFTER value is what makes this a projection of the new plan rather than a
    // report on the current one.
    const storageLimit = afterValue(row.changes.maxStorageBytes);
    if (storageLimit !== null && exceedsLimit(used.usedBytes, storageLimit)) {
      overLimit.push(
        `maxStorageBytes: ${used.usedBytes} used, plan grants ${storageLimit}`,
      );
    }

    const documentLimit = afterValue(row.changes.maxDocumentUploads);
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
 * The `after` half of a `"before -> after"` change entry, or `null` when the
 * column is not changing.
 *
 * `null` and not zero: an unchanged column means this apply does not move that
 * limit, which is a different statement from a limit of zero — and zero would
 * put every tenant over.
 */
function afterValue(change: string | undefined): number | null {
  if (!change) return null;

  const after = Number(change.split('->').at(-1)?.trim());

  return Number.isFinite(after) ? after : null;
}
