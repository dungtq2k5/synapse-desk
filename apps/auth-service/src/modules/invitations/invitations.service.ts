import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { isEmail } from 'class-validator';
import * as bcrypt from 'bcrypt';
import {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationsRequest,
  CreateInvitationsResponse,
  ExpireStaleInvitationsResponse,
  fromProtoInvitationStatus,
  InvitationIdRequest,
  InvitationResponse,
  ListInvitationsRequest,
  CallerContext,
  GetInvitationRequest,
  ListInvitationsResponse,
  PreviewInvitationsRequest,
  PreviewInvitationsResponse,
  PreviewInvitationRequest,
  PreviewInvitationResponse,
  RevokeInvitationResponse,
  toPageMeta,
  toProtoInvitationStatus,
  toTimestamp,
  emptyPage,
  toPrismaPage,
  toSearchFilter,
} from '@synapsedesk/grpc-proto';
import {
  EmailTemplateName,
  INVITATION_SORTABLE_FIELDS,
  InvitationStatus,
  OrgStatus,
  RequestOrigin,
  WEB_ROUTES,
  isUniqueConstraintViolation,
  normalizeEmail,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { RolesService } from '../roles/roles.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import {
  addDays,
  generateSecureToken,
  hashToken,
  maskEmail,
  stripTrailingSlashes,
} from '../../common/utils/utils';
import { Prisma, UserInvitation } from '../../generated/prisma/client';

/**
 * Tenant states in which joining is permitted.
 *
 * A Set, not an array: membership is the only question ever asked of it, and
 * `has()` says that at the call site where `includes()` reads as a scan.
 */
const JOINABLE_ORG_STATUSES: ReadonlySet<string> = new Set([
  OrgStatus.ACTIVE,
  OrgStatus.PENDING_ONBOARDING,
]);

