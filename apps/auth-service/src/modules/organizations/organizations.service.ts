import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  CompleteOnboardingRequest,
  DeleteOrganizationRequest,
  DeleteOrganizationResponse,
  GetOrganizationStatusRequest,
  OrganizationStatusResponse,
  OnboardingResponse,
  OrganizationResponse,
  OrganizationSettingsResponse,
  ListOrganizationCyclesRequest,
  ListOrganizationCyclesResponse,
  ListOrganizationTimezonesRequest,
  ListOrganizationTimezonesResponse,
  OrganizationEntitlementsResponse,
  OrganizationUsageResponse,
  toProtoTimestamp,
  UpdateOrganizationRequest,
  UpdateOrganizationSettingsRequest,
  toProtoAiModelTier,
  toProtoOrgStatus,
  OrgStatus as ProtoOrgStatus,
  type GetInboundTokenRequest,
  type IssueInboundTokenResponse,
  type RevokeInboundTokenResponse,
  type GetInboundTokenResponse,
  type ResolveOrgByInboundTokenRequest,
  type ResolveOrgByInboundTokenResponse,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditResourceType,
  DEFAULT_PLAN_CATALOG,
  EmailTemplateName,
  InvitationStatus,
  OrgStatus,
  isUniqueConstraintViolation,
  requireTenant,
  generateInboundToken,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditPublisher } from '../audit/audit-publisher.service';
