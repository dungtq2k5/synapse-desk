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
import {
  formatErrorMsg,
  MAX_ATTACHMENT_BYTES,
  resolveAnalyticsRangeDays,
  MAX_ATTACHMENTS_PER_MESSAGE,
  requireTenant,
} from '@synapsedesk/common';

/** What a tenant will accept on one message, platform ceilings already applied. */
export type AttachmentLimits = {
  maxBytes: number;
  maxPerMessage: number;
};

/**
 * How long a tenant's attachment ceilings are held.
 *
 * Short enough that an admin who narrows a limit sees it take effect while they
 * are still on the page, long enough that a burst of attachments on one message
 * costs one auth call rather than five.
 */
const ATTACHMENT_LIMIT_TTL_MS = 30_000;

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

  /**
   * Tenant attachment ceilings, by organization id.
   *
   * **Cached, and the precedent deliberately does NOT transfer.**
   * ingestion-service's `getStorageLimitBytes` refuses to cache, and its
   * docblock gives the reason: a plan grant *"goes stale the moment Stripe
   * writes a new plan — which is precisely when a customer expects their new
   * quota to work."*
   *
   * This value is the opposite kind. It changes when an admin submits a
   * settings form, nobody is waiting on it, and a few seconds of staleness on a
   * self-imposed safety limit costs nothing. What it buys is real: without a
   * cache this puts a synchronous cross-service call on every attachment
   * presign and every confirm, which is the highest-volume path here.
   *
   * **Nothing invalidates this, and 30 seconds is the flat cost.**
   * `ORGANIZATION_SETTINGS_UPDATED` is an `AuditAction`, not a subject, and
   * this service consumes no organization event — so a tenant that tightens its
   * limit keeps the looser one for the whole window every time, rather than
   * usually being rescued by an event. That is the right trade for a
   * self-imposed safety setting and the wrong one for an entitlement.
   *
   * **A PLAN grant must not reuse this, and the fix is a SUBSCRIPTION rather
   * than a shorter TTL.** Thirty seconds of a stale grant is thirty seconds of
   * a tenant spending an entitlement Stripe has already taken away, and no TTL
   * short enough to fix that is long enough to be worth having.
   * `billing.entitlements_changed` already exists and
   * `ai-settings/entitlements.consumer.ts` already consumes it exactly this way
   * — so `getStorageLimitBytes` refuses to cache because it has no consumer,
   * not because entitlements are uncacheable. A later phase can have the safe
   * version.
   *
   * **Entries are never evicted, and that is deliberate.** An expired one falls
   * through to the peer and is overwritten by the `set` below, so the only
   * entries that accumulate belong to tenants that stop making requests —
   * which no read-triggered delete can ever reach. Reclaiming them needs a
   * sweep or an LRU, and growth is bounded by tenant count rather than by
   * traffic: one small object per tenant this process has served is not worth
   * a timer.
   */
  private readonly limits = new Map<
    string,
    { value: AttachmentLimits; expiresAt: number }
  >();

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
   * How far back this tenant may look, in days — `min(platform, plan)`.
   *
   * **Resolved by the SHARED `resolveAnalyticsRangeDays`, not by arithmetic
   * written here.** `ingestion-service` has the same method for its own
   * analytics surface, and the failure this limit invites is the two disagreeing
   * — a window honoured on one page and not the other, with each service's own
   * suite green. Sharing the composition removes the way they could differ;
   * `analytics-window.contract.ts` is what proves they still do not.
   *
   * Uncached, unlike `getAttachmentLimits` beside it: an analytics read is not
   * the high-volume path an attachment presign is, and a tenant who just had
   * their window narrowed should not keep the old one for thirty seconds.
   *
   * @throws RpcException `UNAVAILABLE` when the organization cannot be read.
   */
  async getAnalyticsRangeDays(context: CallerContext): Promise<number> {
    try {
      const organization = await firstValueFrom(
        this.organizationService
          .getCurrentOrganization({}, packRequestContext(context))
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return resolveAnalyticsRangeDays(organization.maxAnalyticsRangeDays);
    } catch (error) {
      this.logger.error(
        `Could not read the analytics range limit: ${formatErrorMsg(error)}`,
      );

      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Could not verify the analytics range limit',
      });
    }
  }

  /**
   * The tenant's attachment ceilings, already composed with the platform ones.
   *
   * `min()` per field over the platform ceiling, the plan grant and the
   * tenant's own override, so every layer narrows and none widens. A tenant
   * that configured nothing gets whatever its plan grants.
   *
   * @throws RpcException `UNAVAILABLE` when the organization cannot be read.
   * A stale entry is never served in its place — an unreadable limit must not
   * resolve to the wide one, and a cached one is exactly the wide one a tenant
   * has just narrowed.
   */
  async getAttachmentLimits(context: CallerContext): Promise<AttachmentLimits> {
    const organizationId = requireTenant(context);

    const cached = this.limits.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const organization = await firstValueFrom(
        this.organizationService
          .getCurrentOrganization({}, packRequestContext(context))
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      const value: AttachmentLimits = {
        // **The `??` is the guard, and removing it fails OPEN.** Absent means
        // the tenant configured nothing — the normal state. Without the
        // fallback the operand is `undefined`, `Math.min` returns `NaN`, and
        // `size > NaN` is FALSE — so every size check passes and the limit is
        // gone. It reads like a redundant default and it is the only thing
        // standing between an unset override and an unlimited attachment.
        //
        // `?? 0` fails the other way and is louder: it refuses every
        // attachment for every tenant that never opened the settings page.
        //
        // The PLAN grant is a third argument to the same `min`, and its `?? 0`
        // means the OPPOSITE of the override's fallback above. The column is
        // NOT NULL and the proto field is not `optional`, so absent is never a
        // tenant's choice here — it is a wire that lost a field.
        //
        // Under the shipped loader options (`defaults: true`) an absent
        // non-optional int64 arrives as `0` and this `??` never fires; under
        // `defaults: false` it arrives as `undefined` and, unguarded, the whole
        // `min` is `NaN` — every attachment passes. Measured in
        // `loader-defaults.spec.ts`. Refusing is loud and matches what this
        // method already does when it cannot read the row at all.
        maxBytes: Math.min(
          MAX_ATTACHMENT_BYTES,
          organization.maxAttachmentBytesOverride ?? MAX_ATTACHMENT_BYTES,
          organization.maxAttachmentBytes ?? 0,
        ),
        maxPerMessage: Math.min(
          MAX_ATTACHMENTS_PER_MESSAGE,
          organization.maxAttachmentsPerMessageOverride ??
            MAX_ATTACHMENTS_PER_MESSAGE,
        ),
      };

      this.limits.set(organizationId, {
        value,
        expiresAt: Date.now() + ATTACHMENT_LIMIT_TTL_MS,
      });

      return value;
    } catch (error) {
      this.logger.error(
        `Could not read the attachment limits: ${formatErrorMsg(error)}`,
      );

      // FAILS CLOSED. Falling back to the platform ceiling looks like the safe
      // middle and is not: it hands a tenant that narrowed its limit the wide
      // one at exactly the moment the check could not run.
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Could not verify the attachment limits',
      });
    }
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
