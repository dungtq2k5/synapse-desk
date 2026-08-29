import { Inject, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  CreateGlobalRoleRequest,
  CreatePlatformOrganizationRequest,
  CreatePlatformOrganizationResponse,
  ListGlobalRolesRequest,
  ListGlobalRolesResponse,
  ListPlatformOrganizationsRequest,
  ListPlatformOrganizationsResponse,
  ListPlatformUsersRequest,
  ListPlatformUsersResponse,
  OffboardOrganizationRequest,
  OffboardOrganizationResponse,
  PlatformMetricsResponse,
  PlatformOrganizationIdRequest,
  PlatformOrganizationResponse,
  ResetBillingCycleRequest,
  RoleResponse,
  SetOrganizationStatusRequest,
  toPageMeta,
  toProtoTimestamp,
  UpdatePlatformOrganizationRequest,
  emptyPage,
  toPrismaPage,
  toSearchFilter,
  fromProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditPublisher,
  AuditResourceType,
  InvitationStatus,
  isUniqueConstraintViolation,
  normalizeEmail,
  ORG_STATUS_TRANSITIONS,
  ORGANIZATION_SORTABLE_FIELDS,
  OrgStatus,
  requireActor,
  restoreData,
  softDeleteData,
  SystemRoleName,
  USER_SORTABLE_FIELDS,
  FREE_TIER_ORGANIZATION_GRANTS,
  formatErrorMsg,
  limitAlertStateKeys,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { AuthGenerationStore } from '../limit-alerts/generation.store';
import { LIMIT_ALERT_REDIS } from '../limit-alerts/limit-alerts.module';
import { SessionsService } from '../sessions/sessions.service';
import { RolesService } from '../roles/roles.service';
import { toOrganizationResponse } from '../organizations/organization.mapper';
import { toUserResponse } from '../users/user.mapper';
import { ROLE_INCLUDE, toRoleResponse } from '../roles/role.mapper';
import { Organization, Prisma } from '../../generated/prisma/client';

/** The rollups every tenant row carries. */
const ORGANIZATION_COUNTS = {
  _count: {
    select: { users: true, departments: true, invitations: true },
  },
} satisfies Prisma.OrganizationInclude;

type OrganizationRow = Organization & {
  _count: { users: number; departments: number; invitations: number };
};

/**
 * Cross-tenant administration.
 *
 * NOTHING here calls `tenantScope`, which is the entire point and also the
 * entire risk: these queries deliberately span every customer. That is why the
 * surface lives in its own service behind `SuperAdminGuard` rather than as
 * extra methods on the tenant-facing ones, where a missing filter would be
 * indistinguishable from the surrounding code.
 *
 * Every write here audits with `organizationId: null` (RDM): the event
 * belongs to the PLATFORM, not to the customer it touched.
 */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
    private readonly sessionsService: SessionsService,
    private readonly rolesService: RolesService,
    private readonly generations: AuthGenerationStore,
    @Inject(LIMIT_ALERT_REDIS) private readonly limitAlertRedis: Redis,
  ) {}

  // ---------------------------------------------------------------- Tenants

  async listOrganizations(
    request: ListPlatformOrganizationsRequest,
  ): Promise<ListPlatformOrganizationsResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      ORGANIZATION_SORTABLE_FIELDS,
    );

    const search = toSearchFilter(page.searchTerm);
    const statusFilter =
      request.status === undefined ? null : fromProtoOrgStatus(request.status);
    const where: Prisma.OrganizationWhereInput = {
      ...(request.includeDeleted ? {} : { deletedAt: null }),
      // The wire carries the enum; Prisma's column is a VarChar, so the
      // filter is the DOMAIN value. UNSPECIFIED and absent both mean "every
      // status" — `fromProtoOrgStatus` maps the former to null, which is
      // exactly the same branch.
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(search ? { OR: [{ name: search }, { slug: search }] } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: ORGANIZATION_COUNTS,
        orderBy,
        skip,
        take,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      items: items.map(toPlatformOrganizationResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  async getOrganization(
    request: PlatformOrganizationIdRequest,
  ): Promise<PlatformOrganizationResponse> {
    return toPlatformOrganizationResponse(
      await this.load(request.organizationId),
    );
  }

  /**
   * Tenant AND its first Org Admin, in ONE transaction.
   *
   * Half of this is useless: an organization nobody can administer, or an admin
   * with no organization. The admin gets no password — they set one through the
   * reset flow, which is also the only thing that proves they hold the address.
   */
  async createOrganization(
    request: CreatePlatformOrganizationRequest,
    context: CallerContext,
  ): Promise<CreatePlatformOrganizationResponse> {
    const adminEmail = normalizeEmail(request.adminEmail);
    const slug = request.slug.trim().toLowerCase();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            // **The base, and every override below it wins.** Order is the
            // whole of it: `{ ...overrides, ...FREE_TIER_ENTITLEMENTS }` would
            // compile, look identical, and silently discard every number a
            // Super Admin typed.
            //
            // That a platform-created tenant starts on the FREE tier unless
            // overridden is now a stated choice rather than an inherited one.
            // It is what the schema defaults did, so nothing changes today —
            // but a route whose purpose is provisioning a customer arguably
            // wants a plan required instead, and that is a decision somebody
            // can now see to make.
            ...FREE_TIER_ORGANIZATION_GRANTS,
            name: request.name.trim(),
            slug,
            domain: request.domain?.trim().toLowerCase() || null,
            status: OrgStatus.PENDING_ONBOARDING,
            allowedEmailDomains: request.allowedEmailDomains.map((domain) =>
              domain.trim().toLowerCase(),
            ),
            // Absent keeps the free-tier value rather than 0 — a tenant created
            // with zero seats could never be used.
            ...(request.maxAgentSeats !== undefined
              ? { maxAgentSeats: request.maxAgentSeats }
              : {}),
            ...(request.maxStorageBytes !== undefined
              ? { maxStorageBytes: BigInt(request.maxStorageBytes) }
              : {}),
            ...(request.monthlyAiTokenBudget !== undefined
              ? { monthlyAiTokenBudget: BigInt(request.monthlyAiTokenBudget) }
              : {}),
          },
        });

        const admin = await tx.user.create({
          data: {
            organizationId: organization.id,
            email: adminEmail,
            fullName: request.adminFullName.trim(),
          },
        });

        const orgAdminRoleId = await this.rolesService.getSystemRoleId(
          SystemRoleName.ORG_ADMIN,
          tx,
        );
        // Through RolesService so `roles.user_assigned` moves with the grant.
        await this.rolesService.grantRoles(tx, admin.id, [orgAdminRoleId]);

        return { organization, admin };
      });

      this.audit.record(context, {
        action: AuditAction.PLATFORM_ORGANIZATION_CREATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: created.organization.id,
        // null: a platform act belongs to the platform, not to the customer.
        organizationId: null,
        metadata: { slug, adminEmail },
      });

      const withCounts = await this.load(created.organization.id);

      return {
        organization: toPlatformOrganizationResponse(withCounts),
        // No avatar url map, deliberately — see listPlatformUsers below.
        admin: toUserResponse(created.admin),
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'That slug, domain or admin address is already taken',
        });
      }
      throw error;
    }
  }

  /**
   * Everything the tenant-facing update allows, PLUS quotas.
   *
   * **The quota fields are an OVERRIDE with a lifetime, not a setting** —
   * Since billing shipped, `max_agent_seats`, `max_storage_bytes`
   * and `monthly_ai_token_budget` are written by the Stripe entitlement
   * webhook, so a manual edit here survives exactly until the next
   * `subscription.updated` and is then reverted with no notice.
   *
   * That is CORRECT for a support gesture — "here's an extra 5 GB while we sort
   * this out" — and wrong as a way to sell an upgrade. The response says so,
   * because the alternative is someone discovering the revert weeks later and
   * reporting it as data loss.
   */
  async updateOrganization(
    request: UpdatePlatformOrganizationRequest,
    context: CallerContext,
  ): Promise<PlatformOrganizationResponse> {
    const existing = await this.load(request.organizationId);

    const data: Prisma.OrganizationUpdateInput = {};
    if (request.name !== undefined) data.name = request.name.trim();
    if (request.slug !== undefined)
      data.slug = request.slug.trim().toLowerCase();
    if (request.domain !== undefined) {
      data.domain = request.domain.trim().toLowerCase() || null;
    }
    if (request.maxAgentSeats !== undefined) {
      data.maxAgentSeats = request.maxAgentSeats;
    }
    if (request.maxStorageBytes !== undefined) {
      data.maxStorageBytes = BigInt(request.maxStorageBytes);
    }
    if (request.monthlyAiTokenBudget !== undefined) {
      data.monthlyAiTokenBudget = BigInt(request.monthlyAiTokenBudget);
    }

    const organization = await this.updateOrConflict(existing.id, data);

    this.audit.record(context, {
      action: AuditAction.PLATFORM_ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organization.id,
      organizationId: null,
      metadata: {
        before: {
          name: existing.name,
          slug: existing.slug,
          maxAgentSeats: existing.maxAgentSeats,
        },
        // Recorded so the revert is attributable when it happens: a tenant
        // with a subscription had a quota set by hand, and the next webhook
        // will overwrite it.
        overridesStripeEntitlements:
          existing.stripeSubscriptionId !== null &&
          (request.maxAgentSeats !== undefined ||
            request.maxStorageBytes !== undefined ||
            request.monthlyAiTokenBudget !== undefined),
        after: {
          name: organization.name,
          slug: organization.slug,
          maxAgentSeats: organization.maxAgentSeats,
        },
      },
    });

    return toPlatformOrganizationResponse(organization);
  }

  /**
   * The tenant lifecycle machine.
   *
   * Legal transitions ONLY — the illegal ones are the point. FROZEN ->
   * SUSPENDED_PAST_DUE would silently restore read access to a tenant frozen
   * for abuse, and nothing can return to PENDING_ONBOARDING once it has left.
   *
   * Freezing revokes every session as well as flipping the column. Without
   * that, "frozen" would take effect only as each access token expired, and the
   * gateway gate's cache would still be serving the old answer for its TTL.
   */
  async setOrganizationStatus(
    request: SetOrganizationStatusRequest,
    context: CallerContext,
  ): Promise<PlatformOrganizationResponse> {
    const existing = await this.load(request.organizationId);

    const from = existing.status as OrgStatus;
    const to = fromProtoOrgStatus(request.status);

    // Only UNSPECIFIED reaches here now. The membership check this replaces
    // existed because the field was a bare string and ANY string arrived
    // intact; the enum moved that gate onto the wire, where protobuf rejects
    // an unknown value before the handler runs (conventions §7.3). What is
    // left is proto3's zero value, which means "not set" and is never a
    // status.5 says reject rather than default, and there is no safe
    // default here: ACTIVE would unfreeze a tenant, FROZEN would lock one out.
    if (to === null) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A target status is required',
      });
    }

    const legal = ORG_STATUS_TRANSITIONS[from] ?? [];
    if (!legal.includes(to)) {
      throw new RpcException({
        // ABORTED -> 409: a conflict with the current state.
        code: status.ABORTED,
        message: `Cannot move a workspace from ${from} to ${to}. Legal from ${from}: ${legal.join(', ') || 'none'}.`,
      });
    }

    const organization = await this.prisma.organization.update({
      where: { id: existing.id },
      data: { status: to },
      include: ORGANIZATION_COUNTS,
    });

    // Losing access is immediate; regaining it needs no session surgery.
    let revokedSessionCount = 0;
    if (to === OrgStatus.FROZEN) {
      revokedSessionCount = await this.revokeAllTenantSessions(existing.id);
    }

    this.audit.record(context, {
      action: AuditAction.PLATFORM_ORGANIZATION_STATUS_CHANGED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organization.id,
      organizationId: null,
      metadata: { from, to, reason: request.reason, revokedSessionCount },
    });

    return toPlatformOrganizationResponse(organization);
  }

  /**
   * Rolls the metering window. **BREAK-GLASS since billing shipped**.
   *
   * It was routine tenant administration. Two things changed underneath it:
   *
   *   - `billing_cycle_start` now follows Stripe's `current_period_start`, so a
   *     manual roll desynchronizes the quota window from the invoice period —
   *     and the next `subscription.updated` silently re-synchronizes it, which
   *     means the effect is temporary in a way nobody is told about;
   *   - the cycle epoch is inside the Redis quota key, so this also ZEROES AI
   *     spend and re-arms every threshold alert. That is a budget grant, and it
   *     does not appear anywhere in the response.
   *
   * Kept, because it is genuinely needed to make a tenant whole after an
   * incident. The mandatory reason is what separates that from using it as a
   * way to sell an upgrade — the audit row is read months later by someone who
   * was not there.
   */
  async resetBillingCycle(
    request: ResetBillingCycleRequest,
    context: CallerContext,
  ): Promise<PlatformOrganizationResponse> {
    const existing = await this.load(request.organizationId);

    const reason = request.reason?.trim() ?? '';
    if (!reason) {
      // Refused rather than defaulted. "Reset by an operator" in an audit row
      // answers no question anyone will actually have — and this endpoint now
      // grants a fresh AI budget, so the row is the only record of why.
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'A reason is required: rolling the billing cycle desynchronizes the quota window from the Stripe invoice period and grants a fresh AI budget',
      });
    }

    const organization = await this.prisma.organization.update({
      where: { id: existing.id },
      data: { billingCycleStart: new Date() },
      include: ORGANIZATION_COUNTS,
    });

    this.audit.record(context, {
      action: AuditAction.PLATFORM_BILLING_CYCLE_RESET,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organization.id,
      organizationId: null,
      metadata: {
        previousCycleStart: existing.billingCycleStart.toISOString(),
        reason,
        // Recorded because the two are now coupled: a tenant with a
        // subscription had their invoice period overridden by hand, and
        // whoever reads this row later needs to know whether that mattered.
        hadStripeSubscription: existing.stripeSubscriptionId !== null,
      },
    });

    return toPlatformOrganizationResponse(organization);
  }

  /**
   * Offboards a tenant for real: soft-deletes the row and cuts off access.
   *
   * This is the irreversible-ish half that `DELETE /organizations/current` only
   * REQUESTS. Child rows are deliberately not marked: `tenantScope` already
   * excludes rows whose organization is gone, and the gateway's lifecycle gate
   * refuses a deleted tenant outright — so marking them would be a large write
   * that has to be undone one by one on restore.
   */
  async offboardOrganization(
    request: OffboardOrganizationRequest,
    context: CallerContext,
  ): Promise<OffboardOrganizationResponse> {
    const existing = await this.load(request.organizationId);
    const actorId = requireActor(context);

    await this.prisma.organization.update({
      where: { id: existing.id },
      data: softDeleteData(actorId),
    });

    const revokedSessionCount = await this.revokeAllTenantSessions(existing.id);

    // **Only the LEVELS are cleared, and the generation deliberately survives.**
    //
    // An earlier version deleted the generation rows here and it performed the
    // exact failure they exist to prevent. `restoreOrganization` un-deletes a
    // tenant IN PLACE; Domain E's `notifications` rows live in another database
    // and are untouched by offboarding. So: cross 80% (publishes
    // `limit:{org}:storage:80:0`), offboard (generation reset to 0), restore,
    // cross 80% again — and the permanent partial index already holds that id,
    // so the alert is rejected and that tenant is never told about that
    // dimension again. That is the Redis-flush scenario executed deliberately.
    //
    // The levels are safe to clear for the reason the config gives: losing one
    // costs at most a duplicate alert the durable guard then collapses.
    //
    // The generation rows are reclaimed on a HARD delete, where the
    // notifications go too — not on a soft delete that restore reverses.
    await this.clearLimitAlarmLevels(existing.id);

    this.audit.record(context, {
      action: AuditAction.PLATFORM_ORGANIZATION_OFFBOARDED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: existing.id,
      organizationId: null,
      metadata: { reason: request.reason, revokedSessionCount },
    });

    return { revokedSessionCount };
  }

  /** Restored tenants get no sessions back — everyone signs in again. */
  async restoreOrganization(
    request: PlatformOrganizationIdRequest,
    context: CallerContext,
  ): Promise<PlatformOrganizationResponse> {
    const existing = await this.prisma.organization.findFirst({
      where: { id: request.organizationId, deletedAt: { not: null } },
      select: { id: true, slug: true },
    });
    if (!existing) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No offboarded workspace with that id',
      });
    }

    const organization = await this.updateOrConflict(
      existing.id,
      restoreData(),
    );

    this.audit.record(context, {
      action: AuditAction.PLATFORM_ORGANIZATION_RESTORED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organization.id,
      organizationId: null,
      metadata: { slug: organization.slug },
    });

    return toPlatformOrganizationResponse(organization);
  }

  // ---------------------------------------------------------------- Cross-tenant search

  /**
   * Every row carries its tenant.
   *
   * Not decoration: a support engineer looking at a bare list of addresses,
   * several of which legitimately repeat across tenants (RDM), has no way
   * to tell which account they are about to act on.
   */
  async listUsers(
    request: ListPlatformUsersRequest,
  ): Promise<ListPlatformUsersResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(page, USER_SORTABLE_FIELDS);

    const search = toSearchFilter(page.searchTerm);
    const where: Prisma.UserWhereInput = {
      ...(request.includeDeleted ? {} : { deletedAt: null }),
      ...(request.organizationId
        ? { organizationId: request.organizationId }
        : {}),
      ...(search ? { OR: [{ fullName: search }, { email: search }] } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          organization: { select: { name: true } },
          roles: { select: { name: true } },
        },
        orderBy,
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    // Avatars are NOT resolved on the platform paths, and that is deliberate
    // rather than an oversight to fix later.
    //
    // A Super Admin's `organizationId` is null, and `getSignedReadUrls` opens
    // with `requireTenant`, which for a null tenant throws FAILED_PRECONDITION
    // — it does not return an empty map. Resolving here would therefore add a
    // guaranteed-failing round trip to every platform request, and because
    // `resolveReadUrls` catches and returns `{}`, it would fail SILENTLY: the
    // avatars would still be absent, just more slowly.
    //
    // Cross-tenant administrative lists show no avatars, by design. The default
    // `{}` parameter on `toUserResponse` is what makes that a one-word choice.
    return {
      items: items.map((user) => ({
        user: toUserResponse(user),
        organizationId: user.organizationId ?? undefined,
        organizationName: user.organization?.name ?? undefined,
        roleNames: user.roles.map((role) => role.name),
        deletedAt: toProtoTimestamp(user.deletedAt),
      })),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  // -------------------------------------------------------------------------
  // Global roles
  // -------------------------------------------------------------------------

  async listGlobalRoles(
    request: ListGlobalRolesRequest,
  ): Promise<ListGlobalRolesResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(page, [
      'createdAt',
      'updatedAt',
      'name',
      'userAssigned',
    ]);

    const where: Prisma.RoleWhereInput = { organizationId: null };

    const [items, totalItems] = await Promise.all([
      this.prisma.role.findMany({
        where,
        include: ROLE_INCLUDE,
        orderBy,
        skip,
        take,
      }),
      this.prisma.role.count({ where }),
    ]);

    return {
      items: items.map(toRoleResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * A GLOBAL role — visible and assignable in every tenant, which is why only
   * the platform may create one.
   *
   * No no-escalation check: a Super Admin holds no tenant RBAC rows at all, so
   * a subset test would forbid them from creating any role whatsoever. Their
   * authority comes from `SuperAdminGuard`, not from a permission set.
   */
  async createGlobalRole(
    request: CreateGlobalRoleRequest,
    context: CallerContext,
  ): Promise<RoleResponse> {
    const actorId = requireActor(context);

    try {
      const role = await this.prisma.role.create({
        data: {
          organizationId: null,
          name: request.name.trim(),
          description: request.description?.trim() || null,
          isSystemRole: true,
          createdById: actorId,
          permissions: {
            connect: request.permissionCodes.map((code) => ({ code })),
          },
        },
        include: ROLE_INCLUDE,
      });

      this.audit.record(context, {
        action: AuditAction.PLATFORM_GLOBAL_ROLE_CREATED,
        resourceType: AuditResourceType.ROLE,
        resourceId: role.id,
        organizationId: null,
        metadata: { name: role.name, permissionCodes: request.permissionCodes },
      });

      return toRoleResponse(role);
    } catch (error) {
      // `roles_global_name_key` is the partial index guarding global names.
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'A global role with that name already exists',
        });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- Metrics

  /**
   * Platform-wide rollups.
   *
   * Every figure is a COUNT over a full table, so this must never be joined
   * into a per-request path — the gateway caches it. Storage and AI spend are
   * absent rather than zeroed: those meters belong to domains that do not
   * exist, and a zero would read as "nothing spent".
   */
  async getMetrics(): Promise<PlatformMetricsResponse> {
    const now = new Date();

    const [
      organizations,
      byStatus,
      totalUsers,
      activeUsers,
      pendingInvitations,
      liveSessions,
      seatAllocation,
    ] = await Promise.all([
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.organization.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { deletedAt: null, isLocked: false } }),
      this.prisma.userInvitation.count({
        where: { status: InvitationStatus.PENDING, expiresAt: { gt: now } },
      }),
      this.prisma.deviceSession.count({
        where: { rotatedAt: null, expiresAt: { gt: now } },
      }),
      this.prisma.organization.aggregate({
        where: { deletedAt: null },
        _sum: { maxAgentSeats: true },
      }),
    ]);

    return {
      totalOrganizations: organizations,
      organizationsByStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      totalUsers,
      activeUsers,
      pendingInvitations,
      liveSessions,
      seatsAllocated: seatAllocation._sum.maxAgentSeats ?? 0,
      // The same definition the tenant usage page and the invitation gate use.
      seatsInUse: activeUsers + pendingInvitations,
      generatedAt: toProtoTimestamp(now),
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Drops a departed tenant's cached alarm LEVELS. Never the generations.
   *
   * One `del` covers all three dimensions because both services point at the
   * same Redis — which is the half that can be cleared from here. The
   * generations cannot: they live in each owning service's own database, and
   * reaching `ingestion-service`'s would need a gRPC leg or an offboarding
   * event. That asymmetry is the reason this method clears one half rather than
   * looking like it clears both.
   *
   * Failure is logged and swallowed: an offboarding must not fail because a
   * cache did not answer, and a stale level costs at most one duplicate alert
   * if the tenant is ever restored.
   */
  private async clearLimitAlarmLevels(organizationId: string): Promise<void> {
    try {
      await this.limitAlertRedis.del(...limitAlertStateKeys(organizationId));
    } catch (error) {
      this.logger.warn(
        `Could not clear the limit alarm levels for ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }
  }

  /** Every live session for every member of a tenant. */
  private async revokeAllTenantSessions(
    organizationId: string,
  ): Promise<number> {
    const members = await this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true },
    });

    let revoked = 0;
    for (const member of members) {
      revoked += await this.sessionsService.revokeAllForUser(member.id);
    }

    return revoked;
  }

  /**
   * Loads ANY tenant, deleted included.
   *
   * Deliberately unscoped — that is what this service is for — and deliberately
   * inclusive of soft-deleted rows, since restore and audit both need to reach
   * them.
   */
  private async load(organizationId: string): Promise<OrganizationRow> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: ORGANIZATION_COUNTS,
    });
    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No workspace with that id',
      });
    }

    return organization;
  }

  private async updateOrConflict(
    id: string,
    data: Prisma.OrganizationUpdateInput,
  ): Promise<OrganizationRow> {
    try {
      return await this.prisma.organization.update({
        where: { id },
        data,
        include: ORGANIZATION_COUNTS,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'That slug or domain is already taken',
        });
      }
      throw error;
    }
  }
}

function toPlatformOrganizationResponse(
  row: OrganizationRow,
): PlatformOrganizationResponse {
  return {
    organization: toOrganizationResponse(row),
    userCount: row._count.users,
    pendingInvitationCount: row._count.invitations,
    departmentCount: row._count.departments,
    deletedAt: toProtoTimestamp(row.deletedAt),
  };
}
