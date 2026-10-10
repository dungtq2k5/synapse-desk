import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { isUniqueConstraintViolation } from '@synapsedesk/common';

/**
 * The partial unique index enforcing "at most one live ingestion job per
 * document". Lives in `database.seeder.ts` — conventions §7.
 */
export const ONE_LIVE_JOB_INDEX = 'ingestion_jobs_one_live_per_document';

/**
 * Maps the index's `P2002` to a `FAILED_PRECONDITION` `RpcException`.
 *
 * Wrap any transaction that inserts an `ingestion_jobs` row. Returns the error
 * to throw — anything that is not this index comes back untouched, so a single
 * `throw` covers both.
 *
 * @param error whatever the transaction rejected with
 * @returns an `RpcException` for the index's violation, or `error` unchanged
 *
 * @example
 * try {
 *   return await this.prisma.$transaction(async (tx) => { … });
 * } catch (error) {
 *   throw asConcurrentIngestion(error);
 * }
 */
export function asConcurrentIngestion(error: unknown): unknown {
  if (isUniqueConstraintViolation(error, ONE_LIVE_JOB_INDEX)) {
    // Not ALREADY_EXISTS: nothing the caller sent is a duplicate, and the same
    // request succeeds once the run in flight finishes.
    return new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'This document is already being processed',
    });
  }

  return error;
}