/**
 * Tokenized offers of tenant membership.
 *
 * Invitations exist mainly to onboard people whose email domain does NOT match
 * the tenant — a contractor at `agency.com` joining `acme.com`. That only works
 * because email uniqueness is per-tenant: under a global constraint such a
 * person could never hold a second account.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  private readonly INVITATION_TTL_DAYS: number;
  private readonly BCRYPT_ROUNDS: number;
  private readonly APP_WEB_URL: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationPublisher,
    private readonly authService: AuthService,
    private readonly rolesService: RolesService,
    private readonly organizationsService: OrganizationsService,
  ) {
    this.INVITATION_TTL_DAYS = this.configService.getOrThrow<number>(
      'INVITATION_TTL_DAYS',
    );
    this.BCRYPT_ROUNDS = this.configService.getOrThrow<number>('BCRYPT_ROUNDS');
    this.APP_WEB_URL = stripTrailingSlashes(
      this.configService.getOrThrow<string>('APP_WEB_URL'),
    );
  }

  /**
   * Creates a batch. Per-address outcomes, never all-or-nothing.
   *
   * One malformed address in a 200-row paste must not discard the other 199,
   * so each is attempted independently and failures are reported alongside the
   * successes. The caller turns that into a 207.
   */
  async createInvitations(
    request: CreateInvitationsRequest,
    origin: RequestOrigin,
  ): Promise<CreateInvitationsResponse> {
    const inviter = await this.prisma.user.findFirst({
      where: {
        id: request.invitedById,
        organizationId: request.organizationId,
        deletedAt: null,
      },
      select: { fullName: true },
    });
    if (!inviter) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Inviter does not belong to this organization',
      });
    }

    const organization = await this.prisma.organization.findFirst({
      where: { id: request.organizationId, deletedAt: null },
      select: { id: true, name: true, maxAgentSeats: true },
    });
    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }

    // One batch id for the whole paste, so the import can be reported on as a
    // unit later.
    const batchId = crypto.randomUUID();
    const created: InvitationResponse[] = [];
    const failed: { email: string; reason: string }[] = [];

    for (const input of request.invitations) {
      const email = normalizeEmail(input.email);

      try {
        const invitation = await this.createOne({
          organizationId: organization.id,
          organizationName: organization.name,
          maxAgentSeats: organization.maxAgentSeats,
          inviterName: inviter.fullName,
          invitedById: request.invitedById,
          batchId,
          email,
          input,
          origin,
        });

        created.push(this.toResponse(invitation, inviter.fullName));
      } catch (error) {
        failed.push({ email, reason: this.describeFailure(error) });
      }
    }

    return { created, failed, batchId };
  }

  private async createOne(context: {
    organizationId: string;
    organizationName: string;
    maxAgentSeats: number;
    inviterName: string;
    invitedById: string;
    batchId: string;
    email: string;
    input: CreateInvitationsRequest['invitations'][number];
    origin: RequestOrigin;
  }): Promise<UserInvitation> {
    const rawToken = generateSecureToken();

    const invitation = await this.prisma.$transaction(async (tx) => {
      // Already a member of THIS tenant. The same address in another tenant is
      // fine and is the whole point of the feature.
      const existingUser = await tx.user.findFirst({
        where: {
          email: context.email,
          organizationId: context.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingUser) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'That address already has an account here',
        });
      }

      if (
        (await this.organizationsService.seatsInUse(
          tx,
          context.organizationId,
        )) >= context.maxAgentSeats
      ) {
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: 'No seats remaining on this plan',
        });
      }

      return tx.userInvitation.create({
        data: {
          organizationId: context.organizationId,
          email: context.email,
          tokenHash: hashToken(rawToken),
          roleIds: context.input.roleIds,
          departmentIds: context.input.departmentIds,
          primaryDepartmentId: context.input.primaryDepartmentId,
          invitedById: context.invitedById,
          batchId: context.batchId,
          expiresAt: addDays(new Date(), this.INVITATION_TTL_DAYS),
        },
      });
    });

    const roleNames = await this.resolveRoleNames(invitation.roleIds);

    // The RAW token leaves the service exactly here, in a link. Only its hash
    // is stored.
    this.notifications.sendEmail({
      template: EmailTemplateName.INVITATION,
      to: invitation.email,
      data: {
        organizationName: context.organizationName,
        inviterName: context.inviterName,
        roleNames,
        acceptUrl: this.acceptUrl(rawToken),
        expiresAt: invitation.expiresAt.toISOString(),
        origin: context.origin,
      },
    });

    return invitation;
  }

  async listInvitations(
    request: ListInvitationsRequest,
  ): Promise<ListInvitationsResponse> {
    const statusFilter = request.status
      ? fromProtoInvitationStatus(request.status)
      : null;

    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      INVITATION_SORTABLE_FIELDS,
    );
    const search = toSearchFilter(page.searchTerm);

    const where: Prisma.UserInvitationWhereInput = {
      organizationId: request.organizationId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(search ? { email: search } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.userInvitation.findMany({
        where,
        include: { invitedBy: { select: { fullName: true } } },
        orderBy,
        skip,
        take,
      }),
      this.prisma.userInvitation.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        this.toResponse(item, item.invitedBy?.fullName ?? null),
      ),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * Dry run. Validates the whole batch and reports what WOULD happen.
   *
   * No writes and no mail — which is the point: for a 200-row paste this turns
   * a partially-failed import into a reviewable list. Every check the real
   * create performs is repeated here, so a row reported OK is one that would
   * actually be created (barring a race in between).
   */
  async previewInvitations(
    request: PreviewInvitationsRequest,
    context: CallerContext,
  ): Promise<PreviewInvitationsResponse> {
    const organizationId = requireTenant(context);

    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { maxAgentSeats: true },
    });
    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }

    const seatsInUse = await this.organizationsService.seatsInUse(
      this.prisma,
      organizationId,
    );

    const emails = request.invitations.map((input) =>
      normalizeEmail(input.email),
    );

    // Three bulk reads rather than three per row: a 200-row paste would
    // otherwise be 600 queries.
    const [existingUsers, pendingInvites, roles, departments] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { email: { in: emails }, organizationId, deletedAt: null },
          select: { email: true },
        }),
        this.prisma.userInvitation.findMany({
          where: {
            email: { in: emails },
            organizationId,
            status: InvitationStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          select: { email: true },
        }),
        this.prisma.role.findMany({
          where: {
            OR: [
              { organizationId },
              { organizationId: null, isSystemRole: true },
            ],
          },
          select: { id: true },
        }),
        this.prisma.department.findMany({
          where: { organizationId, deletedAt: null },
          select: { id: true },
        }),
      ]);

    const taken = new Set(existingUsers.map((user) => user.email));
    const pending = new Set(pendingInvites.map((invite) => invite.email));
    const liveRoleIds = new Set(roles.map((role) => role.id));
    const liveDepartmentIds = new Set(
      departments.map((department) => department.id),
    );

    // Duplicates WITHIN the paste are a distinct failure from "already
    // invited", and the commonest one in a spreadsheet export.
    const seen = new Set<string>();
    let okCount = 0;

    const rows = request.invitations.map((input, index) => {
      const email = emails[index];
      const unknownRoleIds = input.roleIds.filter((id) => !liveRoleIds.has(id));
      const unknownDepartmentIds = input.departmentIds.filter(
        (id) => !liveDepartmentIds.has(id),
      );

      let reason: string | undefined;
      if (!isEmail(email)) {
        reason = 'Not a valid email address';
      } else if (seen.has(email)) {
        reason = 'Duplicated within this batch';
      } else if (taken.has(email)) {
        reason = 'Already has an account here';
      } else if (pending.has(email)) {
        reason = 'An invitation is already pending';
      }
      seen.add(email);

      const ok = reason === undefined;
      if (ok) okCount++;

      return {
        email,
        ok,
        reason,
        // Reported even on an OK row: unresolvable ids are SKIPPED at
        // redemption rather than fatal, so the caller should still see them.
        unknownRoleIds,
        unknownDepartmentIds,
      };
    });

    const remaining = Math.max(0, organization.maxAgentSeats - seatsInUse);

    return {
      rows,
      seatsInUse,
      maxAgentSeats: organization.maxAgentSeats,
      seatOverrun: Math.max(0, okCount - remaining),
    };
  }

  /**
   * Administrative detail for one invitation.
   *
   * Tenant-scoped and unmasked, unlike `previewInvitation` which is the public
   * by-token lookup. Any status, not just PENDING — an admin asking "what
   * happened to that invite?" needs to see the revoked and expired ones.
   */
  async getInvitation(
    request: GetInvitationRequest,
  ): Promise<InvitationResponse> {
    const invitation = await this.prisma.userInvitation.findFirst({
      where: {
        id: request.invitationId,
        organizationId: request.organizationId,
      },
      include: { invitedBy: { select: { fullName: true } } },
    });
    if (!invitation) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No invitation with that id',
      });
    }

    return this.toResponse(invitation, invitation.invitedBy?.fullName ?? null);
  }

  /**
   * Rotates the token: the OLD link dies immediately.
   *
   * Same rule as password reset — two live links for one invitation doubles the
   * window in which a leaked one works.
   */
  async resendInvitation(
    request: InvitationIdRequest,
    origin: RequestOrigin,
  ): Promise<InvitationResponse> {
    const invitation = await this.loadPending(
      request.invitationId,
      request.organizationId,
    );

    const rawToken = generateSecureToken();

    const updated = await this.prisma.userInvitation.update({
      where: { id: invitation.id },
      data: {
        tokenHash: hashToken(rawToken),
        resentCount: { increment: 1 },
        lastSentAt: new Date(),
        expiresAt: addDays(new Date(), this.INVITATION_TTL_DAYS),
      },
      include: {
        organization: { select: { name: true } },
        invitedBy: { select: { fullName: true } },
      },
    });

    this.notifications.sendEmail({
      template: EmailTemplateName.INVITATION,
      to: updated.email,
      data: {
        organizationName: updated.organization.name,
        inviterName: updated.invitedBy?.fullName ?? 'A colleague',
        roleNames: await this.resolveRoleNames(updated.roleIds),
        acceptUrl: this.acceptUrl(rawToken),
        expiresAt: updated.expiresAt.toISOString(),
        origin,
      },
    });

    return this.toResponse(updated, updated.invitedBy?.fullName ?? null);
  }

  async revokeInvitation(
    request: InvitationIdRequest,
  ): Promise<RevokeInvitationResponse> {
    const invitation = await this.loadPending(
      request.invitationId,
      request.organizationId,
    );

    await this.prisma.userInvitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.REVOKED,
        revokedById: request.actorId,
        revokedAt: new Date(),
      },
    });

    return {};
  }

  /**
   * PUBLIC preview so the invitee can see who invited them before committing.
   *
   * Never throws for an unusable token: `valid: false` covers expired, revoked,
   * already-accepted and never-existed alike, so the endpoint cannot be used to
   * distinguish them.
   */
  async previewInvitation(
    request: PreviewInvitationRequest,
  ): Promise<PreviewInvitationResponse> {
    const invitation = await this.prisma.userInvitation.findFirst({
      where: {
        tokenHash: hashToken(request.token),
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: {
        organization: { select: { name: true } },
        invitedBy: { select: { fullName: true } },
      },
    });
    if (!invitation) return { valid: false, roleNames: [] };

    return {
      valid: true,
      organizationName: invitation.organization.name,
      inviterName: invitation.invitedBy?.fullName ?? undefined,
      // Masked: the legitimate holder already knows the address, and a guesser
      // must not learn one.
      email: maskEmail(invitation.email),
      roleNames: await this.resolveRoleNames(invitation.roleIds),
      expiresAt: toTimestamp(invitation.expiresAt),
    };
  }

  /**
   * Redeems an invitation: creates the account, applies the proposals, and
   * signs the invitee in.
   *
   * Everything is RE-CHECKED here rather than trusted from creation time. Up to
   * seven days pass in between, during which seats can fill, the tenant can be
   * frozen, the address can register directly, and roles can be deleted.
   */
  async acceptInvitation(
    request: AcceptInvitationRequest,
    origin: RequestOrigin,
  ): Promise<AcceptInvitationResponse> {
    const passwordHash = await bcrypt.hash(
      request.password,
      this.BCRYPT_ROUNDS,
    );
    const skipped: string[] = [];

    try {
      const userId = await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.userInvitation.findFirst({
          where: {
            tokenHash: hashToken(request.token),
            status: InvitationStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          include: {
            organization: {
              select: { id: true, status: true, maxAgentSeats: true },
            },
          },
        });
        // 410-shaped: used, revoked, expired and unknown are deliberately
        // indistinguishable.
        if (!invitation) {
          throw new RpcException({
            code: status.FAILED_PRECONDITION,
            message: 'This invitation is no longer valid',
          });
        }

        // The tenant lifecycle gate permits auth-only traffic on a FROZEN
        // tenant, and joining one is not auth.
        if (!JOINABLE_ORG_STATUSES.has(invitation.organization.status)) {
          throw new RpcException({
            code: status.PERMISSION_DENIED,
            message: 'This workspace is not accepting new members',
          });
        }

        if (
          (await this.organizationsService.seatsInUse(
            tx,
            invitation.organizationId,
          )) >= invitation.organization.maxAgentSeats
        ) {
          throw new RpcException({
            code: status.RESOURCE_EXHAUSTED,
            message: 'This workspace has no seats remaining',
          });
        }

        // They may have registered directly since the invite was sent.
        const existing = await tx.user.findFirst({
          where: {
            email: invitation.email,
            organizationId: invitation.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) {
          throw new RpcException({
            code: status.ALREADY_EXISTS,
            message: 'That address already has an account here',
          });
        }

        // Proposals are validated against live rows. Anything that no longer
        // resolves is SKIPPED and reported — a department deleted on day 3 must
        // not strand a legitimate invitee on day 6.
        const roles = await tx.role.findMany({
          where: {
            id: { in: invitation.roleIds },
            OR: [
              { organizationId: invitation.organizationId },
              { organizationId: null },
            ],
          },
          select: { id: true },
        });
        const departments = await tx.department.findMany({
          where: {
            id: { in: invitation.departmentIds },
            organizationId: invitation.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });

        const liveRoleIds = new Set(roles.map((role) => role.id));
        const liveDepartmentIds = new Set(
          departments.map((department) => department.id),
        );
        skipped.push(
          ...invitation.roleIds.filter((id) => !liveRoleIds.has(id)),
          ...invitation.departmentIds.filter(
            (id) => !liveDepartmentIds.has(id),
          ),
        );

        const user = await tx.user.create({
          data: {
            organizationId: invitation.organizationId,
            email: invitation.email,
            fullName: request.fullName,
            passwordHash,
            // Delivery to the address IS the ownership proof — the same one
            // `otps` provides. A second challenge would be theatre.
            isEmailVerified: true,
          },
          select: { id: true },
        });

        // Through RolesService rather than a `roles: { connect }` above,
        // because `roles.user_assigned` is a denormalized counter that must be
        // bumped in the SAME transaction as the junction write. Connecting
        // inline left the count short by one on every accepted invitation —
        // and that count is what gates DELETE /roles/:id.
        await this.rolesService.grantRoles(tx, user.id, [...liveRoleIds]);

        if (liveDepartmentIds.size > 0) {
          await tx.userDepartment.createMany({
            data: [...liveDepartmentIds].map((departmentId) => ({
              userId: user.id,
              departmentId,
              isPrimary: departmentId === invitation.primaryDepartmentId,
              assignedById: invitation.invitedById,
            })),
          });
        }

        await tx.userInvitation.update({
          where: { id: invitation.id },
          data: {
            status: InvitationStatus.ACCEPTED,
            acceptedAt: new Date(),
            acceptedUserId: user.id,
          },
        });

        return user.id;
      });

      // The invitee lands signed in rather than at a login form.
      const user = await this.authService.loadUserForAuth(userId);
      const session = await this.authService.issueSession(user, {
        name: request.deviceName,
        ...origin,
      });

      return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: session.user,
        skipped,
      };
    } catch (error) {
      // The pre-checks above (address free, seats available) handle the normal
      // case. This handles the RACE they cannot: two concurrent accepts both
      // read "free" and both insert. Only users_org_email_key makes that
      // impossible, and this turns the loser's violation into the same conflict.
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'That address already has an account here',
        });
      }
      throw error;
    }
  }

  /**
   * Invitations TRANSITION, they do not delete.
   *
   * "16 of 47 invitees never accepted" is an onboarding metric, not garbage.
   * Rows leave only with their tenant, via CASCADE.
   */
  async expireStaleInvitations(): Promise<ExpireStaleInvitationsResponse> {
    const { count } = await this.prisma.userInvitation.updateMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: InvitationStatus.EXPIRED },
    });

    if (count > 0) {
      this.logger.log(`Expired ${count} stale invitation(s)`);
    }

    return { expiredCount: count };
  }

  /** Scoped to the tenant, so one admin cannot touch another's invitations. */
  private async loadPending(
    invitationId: string,
    organizationId: string,
  ): Promise<UserInvitation> {
    const invitation = await this.prisma.userInvitation.findFirst({
      where: {
        id: invitationId,
        organizationId,
        status: InvitationStatus.PENDING,
      },
    });
    if (!invitation) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No pending invitation with that id',
      });
    }

    return invitation;
  }

  private async resolveRoleNames(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];

    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { name: true },
    });

    return roles.map((role) => role.name);
  }

  /** Points at the SPA — a mail client can only issue a GET. */
  private acceptUrl(rawToken: string): string {
    return `${this.APP_WEB_URL}${WEB_ROUTES.acceptInvitation}?token=${encodeURIComponent(rawToken)}`;
  }

  private toResponse(
    invitation: UserInvitation,
    invitedByName: string | null,
  ): InvitationResponse {
    return {
      id: invitation.id,
      email: invitation.email,
      status: toProtoInvitationStatus(invitation.status as InvitationStatus),
      roleIds: invitation.roleIds,
      departmentIds: invitation.departmentIds,
      primaryDepartmentId: invitation.primaryDepartmentId ?? undefined,
      invitedByName: invitedByName ?? undefined,
      resentCount: invitation.resentCount,
      lastSentAt: toTimestamp(invitation.lastSentAt),
      expiresAt: toTimestamp(invitation.expiresAt),
      createdAt: toTimestamp(invitation.createdAt),
    };
  }

  /**
   * Per-address failure text for the batch report.
   *
   * Only messages this service authored are surfaced; anything else collapses
   * to a generic string rather than leaking an internal error into a response
   * body (production silence, per the conventions).
   */
  private describeFailure(error: unknown): string {
    if (error instanceof RpcException) {
      const payload = error.getError();
      if (typeof payload === 'object' && payload && 'message' in payload) {
        return String(payload.message);
      }
    }
    // Named so the batch report can say WHICH constraint rejected the address
    // rather than "something went wrong".
    if (isUniqueConstraintViolation(error, 'user_invitations_pending_key')) {
      return 'An invitation is already pending for that address';
    }
    if (isUniqueConstraintViolation(error)) {
      return 'That address already has an account here';
    }

    this.logger.error(
      `Unexpected invitation failure: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'Could not create this invitation';
  }
}
