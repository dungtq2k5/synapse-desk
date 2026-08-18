import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AUTH_GRPC_CLIENT,
  CallerContext,
  DEPARTMENT_SERVICE_NAME,
  SortOrder,
  DepartmentServiceClient,
  GRPC_DEADLINE_MS,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  packRequestContext,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/common';

/**
 * Validates the ids this service stores but does not own.
 *
 * `tickets.author_id`, `ticket_assignments.assigned_to_id` and
 * `department_id` all point into `postgres_auth` — a different physical
 * database — so Postgres cannot enforce a foreign key on any of them. That is
 * the correct shape for service-per-database, and it creates exactly one
 * obligation: check at WRITE time, over gRPC.
 *
 * **And never again afterwards.** Domain A only ever SOFT-deletes users and
 * departments, so a reference that resolved once can never dangle. There is
 * deliberately no reconciliation job and no read-time re-check — a locked or
 * deactivated agent's historical tickets still resolve their assignee
 * correctly, which is what a support history is for.
 *
 * **What is validated is the REFERENCED id, not the caller.** The gateway has
 * already authenticated and permission-checked whoever is making the request;
 * what it cannot check is whether the `assigneeId` in the body names a real
 * user in that tenant.
 */
@Injectable()
export class AuthReferenceService implements OnModuleInit {
  private readonly logger = new Logger(AuthReferenceService.name);

  private userService!: UserServiceClient;
  private departmentService!: DepartmentServiceClient;
  private organizationService!: OrganizationServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.userService =
      this.client.getService<UserServiceClient>(USER_SERVICE_NAME);
    this.departmentService = this.client.getService<DepartmentServiceClient>(
      DEPARTMENT_SERVICE_NAME,
    );

    // Added for the rollup jobs, which need the tenant's
    // timezone. The first thing in this service to talk to OrganizationService
    // — every other reference it resolves is a user or a department.
    this.organizationService =
      this.client.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
  }

  /**
   * Confirms a user id resolves IN THE CALLER'S TENANT.
   *
   * Tenant scoping is the point, not merely existence: auth-service applies
   * `tenantScope` to `GetUser` using the context packed below, so a valid id
   * belonging to another organization comes back NOT_FOUND. Without that, an
   * admin could author a ticket on behalf of a user in someone else's
   * workspace — a cross-tenant write dressed as a normal request.
   */
  async assertUserExists(
    userId: string,
    context: CallerContext,
  ): Promise<void> {
    await this.assertResolves(
      () =>
        firstValueFrom(
          this.userService
            .getUser({ id: userId }, packRequestContext(context))
            .pipe(timeout(GRPC_DEADLINE_MS)),
        ),
      `No user with id '${userId}' in this workspace`,
      `user ${userId}`,
    );
  }

  /** Same contract, for a department. */
  async assertDepartmentExists(
    departmentId: string,
    context: CallerContext,
  ): Promise<void> {
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

  /**
   * The tenant's departments, as classification candidates
   *
   * Sent WITH the classify request because rag-service cannot see
   * `postgres_auth`, and a suggestion naming a department that does not exist
   * is worse than no suggestion: it either fails a write or silently routes a
   * ticket nowhere.
   *
   * **Returns an empty list rather than throwing when auth-service is
   * unreachable.** Classification is a convenience — the agent routes the
   * ticket either way — and an empty candidate list simply produces no
   * suggestion. Failing the request would turn a neighbouring service's
   * hiccup into a broken button.
   */
  async listDepartments(
    context: CallerContext,
  ): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await firstValueFrom(
        this.departmentService
          .listDepartments(
            // A generous page: the candidate list is what the model chooses
            // from, and a truncated one silently removes departments a ticket
            // could legitimately be routed to.
            {
              page: {
                page: 1,
                limit: 200,
                searchTerm: '',
                sortBy: '',
                sortOrder: SortOrder.SORT_ORDER_UNSPECIFIED,
              },
              includeDeleted: false,
            },
            packRequestContext(context),
          )
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return response.items.map((department) => ({
        id: department.id,
        name: department.name,
      }));
    } catch (error) {
      this.logger.warn(
        `Could not list departments for classification: ${formatErrorMsg(error)}`,
      );

      return [];
    }
  }

  /**
   * INVALID_ARGUMENT, not NOT_FOUND.
   *
   * The distinction matters at the gateway, which maps them to 400 and 404. A
   * 404 here would be about the wrong resource: the caller asked to create a
   * TICKET, and the ticket is not what is missing — a field in their request
   * names something that does not exist. That is a malformed request, and 400
   * is what tells them to fix the body rather than the URL.
   *
   * An UNREACHABLE peer is deliberately NOT swallowed into the same answer.
   * "auth-service is down" and "that user does not exist" are different facts,
   * and reporting the outage as a validation error would send an operator
   * hunting for a bad id that was fine all along. It fails CLOSED either way —
   * the write does not happen — but it fails closed with the right reason.
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
}
