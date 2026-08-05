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
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/common';

/**
 * Validates the ids this service stores but does not own, and reads the one
 * ENTITLEMENT it enforces.
 *
 * `documents.created_by_id` and `department_documents.department_id` point into
 * `postgres_auth` — a different physical database — so Postgres cannot enforce
 * a foreign key on either. That is the correct shape for service-per-database,
 * and it creates exactly one obligation: check at WRITE time, over gRPC. And
 * never again afterwards: Domain A only soft-deletes, so a reference that
 * resolved once cannot dangle.
 *
 * The entitlement read is the other half. `max_storage_bytes` lives on
 * `organizations` in auth-service; the USED bytes are `SUM(file_size_bytes)`
 * over `documents`, which lives here. Neither service can answer the quota
 * question alone, and this is the cheaper split — one scalar crosses the wire
 * rather than a sum that grows with the corpus.
 */
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
      const organization = await firstValueFrom(
        this.organizationService
          .getCurrentOrganization({}, packRequestContext(context))
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      const cycleStart = organization.billingCycleStart;

      return {
        budgetMicros: BigInt(organization.monthlyAiTokenBudget),
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
}
