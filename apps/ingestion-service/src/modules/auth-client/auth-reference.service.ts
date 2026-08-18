import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AUTH_GRPC_CLIENT,
  CallerContext,
  DEPARTMENT_SERVICE_NAME,
  DepartmentServiceClient,
  GRPC_DEADLINE_MS,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  packRequestContext,
  fromProtoAiModelTier,
} from '@synapsedesk/grpc-proto';
import { DEFAULT_AI_MODEL_TIER, formatErrorMsg } from '@synapsedesk/common';

/**
 * Validates the ids this service stores but does not own, and reads the one
 * entitlement it enforces.
 *
 * The quota answer needs both services: `max_storage_bytes` lives on
 * `organizations` in auth-service, the used bytes are `SUM(file_size_bytes)`
 * over `documents` here. One scalar crosses the wire, not a growing sum.
 */
// Checked at WRITE time and never again: `documents.created_by_id` and
// `department_documents.department_id` point into `postgres_auth`, a different
// physical database, so no foreign key can enforce them. Domain A only
// soft-deletes, so a reference that resolved once cannot later dangle.
@Injectable()
export class AuthReferenceService implements OnModuleInit {
  private readonly logger = new Logger(AuthReferenceService.name);

  private departmentService!: DepartmentServiceClient;
  private organizationService!: OrganizationServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.departmentService = this.client.getService<DepartmentServiceClient>(
      DEPARTMENT_SERVICE_NAME,
    );
    this.organizationService =
      this.client.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
  }

  /**
   * Confirms every department id resolves IN THE CALLER'S TENANT.
   *
   * Tenant scoping is the point rather than mere existence: auth-service
   * applies `tenantScope` to `GetDepartment` using the context packed below, so
   * a valid id belonging to another organization comes back NOT_FOUND. Without
   * that, an admin could scope a document to a department in somebody else's
   * workspace — and since `department_ids` is exactly what the retrieval filter
   * matches on, that is a cross-tenant disclosure dressed as a scoping change.
   */
  async assertDepartmentsExist(
    departmentIds: string[],
    context: CallerContext,
  ): Promise<void> {
    // Sequential rather than `Promise.all`, deliberately: the list is short — a
    // document belongs to a handful of departments — and the FIRST bad id is
    // what the caller needs named. Parallel would race several rejections and
    // report whichever one lost.
    for (const departmentId of new Set(departmentIds)) {
      await this.assertResolves(
        () =>
          firstValueFrom(
            this.departmentService
              .getDepartment({ id: departmentId }, packRequestContext(context))
              .pipe(timeout(GRPC_DEADLINE_MS)),
          ),
        `No department with id '${departmentId}' in this workspace`,
        `department ${departmentId}`,
      );
    }
  }

  /**
   * The tenant's storage entitlement, in bytes.
   *
   * Read fresh on every presign rather than cached. It is one small RPC on a
   * path that is about to sign a URL for a 25 MB upload, and a cached limit is
   * exactly what goes stale the moment Stripe writes a new plan — which is
   * precisely when a customer expects their new quota to work.
   */
  async getStorageLimitBytes(context: CallerContext): Promise<number> {
    try {
      const organization = await firstValueFrom(
        this.organizationService
          .getCurrentOrganization({}, packRequestContext(context))
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return Number(organization.maxStorageBytes);
    } catch (error) {
      this.logger.error(
        `Could not read the storage entitlement: ${formatErrorMsg(error)}`,
      );

      // FAILS CLOSED. An unreadable quota must not mean "unlimited" — that is
      // the one direction which lets a tenant blow past a limit nobody could
      // check, and it would do so silently.
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Could not verify the storage quota',
      });
    }
  }

  /**
   * The tenant's AI entitlement — the allowance AND the cycle it applies to.
   *
   * Both in one read because both are on `organizations` and the quota key
   * needs the cycle start: two calls would be two round trips for one row, and
   * would open a window where the budget came from one cycle and the key from
   * another.
   *
   * `monthly_ai_token_budget` is denominated in tokens by its NAME and in
   * MICROS by its meaning (RDM §1.14) — the column name is kept for continuity
   * while the value is read as "the tenant's monthly AI allowance". Converting
   * it here rather than at each call site is what stops one service treating it
   * as tokens and another as money.
   */
  async getAiEntitlement(
    context: CallerContext,
  ): Promise<{ budgetMicros: bigint; billingCycleStart: Date }> {
    try {
      // `GetOrganizationEntitlements`, not `GetCurrentOrganization`
      // The latter ships a tenant's name, slug, allowed email domains
      // and onboarding state on a call that reads two numbers, and it invites
      // a gate to start depending on a field that has nothing to do with
      // entitlements.
      const entitlements = await firstValueFrom(
        this.organizationService
          .getOrganizationEntitlements({}, packRequestContext(context))
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      const cycleStart = entitlements.billingCycleStart;

      return {
        budgetMicros: BigInt(entitlements.monthlyAiTokenBudget),
        // A missing cycle start would silently share one Redis key across every
        // cycle, so a tenant's spend would never reset. Falling back to the
        // epoch makes that visible as "spend since 1970" rather than hiding it.
        billingCycleStart: cycleStart
          ? new Date(Number(cycleStart.seconds) * 1000)
          : new Date(0),
      };
    } catch (error) {
      this.logger.error(
        `Could not read the AI entitlement: ${formatErrorMsg(error)}`,
      );

      // FAILS CLOSED, like the storage quota. An unreadable allowance must not
      // mean "unlimited".
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Could not verify the AI allowance',
      });
    }
  }

  /**
   * The tenant's AI TIER, read over gRPC.
   *
   * Read over gRPC rather than from a column this service does not own, and
   * cached by `AiSettingsService` against `billing.entitlements_changed` — so
   * the hot path is a map lookup and a downgrade still takes effect on the next
   * request rather than at the end of a TTL.
   *
   * **Falls back to the DEFAULT tier when auth-service cannot be reached**,
   * which is the opposite of how the AI budget behaves two methods up. The
   * asymmetry is deliberate: an unreadable BUDGET must fail closed, because
   * guessing "unlimited" spends money that may not exist. An unreadable TIER
   * fails to FAST — the cheaper model — so the failure costs answer quality
   * rather than money, and refusing the request outright would take AI down
   * for every tenant whenever auth-service hiccuped.
   */
  async getAiModelTier(context: CallerContext): Promise<string> {
    try {
      const organization = await firstValueFrom(
        this.organizationService
          .getCurrentOrganization({}, packRequestContext(context))
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      // `?? DEFAULT` rather than `||`: the enum's UNSPECIFIED maps to null,
      // which is the same "we could not read it" case the empty string used to
      // signal — and falling back to the cheap tier is the safe direction. The
      // expensive one would be chosen for every tenant on a read failure.
      return (
        fromProtoAiModelTier(organization.aiModelTier) ?? DEFAULT_AI_MODEL_TIER
      );
    } catch (error) {
      this.logger.warn(
        `Could not read the AI tier; falling back to ${DEFAULT_AI_MODEL_TIER}: ${formatErrorMsg(error)}`,
      );

      return DEFAULT_AI_MODEL_TIER;
    }
  }

  /**
   * INVALID_ARGUMENT, not NOT_FOUND.
   *
   * The distinction matters at the gateway, which maps them to 400 and 404. A
   * 404 here would be about the wrong resource: the caller asked to create a
   * DOCUMENT, and the document is not what is missing — a field in their
   * request names something that does not exist. 400 tells them to fix the
   * body rather than the URL.
   *
   * An UNREACHABLE peer is deliberately not swallowed into the same answer.
   * "auth-service is down" and "that department does not exist" are different
   * facts, and reporting the outage as a validation error sends an operator
   * hunting for a bad id that was fine all along. Both fail CLOSED; only one of
   * them fails closed with the right reason.
   */
  private async assertResolves(
    call: () => Promise<unknown>,
    notFoundMessage: string,
    subject: string,
  ): Promise<void> {
    try {
      await call();
    } catch (error) {
      const code = (error as { code?: number })?.code;

      if (code === status.NOT_FOUND || code === status.PERMISSION_DENIED) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: notFoundMessage,
        });
      }

      this.logger.error(
        `Could not validate ${subject} against auth-service: ${formatErrorMsg(error)}`,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Could not verify the request against the identity service',
      });
    }
  }

  /**
   * Tenant timezones for a set of ids.
   *
   * Called by the daily rollup jobs, which run across every tenant that had
   * activity rather than on behalf of a caller. Bulk, so one run costs one
   * round trip rather than one per tenant.
   *
   * **Returns a MAP, and an id missing from it means "use the default".** A
   * tenant deleted between the job reading its own tables and asking here is an
   * ordinary race, and the caller already has to handle a tenant that never set
   * a timezone — one code path for both.
   *
   * An outage returns an EMPTY map rather than throwing: every tenant then
   * buckets in UTC for that run, which is wrong for some of them and fixable by
   * a backfill. Failing the run instead would lose the day's numbers entirely
   * and leave nothing to recompute from until somebody noticed.
   */
  async listOrganizationTimezones(
    organizationIds: string[],
  ): Promise<Map<string, string>> {
    if (organizationIds.length === 0) return new Map();

    try {
      const response = await firstValueFrom(
        this.organizationService
          .listOrganizationTimezones({ organizationIds })
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return new Map(
        response.items
          .filter((item) => item.timezone)
          .map((item) => [item.organizationId, item.timezone as string]),
      );
    } catch (error) {
      this.logger.error(
        `Could not resolve timezones for ${organizationIds.length} tenant(s); ` +
          `bucketing in UTC: ${formatErrorMsg(error)}`,
      );

      return new Map();
    }
  }

  /**
   * Each tenant's BILLING CYCLE START, in bulk.
   *
   * **Reconciling against the wrong cycle is worse than not reconciling.**
   * `QuotaCounterService` keys on `quota:{org}:{cycleStartEpoch}`, so a
   * corrected total written under someone else's cycle lands on a key the gate
   * never reads, while the real key keeps its drift. The sweep logs success and
   * fixes nothing.
   *
   * **So this returns an empty map on failure and the caller SKIPS those
   * tenants**, which is the opposite of `listOrganizationTimezones` directly
   * above. The asymmetry is the point: a missing timezone gives a slightly
   * wrong bucket that a backfill repairs, while a missing cycle start gives a
   * confidently wrong counter that nothing repairs — and skipping leaves the
   * existing drift for the next hourly run to correct.
   */
  async listOrganizationCycles(
    organizationIds: string[],
  ): Promise<Map<string, Date>> {
    if (organizationIds.length === 0) return new Map();

    try {
      const response = await firstValueFrom(
        this.organizationService
          .listOrganizationCycles({ organizationIds })
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return new Map(
        response.items
          .filter((item) => item.billingCycleStart)
          .map((item) => [
            item.organizationId,
            new Date(Number(item.billingCycleStart!.seconds) * 1000),
          ]),
      );
    } catch (error) {
      this.logger.error(
        `Could not resolve billing cycles for ${organizationIds.length} ` +
          `tenant(s); SKIPPING reconciliation this run rather than ` +
          `reconciling against a guess: ${formatErrorMsg(error)}`,
      );

      return new Map();
    }
  }
}
