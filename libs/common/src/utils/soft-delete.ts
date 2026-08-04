import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { isUniqueConstraintViolation } from './prisma-errors';

/**
 * The write for a soft delete (see the conventions).
 *
 * `prisma.x.delete()` is never correct for a row anything else references:
 * `users`, `departments`, `organizations` and `tickets` are all pointed at by
 * audit trails, assignment history and `deleted_by_id` back-references, and a
 * hard delete either cascades those away or fails on a Restrict FK.
 */
export function softDeleteData(actorId: string): {
  deletedAt: Date;
  deletedById: string;
} {
  return { deletedAt: new Date(), deletedById: actorId };
}

/** The inverse. Both columns clear together — a row with `deletedById` set but
 * `deletedAt` null reads as live while claiming someone deleted it. */
export function restoreData(): { deletedAt: null; deletedById: null } {
  return { deletedAt: null, deletedById: null };
}

/**
 * Runs a restore, translating the uniqueness violation it can provoke.
 *
 * **Restoring re-enters a uniqueness constraint that soft-deletion released.**
 * Every partial unique index in this schema carries `WHERE deleted_at IS NULL`,
 * which is what lets a re-hire register with the address of their own deleted
 * account. Clearing `deleted_at` puts the old row back into the index — and if
 * someone took the name or address in the meantime, the update fails on
 * `P2002`.
 *
 * Without this that surfaces as a 500 on an operation the admin has every
 * reason to expect to work. With it, they get a 409 that names the conflict and
 * tells them what to do about it.
 */
export async function restoreOrConflict<T>(
  restore: () => Promise<T>,
  conflictMessage: string,
): Promise<T> {
  try {
    return await restore();
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: conflictMessage,
      });
    }
    throw error;
  }
}

/**
 * The soft-delete predicate for a read.
 *
 * `includeDeleted` is honoured ONLY when the caller holds the module's manage
 * permission — the gateway checks that with `@RequirePermission`, and this
 * function trusts the boolean it is handed. Deleted rows come back with
 * `deletedAt` populated so the UI can tell them apart rather than silently
 * showing them as live.
 */
export function deletedFilter(includeDeleted: boolean): { deletedAt?: null } {
  return includeDeleted ? {} : { deletedAt: null };
}
