import { Injectable, Logger } from '@nestjs/common';
import {
  exceedsLimit,
  formatErrorMsg,
  RequestContext,
} from '@synapsedesk/common';
import type {
  PlanChangePreviewResponse,
  StorageUsageResponse,
} from '@synapsedesk/grpc-proto';
import { DocumentsGrpcClient } from '../documents/documents-grpc.client';

/** What the gate decided, and why. */
export type PlanChangeVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'over-limit'; overLimit: string[] }
  | { allowed: false; reason: 'unverifiable'; dimensions: string[] };

/**
 * The half of the plan-change block that only the gateway can compute.
 *
 * `auth-service` answers seats — it owns the definition — and cannot answer
 * storage or document count: `ingestion-service` counts those, and auth cannot
 * dial it because ingestion dials auth on every presign, so the reverse edge
 * would close a cycle on the identity leaf. The gateway holds both clients,
 * which is the same reason the plan-apply projection is composed here.
 *
 * **Not a Nest guard, despite the suffix, and it does not belong in
 * `common/guards/`.** That directory holds `CanActivate` implementations Nest
 * resolves from `@UseGuards`; this is a collaborator a service calls, and
 * moving it there would weaken the directory's meaning for every other file in
 * it. It is also billing-specific, and `common/` is for what more than one
 * module uses.
 *
 * **Two decisions in this file are the opposite of the ones next door**, and
 * both are deliberate:
 *
 * 1. **A gate may not degrade.** `enrichWithUsage` drops the dimensions
 *    ingestion owns when the leg fails — *"a failed leg subtracts rather than
 *    lies"* — which is right for a dry run, because a dry run is information.
 *    Here an unanswered leg REFUSES: a block that fails open is not a block,
 *    and "we could not verify, try again" is a far better outcome than a tenant
 *    landing over a limit they cannot clear.
 * 2. **The grants are numbers, never a parsed string.** `afterValue` reads the
 *    `"before -> after"` display strings off the projection DTO and returns
 *    `null` when the parse fails, which means "not changing", which means "no
 *    check". In a gate that is fail-open on a cosmetic edit: change the
 *    separator upstream and every block silently becomes an allow. The target
 *    grants arrive here as `int64`/`int32` off `subscription_plans`.
 */
@Injectable()
export class PlanChangeGuard {
  private readonly logger = new Logger(PlanChangeGuard.name);

  constructor(private readonly documents: DocumentsGrpcClient) {}

  /**
   * Verify the dimensions auth could not.
   *
   * @param preview auth's half: seat overruns, which dimensions narrow, and the
   *   target plan's grants as numbers.
   * @param context the caller — the usage read is scoped from it and takes no
   *   organization id at all.
   */
  async verify(
    preview: PlanChangePreviewResponse,
    context: RequestContext,
  ): Promise<PlanChangeVerdict> {
    if (preview.overLimit.length > 0) {
      return {
        allowed: false,
        reason: 'over-limit',
        overLimit: preview.overLimit,
      };
    }

    // **A widening change dials nothing.** An upgrade stays one Stripe round
    // trip and cannot be refused because an unrelated service is down — which
    // it would be, given the rule above this line.
    if (preview.narrowedDimensions.length === 0) {
      return { allowed: true };
    }

    let usage: StorageUsageResponse;
    try {
      // **The TENANT-SCOPED read**, not `GetPlatformUsage`. That one takes
      // `repeated organization_ids`, has no server-side authorization and no
      // tenant filter — its controller says so outright — and is held closed
      // only by `SuperAdminGuard` on its single caller. This route is reachable
      // by an Org Admin, so routing it through that surface would make a
      // privilege boundary depend on which ids the gateway happens to send.
      // `GetStorageUsage` cannot express another tenant's id at all.
      usage = await this.documents.storageUsage(context);
    } catch (error) {
      this.logger.warn(
        `Refusing a plan change: usage could not be read (${formatErrorMsg(error)})`,
      );

      return {
        allowed: false,
        reason: 'unverifiable',
        dimensions: preview.narrowedDimensions,
      };
    }

    const overLimit: string[] = [];

    // **`usage.limitBytes` is deliberately unread.** It is the tenant's CURRENT
    // ceiling, resolved by ingestion calling back into auth. The comparison is
    // against the TARGET plan's grant, and the field that means something
    // adjacent is sitting right beside the one that is correct.
    if (preview.narrowedDimensions.includes('storage')) {
      const used = Number(usage.usedBytes);

      if (exceedsLimit(used, Number(preview.targetMaxStorageBytes))) {
        overLimit.push(
          `maxStorageBytes: ${used} used, plan grants ${preview.targetMaxStorageBytes}`,
        );
      }
    }

    if (preview.narrowedDimensions.includes('documents')) {
      if (exceedsLimit(usage.documentCount, preview.targetMaxDocumentUploads)) {
        overLimit.push(
          `maxDocumentUploads: ${usage.documentCount} held, plan grants ${preview.targetMaxDocumentUploads}`,
        );
      }
    }

    return overLimit.length > 0
      ? { allowed: false, reason: 'over-limit', overLimit }
      : { allowed: true };
  }
}