import { SessionsService } from '../sessions/sessions.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import { Organization, Prisma } from '../../generated/prisma/client';
import {
  DOMAIN_PATTERN,
  PUBLIC_EMAIL_DOMAINS,
  SLUG_PATTERN,
} from '../../common/configs/app.config';
import { toOrganizationResponse } from './organization.mapper';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
    private readonly sessionsService: SessionsService,
    private readonly notifications: NotificationPublisher,
  ) {}

  async getCurrentOrganization(
    context: CallerContext,
  ): Promise<OrganizationResponse> {
    return toOrganizationResponse(await this.load(context));
  }

  /**
   * The tenant behind an inbound support address
   *
   * **Absent rather than an exception for an unroutable token**, and the
   * distinction is load-bearing: the caller must drop unroutable mail with a
   * 200 (so the provider stops) while letting an infrastructure failure
   * propagate (so the provider retries). A thrown NOT_FOUND is
   * indistinguishable from auth-service being unreachable, and the two need
   * opposite answers.
   *
   * **No caller context, deliberately.** The webhook has no user — it holds a
   * verified Worker signature. The token is the lookup key and grants nothing
   * beyond naming a tenant, which is why it can be a public mail address.
   *
   * A soft-deleted tenant does not resolve. Mail addressed to a deleted
   * workspace is as unroutable as mail to a token nobody was issued.
   */
  async resolveOrgByInboundToken(
    request: ResolveOrgByInboundTokenRequest,
  ): Promise<ResolveOrgByInboundTokenResponse> {
    const token = request.inboundToken?.trim().toLowerCase();

    // An empty token would otherwise match a row whose column is empty rather
    // than null, which is a routing accident waiting for a bad migration.
    if (!token) {
      return {
        organizationId: undefined,
        status: ProtoOrgStatus.ORG_STATUS_UNSPECIFIED,
      };
    }

    const organization = await this.prisma.organization.findFirst({
      where: { inboundToken: token, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!organization) {
      return {
        organizationId: undefined,
        status: ProtoOrgStatus.ORG_STATUS_UNSPECIFIED,
      };
    }

    // The status travels back so the caller can tell "no such tenant" from
    // "suspended" in its logs. Whether a suspended tenant may receive mail is
    // the caller's decision, not this lookup's.
    return {
      organizationId: organization.id,
      status: toProtoOrgStatus(organization.status),
    };
  }

  /**
   * The tenant's inbound token, for building `Reply-To`.
   *
   * The reverse of `resolveOrgByInboundToken`, and it needs no caller context
   * for the same reason: the token is a public mail address, not a credential.
   */
  async getInboundToken(
    request: GetInboundTokenRequest,
  ): Promise<GetInboundTokenResponse> {
    // Guarded before Prisma, like its two siblings. Without this an empty id
    // reaches the query as `undefined`, Prisma raises a validation error, and
    // Nest wraps it as UNKNOWN — which `GRPC_TO_HTTP` has no entry for, so the
    // gateway answers 500 where it should answer 401. `contract.e2e-spec.ts`
    // bounds that class of handler, and this one does not need to join them.
    if (!request.organizationId) return { inboundToken: undefined };

    const organization = await this.prisma.organization.findFirst({
      where: { id: request.organizationId, deletedAt: null },
      select: { inboundToken: true },
    });

    return { inboundToken: organization?.inboundToken ?? undefined };
  }

  /**
   * Issues the tenant's inbound-mail token, or ROTATES an existing one
   *
   * **One method for both, because they differ only in whether a row already
   * had a value.** Rotation is one of the three properties §2 chose an opaque
   * token over a slug for — *an abused address can be rotated without touching
   * anything else* — and it is the property nothing could exercise until this
   * existed: the column was writable by hand-editing a row and by nothing else,
   * so every tenant was permanently unable to receive mail.
   *
   * **The old address stops routing immediately**, which is the point of a
   * rotation and also its cost: mail already in flight to it is dropped as
   * unroutable. That is the correct trade for an address being abused, and it
   * is why this is a deliberate action rather than something a rename does as a
   * side effect.
   */
  async issueInboundToken(
    context: CallerContext,
  ): Promise<IssueInboundTokenResponse> {
    const existing = await this.load(context);
    const inboundToken = generateInboundToken();

    await this.prisma.organization.update({
      where: { id: existing.id },
      data: { inboundToken },
    });

    this.audit.record(context, {
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: existing.id,
      // **The token itself is not recorded, and neither is the old one.** It is
      // not a secret (customers email it), but an audit log is the wrong place
      // to keep a copy of an address somebody rotated precisely to stop using.
      metadata: {
        after: { inboundEmail: existing.inboundToken ? 'rotated' : 'enabled' },
      },
    });

    return { inboundToken };
  }

  /**
   * Switches inbound mail off
   *
   * Sets NULL rather than deleting anything, which returns the tenant to the
   * state one that never enabled email is already in. Idempotent: revoking
   * twice is not an error, because the caller's intent is satisfied either way.
   */
  async revokeInboundToken(
    context: CallerContext,
  ): Promise<RevokeInboundTokenResponse> {
    const existing = await this.load(context);

    if (existing.inboundToken) {
      await this.prisma.organization.update({
        where: { id: existing.id },
        data: { inboundToken: null },
      });

      this.audit.record(context, {
        action: AuditAction.ORGANIZATION_UPDATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: existing.id,
        metadata: { after: { inboundEmail: 'disabled' } },
      });
    }

    return {};
  }

  /**
   * The lifecycle gate's lookup, by id and unscoped.
   *
   * Unscoped deliberately: the gateway calls it with the organization id from
   * the JWT it has just verified, so the caller is asking about their OWN
   * tenant by construction. Adding `tenantScope` here would be circular — the
   * gate runs to decide whether that tenant may proceed at all.
   *
   * Returns the raw status plus a separate `deleted` flag. Collapsing them
   * would hide an offboarded tenant whose status still reads ACTIVE.
   */
  async getOrganizationStatus(
    request: GetOrganizationStatusRequest,
  ): Promise<OrganizationStatusResponse> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: request.organizationId },
      select: { status: true, deletedAt: true },
    });
    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }

    return {
      status: toProtoOrgStatus(organization.status),
      deleted: organization.deletedAt !== null,
    };
  }

  /**
   * Profile only. Quotas are NOT settable here — a tenant raising its own seat
   * limit is the whole billing model gone, so those live behind `/platform/*`.
   */
  async updateOrganization(
    request: UpdateOrganizationRequest,
    context: CallerContext,
  ): Promise<OrganizationResponse> {
    const existing = await this.load(context);

    const data: Prisma.OrganizationUpdateInput = {};
    if (request.name !== undefined) data.name = request.name.trim();

    if (request.slug !== undefined) {
      const slug = request.slug.trim().toLowerCase();
      if (!SLUG_PATTERN.test(slug)) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message:
            'Slug may contain only lowercase letters, numbers and single hyphens',
        });
      }
      data.slug = slug;
    }

    // Empty clears it. `domain` is globally unique, so two tenants cannot claim
    // one — hence the conflict handling below rather than a pre-check.
    if (request.domain !== undefined) {
      const domain = request.domain.trim().toLowerCase();
      if (domain && !DOMAIN_PATTERN.test(domain)) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: `'${domain}' is not a valid domain`,
        });
      }
      data.domain = domain || null;
    }

    const organization = await this.conflictOnDuplicate(() =>
      this.prisma.organization.update({
        where: { id: existing.id },
        data,
      }),
    );

    this.audit.record(context, {
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organization.id,
      metadata: {
        before: {
          name: existing.name,
          slug: existing.slug,
          domain: existing.domain,
        },
        after: {
          name: organization.name,
          slug: organization.slug,
          domain: organization.domain,
        },
      },
    });

    return toOrganizationResponse(organization);
  }

  async getOrganizationSettings(
    context: CallerContext,
  ): Promise<OrganizationSettingsResponse> {
    const organization = await this.load(context);

    return {
      enforceTwoFactor: organization.enforceTwoFactor,
      allowedEmailDomains: organization.allowedEmailDomains,
      // Only a WRITE can introduce a questionable domain, so a read reports none.
      publicDomainWarnings: [],
    };
  }

  /**
   * The two security-relevant tenant settings.
   *
   * **`enforce_two_factor` does not retroactively enrol anyone.** It changes
   * what the NEXT login demands: a member without a second factor is issued an
   * enrolment challenge (`requiresTwoFactorSetup`) rather than a code prompt.
   * That path has to exist before this toggle is reachable, or turning it on
   * locks out every un-enrolled member including the admin who did it — see
   * `TwoFactorEnrolmentGuard` in the gateway.
   *
   * Every admin is emailed, because a silent 2FA-policy change is
   * indistinguishable from an attacker with an admin session.
   */
  async updateOrganizationSettings(
    request: UpdateOrganizationSettingsRequest,
    context: CallerContext,
  ): Promise<OrganizationSettingsResponse> {
    const existing = await this.load(context);

    const data: Prisma.OrganizationUpdateInput = {};
    if (request.enforceTwoFactor !== undefined) {
      data.enforceTwoFactor = request.enforceTwoFactor;
    }

    const warnings: string[] = [];
    // A repeated field arrives as [] whether the caller sent an empty list or
    // omitted it entirely, so an explicit flag is the only way to tell "clear
    // the domains" from "do not touch them".
    if (request.replaceAllowedEmailDomains) {
      data.allowedEmailDomains = this.normalizeDomains(
        request.allowedEmailDomains,
        warnings,
      );
    }

    const organization = await this.prisma.organization.update({
      where: { id: existing.id },
      data,
    });

    this.audit.record(context, {
      action: AuditAction.ORGANIZATION_SETTINGS_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organization.id,
      metadata: {
        before: {
          enforceTwoFactor: existing.enforceTwoFactor,
          allowedEmailDomains: existing.allowedEmailDomains,
        },
        after: {
          enforceTwoFactor: organization.enforceTwoFactor,
          allowedEmailDomains: organization.allowedEmailDomains,
        },
      },
    });

    if (organization.enforceTwoFactor !== existing.enforceTwoFactor) {
      await this.alertAdmins(
        organization.id,
        'Two-factor authentication policy changed',
        organization.enforceTwoFactor
          ? 'Two-factor authentication is now REQUIRED for everyone in this workspace. Members without it will be asked to enrol at their next sign-in.'
          : 'Two-factor authentication is no longer required for this workspace. Members who enrolled keep their second factor.',
        context,
      );
    }

    return {
      enforceTwoFactor: organization.enforceTwoFactor,
      allowedEmailDomains: organization.allowedEmailDomains,
      publicDomainWarnings: warnings,
    };
  }

  /**
   * Three meters (RDM), two of which belong to domains that do not exist.
   *
   * Those report `available: false` with no number rather than 0 — a zero reads
   * as "you have used nothing", which is a claim we cannot make.
   */
  async getOrganizationUsage(
    context: CallerContext,
  ): Promise<OrganizationUsageResponse> {
    const organization = await this.load(context);
    const seatsUsed = await this.seatsInUse(this.prisma, organization.id);

    return {
      // The PLAN, alongside the meters This is the page a
      // customer opens when they hit a limit, and a limit with no plan beside
      // it is a number they cannot act on: the next question is always "what
      // would I get if I upgraded", and answering it on a different page means
      // a second load at the moment someone is already blocked.
      aiModelTier: toProtoAiModelTier(organization.aiModelTier),
      planName: planLabelFor(organization),
      currentPeriodEnd: undefined,
      seats: {
        available: true,
        used: seatsUsed,
        limit: organization.maxAgentSeats,
      },
      storage: {
        available: false,
        unavailableReason:
          'Document storage is not enabled for this workspace yet',
      },
      aiTokens: {
        available: false,
        unavailableReason:
          'AI usage metering is not enabled for this workspace yet',
      },
      billingCycleStart: toProtoTimestamp(organization.billingCycleStart),
    };
  }

  /**
   * Everything a spending service needs to gate a request
   *
   * `ingestion-service` and `rag-service` both need the tier AND the quota
   * columns, and neither may read `postgres_auth` directly (RDM §1.13). This is
   * the one call that answers both, and callers CACHE it against
   * `billing.entitlements_changed` — so it is a cache fill rather than a
   * per-request read, which is what keeps a third-party-shaped dependency off
   * the hot path of every AI question.
   *
   * Deliberately NOT `getCurrentOrganization`. That returns a tenant's name,
   * slug, allowed email domains and onboarding state, none of which a quota
   * gate reads — and shipping them on every cache fill invites a caller to
   * start depending on a field that has nothing to do with entitlements.
   */
  async getOrganizationEntitlements(
    context: CallerContext,
  ): Promise<OrganizationEntitlementsResponse> {
    const organization = await this.load(context);

    return {
      maxAgentSeats: organization.maxAgentSeats,
      maxStorageBytes: Number(organization.maxStorageBytes),
      monthlyAiTokenBudget: Number(organization.monthlyAiTokenBudget),
      aiModelTier: toProtoAiModelTier(organization.aiModelTier),
      // The quota window, and its EPOCH is inside the Redis counter key — so a
      // caller reading a different value from this one would meter into a key
      // nothing else reads, and the tenant would appear to have spent nothing.
      billingCycleStart: toProtoTimestamp(organization.billingCycleStart),
      status: toProtoOrgStatus(organization.status),
    };
  }

  /**
   * Tenant timezones, in BULK
   *
   * **Service-to-service, with no actor.** The daily rollup jobs run across
   * every tenant that had activity, not on behalf of a caller, so the ids are a
   * FIELD rather than something read from metadata — the same shape
   * `listPermissionHolders` takes and for the same reason.
   *
   * Answers many at once: one round trip per rollup run rather than one per
   * tenant. A job that made a gRPC call per tenant would spend more time
   * resolving timezones than aggregating.
   *
   * An unknown id is simply absent from the response rather than an error: a
   * tenant deleted between the job reading its own tables and asking here is an
   * ordinary race, and failing the whole run over it would lose every other
   * tenant's rollup.
   */
  async listOrganizationTimezones(
    request: ListOrganizationTimezonesRequest,
  ): Promise<ListOrganizationTimezonesResponse> {
    const ids = [...new Set((request.organizationIds ?? []).filter(Boolean))];
    // An empty ask is a valid question with an empty answer, not an error: a
    // run over a quiet window has no tenants to resolve.
    if (ids.length === 0) return { items: [] };

    const organizations = await this.prisma.organization.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, timezone: true },
    });

    return {
      items: organizations.map((organization) => ({
        organizationId: organization.id,
        // `?? undefined`, not `?? 'UTC'`: the DEFAULT belongs to the consumer,
        // which already has to handle an id that came back missing entirely.
        // Defaulting in two places is how they eventually disagree.
        timezone: organization.timezone ?? undefined,
      })),
    };
  }

  /**
   * Every tenant's BILLING CYCLE START, in bulk
   *
   * **The read that makes per-tenant quota reconciliation possible.** The cycle
   * start differs per tenant, so a sweep that assumed one would reconcile
   * everybody against whichever tenant's cycle it happened to pick — and since
   * `QuotaCounterService` keys on `quota:{org}:{cycleStartEpoch}`, the
   * correction would land under a key the gate never reads while leaving the
   * real one untouched. Reconciliation that reports success and fixes nothing.
   *
   * Same shape and same reasoning as `listOrganizationTimezones`: no actor,
   * ids as a field, unknown ids simply absent.
   */
  async listOrganizationCycles(
    request: ListOrganizationCyclesRequest,
  ): Promise<ListOrganizationCyclesResponse> {
    const ids = [...new Set((request.organizationIds ?? []).filter(Boolean))];
    if (ids.length === 0) return { items: [] };

    const organizations = await this.prisma.organization.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, billingCycleStart: true },
    });

    return {
      items: organizations.map((organization) => ({
        organizationId: organization.id,
        // Absent rather than defaulted, deliberately — see the proto note. A
        // caller that silently substituted the epoch would reconcile against
        // "spend since 1970", which sums every cycle the tenant has ever had.
        billingCycleStart: organization.billingCycleStart
          ? toProtoTimestamp(organization.billingCycleStart)
          : undefined,
      })),
    };
  }

  /**
   * Derived LIVE from the data, never stored.
   *
   * A stored checklist drifts from reality the moment someone deletes the
   * department they just created, and then shows a tick beside something that
   * is no longer true.
   */
  async getOnboarding(context: CallerContext): Promise<OnboardingResponse> {
    const organization = await this.load(context);

    const [departmentCount, memberCount, verifiedAdminCount] =
      await Promise.all([
        this.prisma.department.count({
          where: { organizationId: organization.id, deletedAt: null },
        }),
        this.prisma.user.count({
          where: { organizationId: organization.id, deletedAt: null },
        }),
        this.prisma.user.count({
          where: {
            organizationId: organization.id,
            deletedAt: null,
            isEmailVerified: true,
          },
        }),
      ]);

    const steps = [
      {
        key: 'verify_email',
        label: 'Verify an administrator email address',
        complete: verifiedAdminCount > 0,
      },
      {
        key: 'create_department',
        label: 'Create your first department',
        complete: departmentCount > 0,
      },
      {
        key: 'invite_team',
        label: 'Invite a colleague',
        complete: memberCount > 1,
      },
    ];

    return {
      steps,
      // Only from PENDING_ONBOARDING, and only once every step is done.
      // `String(...)` because `organizations.status` is a plain VarChar while
      // OrgStatus is a TS enum — the enum's VALUE is deliberately the column's
      // contents, but comparing them directly is an unsafe-enum comparison.
      canComplete:
        organization.status === String(OrgStatus.PENDING_ONBOARDING) &&
        steps.every((step) => step.complete),
      status: toProtoOrgStatus(organization.status),
    };
  }

  /**
   * PENDING_ONBOARDING -> ACTIVE, and nothing else.
   *
   * **409 from any other status.** This must not un-freeze a FROZEN tenant or
   * revive a SUSPENDED_PAST_DUE one — those transitions are the platform's to
   * make, and letting a tenant admin reach them through the onboarding button
   * would make suspension advisory.
   */
  async completeOnboarding(
    _request: CompleteOnboardingRequest,
    context: CallerContext,
  ): Promise<OrganizationResponse> {
    const existing = await this.load(context);

    if (existing.status !== String(OrgStatus.PENDING_ONBOARDING)) {
      throw new RpcException({
        code: status.ABORTED,
        message: `This workspace is ${existing.status}, not pending onboarding`,
      });
    }

    const organization = await this.prisma.organization.update({
      where: { id: existing.id },
      data: { status: OrgStatus.ACTIVE },
    });

    this.audit.record(context, {
      action: AuditAction.ORGANIZATION_ONBOARDING_COMPLETED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organization.id,
      metadata: { from: existing.status, to: organization.status },
    });

    return toOrganizationResponse(organization);
  }

  /**
   * Requests offboarding: soft-deletes the tenant and cuts off access now.
   *
   * Child rows are deliberately NOT soft-deleted with it. That would be a large
   * write for no gain — `tenantScope` already excludes rows whose organization
   * is gone, and login checks organization status — whereas cascading marks
   * would have to be undone one by one if the tenant changes its mind.
   *
   * Sessions ARE revoked, because access must stop at the moment of the
   * request rather than whenever each access token happens to expire.
   *
   * A Super Admin still has to finalise it: self-service tenant deletion with
   * no cooling-off is a support incident waiting to happen, so this records the
   * intent and stops access, and the platform does the irreversible part.
   */
  async deleteOrganization(
    request: DeleteOrganizationRequest,
    context: CallerContext,
  ): Promise<DeleteOrganizationResponse> {
    const existing = await this.load(context);

    const members = await this.prisma.user.findMany({
      where: { organizationId: existing.id, deletedAt: null },
      select: { id: true },
    });

    await this.prisma.organization.update({
      where: { id: existing.id },
      // FROZEN rather than a `deleted_at` stamp: the row must stay resolvable
      // for the platform to finalise or reverse, and FROZEN is the status the
      // rest of the system already reads as "no access".
      data: { status: OrgStatus.FROZEN },
    });

    let revokedSessionCount = 0;
    for (const member of members) {
      revokedSessionCount += await this.sessionsService.revokeAllForUser(
        member.id,
      );
    }

    this.audit.record(context, {
      action: AuditAction.ORGANIZATION_OFFBOARD_REQUESTED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: existing.id,
      metadata: {
        reason: request.reason,
        memberCount: members.length,
        revokedSessionCount,
      },
    });

    return { revokedSessionCount };
  }

  /**
   * Seats used: active members PLUS pending invitations.
   *
   * THE definition, owned here because a seat is an organization-level quota.
   * It previously existed twice — once in InvitationsService and once in
   * UsersService — which is how an invite gets rejected by a counter the usage
   * page says has room.
   *
   * Pending invitations reserve a seat (RDM): counting only active users
   * would let an admin send 50 invites against 10 seats and blow the quota the
   * moment they were accepted. Expiry is what releases a reservation.
   *
   * Takes a client rather than using `this.prisma` so a caller inside a
   * transaction counts through the same connection — otherwise the seat check
   * and the insert it guards see different snapshots.
   */
  async seatsInUse(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
  ): Promise<number> {
    const [active, pending] = await Promise.all([
      client.user.count({ where: { organizationId, deletedAt: null } }),
      client.userInvitation.count({
        where: {
          organizationId,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
      }),
    ]);

    return active + pending;
  }

  /**
   * Free-mail domains are flagged, not rejected.
   *
   * The list can never be exhaustive, so treating it as authoritative would
   * block legitimate niche providers while still missing others. A warning the
   * admin actually reads is worth more than a blocklist that pretends.
   */
  private normalizeDomains(domains: string[], warnings: string[]): string[] {
    const normalized = [
      ...new Set(domains.map((domain) => domain.trim().toLowerCase())),
    ].filter(Boolean);

    for (const domain of normalized) {
      if (!DOMAIN_PATTERN.test(domain)) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: `'${domain}' is not a valid domain`,
        });
      }
      if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
        warnings.push(domain);
      }
    }

    return normalized;
  }

  /** Everyone who could have made this change should hear that it happened. */
  private async alertAdmins(
    organizationId: string,
    headline: string,
    detail: string,
    context: CallerContext,
  ): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        roles: {
          some: { permissions: { some: { code: 'organization.update' } } },
        },
      },
      select: { email: true, fullName: true },
    });

    for (const admin of admins) {
      this.notifications.sendEmail({
        template: EmailTemplateName.SECURITY_ALERT,
        to: admin.email,
        data: {
          fullName: admin.fullName,
          headline,
          detail,
          origin: { ip: context.ip, userAgent: context.userAgent },
        },
      });
    }
  }

  /** Always the caller's own tenant, resolved from the verified context. */
  private async load(context: CallerContext): Promise<Organization> {
    const organizationId = requireTenant(context);

    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
    });
    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }

    return organization;
  }

  private async conflictOnDuplicate<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
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

/**
 * A display label derived from the TIER, never stored.
 *
 * Storing a plan name would be the mirroring RDM §1.15 refuses: it diverges the
 * first time someone renames a product in the Stripe dashboard, silently,
 * because both sides keep answering confidently. Deriving it is approximate —
 * two plans can share a tier — and that is fine for a LABEL. It would not be
 * fine for anything that made a decision, and nothing does.
 */
function planLabelFor(organization: {
  aiModelTier: string;
  stripeSubscriptionId: string | null;
}): string {
  if (!organization.stripeSubscriptionId) return 'Free';

  const match = Object.values(DEFAULT_PLAN_CATALOG).find(
    (plan) => plan.aiModelTier === organization.aiModelTier,
  );

  return match?.displayName ?? organization.aiModelTier;
}
