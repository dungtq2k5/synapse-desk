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
  OrganizationUsageResponse,
  toTimestamp,
  UpdateOrganizationRequest,
  UpdateOrganizationSettingsRequest,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditResourceType,
  EmailTemplateName,
  InvitationStatus,
  OrgStatus,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditPublisher } from '../audit/audit-publisher.service';
import { SessionsService } from '../sessions/sessions.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import { requireTenant } from '../../common/utils/tenant-scope';
import { isUniqueConstraintViolation } from '../../common/utils/utils';
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
      status: organization.status,
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
   * Three meters (RDM §1.8), two of which belong to domains that do not exist.
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
      billingCycleStart: toTimestamp(organization.billingCycleStart),
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
      status: organization.status,
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
   * Pending invitations reserve a seat (RDM §1.8): counting only active users
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
