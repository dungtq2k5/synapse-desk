import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  ConfirmAvatarUploadRequest,
  CreateUserRequest,
  CreateUserResponse,
  CurrentUserResponse,
  DeleteUserResponse,
  fromProtoGender,
  GetUserPermissionsResponse,
  ListPermissionHoldersRequest,
  ListPermissionHoldersResponse,
  ListUsersByIdsRequest,
  ListUsersByIdsResponse,
  NotificationRecipient,
  ListUsersRequest,
  ListUsersResponse,
  LockUserRequest,
  LockUserResponse,
  PresignAvatarUploadRequest,
  PresignAvatarUploadResponse,
  ResetUserTwoFactorResponse,
  SetUserDepartmentsRequest,
  SetUserRolesRequest,
  toPageMeta,
  toTimestamp,
  UnlockUserResponse,
  UpdateOwnProfileRequest,
  UpdateUserRequest,
  UserIdRequest,
  UserResponse,
  UserSummaryResponse,
  emptyPage,
  toPrismaPage,
  toSearchFilter,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditResourceType,
  EmailTemplateName,
  SystemRoleName,
  USER_SORTABLE_FIELDS,
  isUniqueConstraintViolation,
  normalizeEmail,
  requireActor,
  requireTenant,
  tenantScope,
  restoreData,
  softDeleteData,
  SupersededReason,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditPublisher } from '../audit/audit-publisher.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import { RolesService } from '../roles/roles.service';
import { SessionsService } from '../sessions/sessions.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import {
  toUserResponse,
  toUserSummaryResponse,
  USER_SUMMARY_INCLUDE,
  UserSummaryRow,
} from './user.mapper';
import { flattenPermissionCodes } from '../../common/utils';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
    private readonly notifications: NotificationPublisher,
    private readonly rolesService: RolesService,
    private readonly sessionsService: SessionsService,
    private readonly organizationsService: OrganizationsService,
    private readonly storage: StorageReferenceService,
  ) {}

  /**
   * The SPA's bootstrap call: profile plus everything needed to render its
   * navigation, in one round trip.
   */
  async getCurrentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        organization: true,
        userDepartments: { include: { department: true } },
        roles: { include: { permissions: true } },
      },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    // No CallerContext here — the gateway calls this DURING token
    // verification, before one exists. See `resolveOwnReadUrls`.
    const avatarUrls = await this.storage.resolveOwnReadUrls(
      user.avatarUrl ? [user.avatarUrl] : [],
      user.organizationId,
      user.id,
    );

    return {
      user: toUserResponse(user, avatarUrls),
      permissionCodes: flattenPermissionCodes(user.roles),
      departmentIds: user.userDepartments.map((ud) => ud.departmentId),
    };
  }

  /**
   * Own profile. The set of writable fields is the security decision here, and
   * it lives in the proto message — `email`, `phoneNumber`, `isEmailVerified`,
   * `isLocked`, roles and departments are all deliberately absent.
   */
  async updateOwnProfile(
    request: UpdateOwnProfileRequest,
    context: CallerContext,
  ): Promise<UserResponse> {
    const userId = requireActor(context);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: this.toProfileData(request),
    });

    this.audit.record(context, {
      action: AuditAction.USER_UPDATED,
      resourceType: AuditResourceType.USER,
      // Actor and target are the same row here, and both are recorded anyway —
      // a later query for "everything done TO this user" must find it.
      resourceId: userId,
      metadata: {
        self: true,
        fields: Object.keys(this.toProfileData(request)),
      },
    });

    return toUserResponse(user, await this.resolveAvatarUrls([user], context));
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listUsers(
    request: ListUsersRequest,
    context: CallerContext,
  ): Promise<ListUsersResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(page, USER_SORTABLE_FIELDS);

    const search = toSearchFilter(page.searchTerm);
    const where: Prisma.UserWhereInput = {
      ...tenantScope(context),
      ...(request.includeDeleted ? { deletedAt: undefined } : {}),
      ...(request.departmentId
        ? { userDepartments: { some: { departmentId: request.departmentId } } }
        : {}),
      ...(request.roleId ? { roles: { some: { id: request.roleId } } } : {}),
      ...(request.isLocked !== undefined ? { isLocked: request.isLocked } : {}),
      ...(search ? { OR: [{ fullName: search }, { email: search }] } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: USER_SUMMARY_INCLUDE,
        orderBy,
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    // ONE storage call for the whole page, not one per row — the N+1 the
    // batched `getSignedReadUrls` exists to prevent.
    //
    // The arrow is required, not style: `items.map(toUserSummaryResponse)`
    // would hand the array INDEX to the second parameter.
    const avatarUrls = await this.resolveAvatarUrls(items, context);

    return {
      items: items.map((item) => toUserSummaryResponse(item, avatarUrls)),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  async getUser(
    request: UserIdRequest,
    context: CallerContext,
  ): Promise<UserSummaryResponse> {
    const user = await this.load(request.id, context);
    return toUserSummaryResponse(
      user,
      await this.resolveAvatarUrls([user], context),
    );
  }

  /**
   * Computed by the SAME function that builds the JWT claim, so the token and
   * this endpoint cannot disagree about what a user may do.
   */
  async getUserPermissions(
    request: UserIdRequest,
    context: CallerContext,
  ): Promise<GetUserPermissionsResponse> {
    // Scoped first, so a foreign id 404s rather than leaking a permission set.
    await this.load(request.id, context);

    const user = await this.prisma.user.findUnique({
      where: { id: request.id },
      select: { roles: { include: { permissions: true } } },
    });

    return { permissionCodes: flattenPermissionCodes(user?.roles ?? []) };
  }

  /**
   * Everyone in a tenant holding a given permission — the notification
   * AUDIENCE (16-doc §1).
   *
   * Resolved HERE because auth-service owns roles and permissions. The producer
   * of a quota alert knows it should reach "whoever can act on this" and cannot
   * know who that is; making it ask would put a cross-service read on a path
   * that is deliberately fire-and-forget, and would duplicate this join in
   * every service that ever notifies anyone.
   *
   * **Deleted and locked users are excluded.** A notification to a deactivated
   * account is a row nobody will ever read and an email to an address that may
   * now belong to someone else.
   */
  async listPermissionHolders(
    request: ListPermissionHoldersRequest,
  ): Promise<ListPermissionHoldersResponse> {
    // Validated rather than left to Prisma, which is what the other 51 RPCs
    // achieve with `requireActor()`. This one has no actor to require — the
    // caller is a background consumer and the tenant is a FIELD — so the check
    // is on the field instead.
    //
    // Without it, an empty `organizationId` reaches a `@db.Uuid` column, the
    // driver raises, Nest wraps it as UNKNOWN, and the gateway would answer 500
    // to something that is plainly a bad request. `contract.e2e-spec` bounds
    // the count of RPCs that do that, and it caught this one on the way in.
    if (!request.organizationId || !request.permissionCode) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId and permissionCode are both required',
      });
    }

    const users = await this.prisma.user.findMany({
      where: {
        organizationId: request.organizationId,
        deletedAt: null,
        // A locked account cannot act on the alert, which is the whole point
        // of addressing it by permission.
        //
        // `isLocked`, a BOOLEAN — there is no `lockedUntil` column. This read
        // it as one until a test finally executed it: TypeScript did not object
        // because the conditional `departmentId` spread below makes this an
        // object literal with a spread, which suppresses the excess-property
        // check that would otherwise have rejected the name outright.
        isLocked: false,
        // `user_roles` and `role_permissions` are IMPLICIT many-to-many
        // relations, so the nesting is user → roles → permissions directly.
        // A join-model shape (`some: { role: { ... } }`) compiles against an
        // explicit relation and is a type error here — which is the schema
        // telling the truth about itself.
        roles: {
          some: { permissions: { some: { code: request.permissionCode } } },
        },
        // Narrowed to one DEPARTMENT when the caller asked for it — 18-doc
        // §3.1. Absent means the whole tenant, which is right for a quota
        // alert (one budget per organization) and wrong for a ticket
        // escalation: every agent in the company hearing about one
        // department's queue is the noise that makes people stop reading.
        ...(request.departmentId
          ? {
              userDepartments: {
                some: { departmentId: request.departmentId },
              },
            }
          : {}),
      },
      select: NOTIFICATION_RECIPIENT_SELECT,
    });

    return { items: users.map(toNotificationRecipient) };
  }

  /**
   * The OTHER audience kind — 18-doc §1.3.
   *
   * A ticket event already knows who the assignee is; resolving `ticket.read`
   * holders instead would tell every agent in the tenant that one of them got a
   * ticket. So this read turns ids into addresses and quiet-hours settings, and
   * decides nothing about who should be notified.
   *
   * **Scoped by organization as well as by id.** A caller supplying an id from
   * another tenant gets nothing rather than a lookup that happens to succeed —
   * the same rule every other read here follows, and the one that matters most
   * on a path whose caller is a background consumer with no user.
   *
   * Deleted and locked users are excluded for the same reason as above: a
   * notification to a deactivated account is a row nobody reads and mail to an
   * address that may now belong to someone else.
   */
  async listUsersByIds(
    request: ListUsersByIdsRequest,
  ): Promise<ListUsersByIdsResponse> {
    if (!request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId is required',
      });
    }

    const userIds = request.userIds ?? [];
    // An empty request is a valid question with an empty answer, not an error:
    // a producer whose audience filtered down to nobody (everyone was the
    // actor) should not have to special-case the call.
    if (userIds.length === 0) return { items: [] };

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        organizationId: request.organizationId,
        deletedAt: null,
        isLocked: false,
      },
      select: NOTIFICATION_RECIPIENT_SELECT,
    });

    return { items: users.map(toNotificationRecipient) };
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Creates an account directly, with NO password.
   *
   * `passwordHash` stays null and `isEmailVerified` stays false, which is the
   * honest state: nobody has proved they hold the address, and an
   * admin-chosen password would have to reach the human out of band anyway.
   * They set one through the password-reset flow. For the normal path the
   * gateway prefers `POST /users/invitations`, which mails a token.
   */
  async createUser(
    request: CreateUserRequest,
    context: CallerContext,
  ): Promise<CreateUserResponse> {
    const organizationId = requireTenant(context);
    const actorId = requireActor(context);
    const email = normalizeEmail(request.email);

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

    try {
      const createdId = await this.prisma.$transaction(async (tx) => {
        // The SAME definition of "seats used" the invitation path applies —
        // extracted so a create rejected here cannot contradict what the usage
        // page reports.
        if (
          (await this.organizationsService.seatsInUse(tx, organizationId)) >=
          organization.maxAgentSeats
        ) {
          throw new RpcException({
            code: status.RESOURCE_EXHAUSTED,
            message: 'No seats remaining on this plan',
          });
        }

        const user = await tx.user.create({
          data: { organizationId, email, fullName: request.fullName },
          select: { id: true },
        });

        const roleIds =
          request.roleIds.length > 0
            ? request.roleIds
            : [await this.rolesService.getEndUserRoleId(tx)];
        await this.rolesService.setUserRoles(tx, user.id, roleIds, context);

        if (request.departmentIds.length > 0) {
          await this.assignDepartments(
            tx,
            user.id,
            request.departmentIds.map((departmentId) => ({
              departmentId,
              isPrimary: departmentId === request.primaryDepartmentId,
            })),
            context,
            actorId,
          );
        }

        return user.id;
      });

      // Read AFTER the transaction, deliberately.
      //
      // `USER_SUMMARY_INCLUDE` pulls three relations, and Prisma's query
      // interpreter loads them CONCURRENTLY. Inside a transaction that means
      // three simultaneous queries on the one connection the transaction has
      // pinned, which pg only tolerates because it queues them — it warns
      // today and removes the queue in pg@9.
      //
      // Outside, they run on the pool where concurrency is the point. It is
      // also simply less work to hold a transaction open for: every statement
      // above is a write, and this is a pure read-back of committed rows.
      const created = await this.prisma.user.findUniqueOrThrow({
        where: { id: createdId },
        include: USER_SUMMARY_INCLUDE,
      });

      this.audit.record(context, {
        action: AuditAction.USER_CREATED,
        resourceType: AuditResourceType.USER,
        resourceId: created.id,
        metadata: { email: created.email, roleIds: request.roleIds },
      });

      return {
        user: toUserSummaryResponse(
          created,
          await this.resolveAvatarUrls([created], context),
        ),
      };
    } catch (error) {
      // The race the pre-check cannot cover: two concurrent creates of the same
      // address both see it free. `users_org_email_key` is what makes the
      // duplicate impossible; this reports the loser's violation as a conflict.
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'That address already has an account here',
        });
      }
      throw error;
    }
  }

  async updateUser(
    request: UpdateUserRequest,
    context: CallerContext,
  ): Promise<UserSummaryResponse> {
    const existing = await this.load(request.id, context);

    // Write, then re-read — see restoreUser for why the include cannot ride
    // along on the write.
    const user = await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        ...this.toProfileData(request),
        ...(request.phoneNumber !== undefined
          ? { phoneNumber: request.phoneNumber.trim() || null }
          : {}),
      },
      select: { id: true, fullName: true, phoneNumber: true },
    });

    this.audit.record(context, {
      action: AuditAction.USER_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
      metadata: {
        before: {
          fullName: existing.fullName,
          phoneNumber: existing.phoneNumber,
        },
        after: { fullName: user.fullName, phoneNumber: user.phoneNumber },
      },
    });

    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: USER_SUMMARY_INCLUDE,
    });

    return toUserSummaryResponse(
      updated,
      await this.resolveAvatarUrls([updated], context),
    );
  }

  /**
   * Deactivate: soft delete AND revoke every session.
   *
   * Without the revocation a deactivated user keeps working until their access
   * token expires — up to 15 minutes of access after being fired, which is the
   * exact window this endpoint exists to close.
   */
  async deleteUser(
    request: UserIdRequest,
    context: CallerContext,
  ): Promise<DeleteUserResponse> {
    const target = await this.load(request.id, context);
    const actorId = requireActor(context);

    await this.assertRemovable(target, actorId, context);

    await this.prisma.$transaction(async (tx) => {
      // Releases the roles first so `user_assigned` reflects reality: a
      // deactivated user is not occupying the role, and leaving the count
      // inflated would block a legitimate role delete forever.
      await this.rolesService.releaseUserRoles(tx, target.id);
      await tx.user.update({
        where: { id: target.id },
        data: softDeleteData(actorId),
      });
    });

    const revokedSessionCount = await this.sessionsService.revokeAllForUser(
      target.id,
    );

    this.audit.record(context, {
      action: AuditAction.USER_DELETED,
      resourceType: AuditResourceType.USER,
      resourceId: target.id,
      metadata: { email: target.email, revokedSessionCount },
    });

    return { revokedSessionCount };
  }

  /** Restored users get NO sessions back — they sign in again. */
  async restoreUser(
    request: UserIdRequest,
    context: CallerContext,
  ): Promise<UserSummaryResponse> {
    const organizationId = requireTenant(context);

    const existing = await this.prisma.user.findFirst({
      where: {
        id: request.id,
        organizationId,
        deletedAt: { not: null },
      },
      select: { id: true, email: true },
    });
    if (!existing) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No deactivated user with that id',
      });
    }

    try {
      // The write does NOT carry the include. Prisma has to make a write plus
      // its relation reads atomic, so it opens an implicit transaction — and
      // the include's relation loads then run concurrently on that
      // transaction's single connection, which is the pg deprecation. Splitting
      // the read out keeps the write a plain statement.
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: restoreData(),
        select: { id: true, email: true },
      });

      this.audit.record(context, {
        action: AuditAction.USER_RESTORED,
        resourceType: AuditResourceType.USER,
        resourceId: user.id,
        metadata: { email: user.email },
      });

      const restored = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: USER_SUMMARY_INCLUDE,
      });

      return toUserSummaryResponse(
        restored,
        await this.resolveAvatarUrls([restored], context),
      );
    } catch (error) {
      // Clearing `deleted_at` re-enters `users_org_email_key`, which is partial
      // on `deleted_at IS NULL`. Someone may have taken the address in the
      // meantime — a 409 naming the conflict, not a 500.
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: `${existing.email} is already in use by another account here`,
        });
      }
      throw error;
    }
  }

  /** Same "otherwise they keep working" reasoning as delete. */
  async lockUser(
    request: LockUserRequest,
    context: CallerContext,
  ): Promise<LockUserResponse> {
    const target = await this.load(request.id, context);
    const actorId = requireActor(context);

    await this.assertRemovable(target, actorId, context);

    await this.prisma.user.update({
      where: { id: target.id },
      data: { isLocked: true },
    });

    const revokedSessionCount = await this.sessionsService.revokeAllForUser(
      target.id,
    );

    this.audit.record(context, {
      action: AuditAction.USER_LOCKED,
      resourceType: AuditResourceType.USER,
      resourceId: target.id,
      metadata: { reason: request.reason, revokedSessionCount },
    });

    this.notifications.sendEmail({
      template: EmailTemplateName.SECURITY_ALERT,
      to: target.email,
      data: {
        fullName: target.fullName,
        headline: 'Your account has been locked',
        detail: `An administrator locked your account. Reason: ${request.reason}`,
        origin: { ip: context.ip, userAgent: context.userAgent },
      },
    });

    return { revokedSessionCount };
  }

  /** No sessions restored: unlocking permits signing in, it does not sign in. */
  async unlockUser(
    request: UserIdRequest,
    context: CallerContext,
  ): Promise<UnlockUserResponse> {
    const target = await this.load(request.id, context);

    await this.prisma.user.update({
      where: { id: target.id },
      data: { isLocked: false },
    });

    this.audit.record(context, {
      action: AuditAction.USER_UNLOCKED,
      resourceType: AuditResourceType.USER,
      resourceId: target.id,
      metadata: { email: target.email },
    });

    return {};
  }

  /**
   * Clears 2FA entirely — for the user who lost their authenticator.
   *
   * Un-trusting every device is not optional here: leaving `device_token_hash`
   * alive would let the lost device keep bypassing the 2FA that no longer
   * exists, which turns a recovery action into a permanent hole.
   *
   * This REMOVES a security control, so it is audited and the user is told.
   */
  async resetUserTwoFactor(
    request: UserIdRequest,
    context: CallerContext,
  ): Promise<ResetUserTwoFactorResponse> {
    const target = await this.load(request.id, context);

    const untrustedDeviceCount = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { twoFactorSecret: null, isTwoFactorEnabled: false },
      });
      await tx.twoFactorBackupCode.deleteMany({ where: { userId: target.id } });

      const { count } = await tx.deviceSession.updateMany({
        where: { userId: target.id },
        data: {
          deviceTokenHash: null,
          trustedUntil: null,
          isTrusted: false,
        },
      });

      return count;
    });

    this.audit.record(context, {
      action: AuditAction.USER_TWO_FACTOR_RESET,
      resourceType: AuditResourceType.USER,
      resourceId: target.id,
      // NEVER the secret or any code hash (see the conventions).
      metadata: { untrustedDeviceCount },
    });

    this.notifications.sendEmail({
      template: EmailTemplateName.SECURITY_ALERT,
      to: target.email,
      data: {
        fullName: target.fullName,
        headline: 'Two-factor authentication was reset',
        detail:
          'An administrator reset two-factor authentication on your account and removed all trusted devices. If this was not expected, contact them immediately.',
        origin: { ip: context.ip, userAgent: context.userAgent },
      },
    });

    return { untrustedDeviceCount };
  }

  // -------------------------------------------------------------------------
  // Assignment
  // -------------------------------------------------------------------------

  async setUserRoles(
    request: SetUserRolesRequest,
    context: CallerContext,
  ): Promise<UserSummaryResponse> {
    const target = await this.load(request.id, context);

    await this.prisma.$transaction(async (tx) => {
      // Tenant validation, the no-escalation rule and the `user_assigned`
      // counter all live in RolesService, so every grant path shares them.
      await this.rolesService.setUserRoles(
        tx,
        target.id,
        request.roleIds,
        context,
      );
    });

    // Read-back AFTER the transaction — see createUser for why: a multi-relation
    // include issues its relation loads concurrently, which inside a
    // transaction means several queries on one pinned connection.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      include: USER_SUMMARY_INCLUDE,
    });

    this.audit.record(context, {
      action: AuditAction.USER_ROLES_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: target.id,
      metadata: {
        before: target.roles.map((role) => role.id),
        after: request.roleIds,
      },
    });

    return toUserSummaryResponse(
      user,
      await this.resolveAvatarUrls([user], context),
    );
  }

  async setUserDepartments(
    request: SetUserDepartmentsRequest,
    context: CallerContext,
  ): Promise<UserSummaryResponse> {
    const target = await this.load(request.id, context);
    const actorId = requireActor(context);

    await this.prisma.$transaction(async (tx) => {
      await tx.userDepartment.deleteMany({ where: { userId: target.id } });

      if (request.departments.length > 0) {
        await this.assignDepartments(
          tx,
          target.id,
          request.departments,
          context,
          actorId,
        );
      }
    });

    // Read-back AFTER the transaction — see createUser for why.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      include: USER_SUMMARY_INCLUDE,
    });

    this.audit.record(context, {
      action: AuditAction.USER_DEPARTMENTS_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: target.id,
      metadata: {
        before: target.userDepartments.map((ud) => ud.departmentId),
        after: request.departments.map((d) => d.departmentId),
      },
    });

    return toUserSummaryResponse(
      user,
      await this.resolveAvatarUrls([user], context),
    );
  }

  // -------------------------------------------------------------------------

  /**
   * Writes department memberships, enforcing the primary invariant.
   *
   * **Exactly one primary when the list is non-empty.** Zero is as invalid as
   * two: the partial unique index only catches the "two" case, so a submission
   * with no primary would be accepted and silently leave the user with no
   * ticket routing and no document scope.
   */
  private async assignDepartments(
    tx: Prisma.TransactionClient,
    userId: string,
    departments: { departmentId: string; isPrimary: boolean }[],
    context: CallerContext,
    actorId: string,
  ): Promise<void> {
    const primaryCount = departments.filter((d) => d.isPrimary).length;
    if (primaryCount !== 1) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Exactly one department must be primary; received ${primaryCount}`,
      });
    }

    const ids = departments.map((d) => d.departmentId);
    // Every department must be in the caller's tenant. Nothing in the junction
    // table's FKs prevents linking a foreign department, because both ids are
    // individually valid.
    const valid = await tx.department.findMany({
      where: { id: { in: ids }, ...tenantScope(context) },
      select: { id: true },
    });
    if (valid.length !== new Set(ids).size) {
      const known = new Set(valid.map((d) => d.id));
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Unknown department(s): ${ids.filter((id) => !known.has(id)).join(', ')}`,
      });
    }

    await tx.userDepartment.createMany({
      data: departments.map((department) => ({
        userId,
        departmentId: department.departmentId,
        isPrimary: department.isPrimary,
        assignedById: actorId,
      })),
    });
  }

  /**
   * Guards shared by delete and lock — both take an account out of service, so
   * both need the same three.
   */
  private async assertRemovable(
    target: UserSummaryRow,
    actorId: string,
    context: CallerContext,
  ): Promise<void> {
    if (target.id === actorId) {
      throw new RpcException({
        code: status.ABORTED,
        message: 'You cannot deactivate or lock your own account',
      });
    }

    // Only a Super Admin may take another Super Admin out of service.
    if (target.isSuperAdmin && !context.isSuperAdmin) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Only a platform administrator can do this to a Super Admin',
      });
    }

    // The last Org Admin. Without this the tenant becomes unadministrable and
    // there is no in-product way back — the same failure the founder-role fix
    // exists to prevent, arrived at from the other direction.
    // `String(...)` because `roles.name` is a plain VarChar while
    // SystemRoleName is a TS enum — comparing them directly is an unsafe-enum
    // comparison, and the enum's VALUE is deliberately the column's contents.
    const isOrgAdmin = target.roles.some(
      (role) => role.name === String(SystemRoleName.ORG_ADMIN),
    );
    if (!isOrgAdmin) return;

    const remaining = await this.prisma.user.count({
      where: {
        organizationId: target.organizationId,
        deletedAt: null,
        isLocked: false,
        id: { not: target.id },
        roles: { some: { name: SystemRoleName.ORG_ADMIN } },
      },
    });
    if (remaining === 0) {
      throw new RpcException({
        code: status.ABORTED,
        message:
          'This is the last active Org Admin. Promote another before removing this one.',
      });
    }
  }

  /**
   * Single-row read, always `findFirst` with the tenant filter.
   *
   * `findUnique({ id })` cannot express that filter, so it would return another
   * tenant's user and the handler would serialize it.
   */
  private async load(
    id: string,
    context: CallerContext,
  ): Promise<UserSummaryRow> {
    const user = await this.prisma.user.findFirst({
      where: { id, ...tenantScope(context) },
      include: USER_SUMMARY_INCLUDE,
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No user with that id',
      });
    }

    return user;
  }

  // -------------------------------------------------------------------------
  // Avatars — 10-storage-service.md §3.1
  // -------------------------------------------------------------------------

  /**
   * Step 1 of presign → upload → confirm.
   *
   * `ownerId` is the CALLER, taken from the verified context inside
   * `StorageReferenceService` — there is no parameter here through which one
   * user could presign an upload into another user's avatar prefix.
   */
  async presignAvatarUpload(
    request: PresignAvatarUploadRequest,
    context: CallerContext,
  ): Promise<PresignAvatarUploadResponse> {
    requireActor(context);

    try {
      const presigned = await this.storage.presignAvatar(
        {
          contentType: request.contentType,
          sizeBytes: request.sizeBytes,
          fileName: request.originalFileName,
        },
        context,
      );

      return {
        uploadUrl: presigned.uploadUrl,
        objectPath: presigned.objectPath,
        expiresAt: toTimestamp(presigned.expiresAt),
      };
    } catch (error) {
      throw StorageReferenceService.asClientError(error);
    }
  }

  /**
   * Step 6: confirm, then commit.
   *
   * The OLD path is read BEFORE the column is overwritten, and that ordering is
   * the whole method. Reading it afterwards would give back the new path, and
   * the supersede event would then delete the avatar the user just uploaded —
   * a one-line mistake with a very confusing symptom.
   */
  async confirmAvatarUpload(
    request: ConfirmAvatarUploadRequest,
    context: CallerContext,
  ): Promise<UserResponse> {
    const actorId = requireActor(context);

    try {
      await this.storage.confirmAvatar(request.objectPath, context);
    } catch (error) {
      throw StorageReferenceService.asClientError(error);
    }

    const existing = await this.prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { avatarUrl: true },
    });

    const user = await this.prisma.user.update({
      where: { id: actorId },
      data: { avatarUrl: request.objectPath },
    });

    this.audit.record(context, {
      action: AuditAction.USER_AVATAR_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: actorId,
      metadata: { after: { avatarUrl: request.objectPath } },
    });

    // ONLY if there was one. A first-ever upload has nothing to supersede, and
    // emitting for an empty path would ask storage-service to delete "whatever
    // the empty string resolves to".
    if (existing.avatarUrl) {
      this.storage.emitSuperseded(
        existing.avatarUrl,
        SupersededReason.REPLACED,
      );
    }

    return toUserResponse(user, await this.resolveAvatarUrls([user], context));
  }

  async deleteAvatar(context: CallerContext): Promise<UserResponse> {
    const actorId = requireActor(context);

    const existing = await this.prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { avatarUrl: true },
    });

    const user = await this.prisma.user.update({
      where: { id: actorId },
      data: { avatarUrl: null },
    });

    this.audit.record(context, {
      action: AuditAction.USER_AVATAR_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: actorId,
      metadata: { before: { avatarUrl: existing.avatarUrl } },
    });

    if (existing.avatarUrl) {
      this.storage.emitSuperseded(
        existing.avatarUrl,
        SupersededReason.RECORD_DELETED,
      );
    }

    return toUserResponse(user, await this.resolveAvatarUrls([user], context));
  }

  /**
   * Turns stored object PATHS into signed read URLs — §1.3.
   *
   * Batched across a whole page rather than one call per row: a list of fifty
   * users each showing an avatar would otherwise be fifty signing calls. A path
   * that will not resolve is simply absent, and the caller renders null.
   */
  async resolveAvatarUrls(
    users: Array<{ avatarUrl: string | null }>,
    context: CallerContext,
  ): Promise<Record<string, string>> {
    return this.storage.resolveReadUrls(
      users
        .map((user) => user.avatarUrl)
        .filter((path): path is string => !!path),
      context,
    );
  }

  /**
   * The profile columns shared by `updateOwnProfile` and `updateUser`.
   *
   * An absent field means "leave unchanged"; an empty string clears. Collapsing
   * the two would make a date of birth impossible to remove once set.
   */
  /**
   * Deliberately cannot write `avatarUrl`. That column is owned by the
   * presign -> upload -> confirm flow, which is what proves the object exists
   * and belongs to the caller, and what supersedes the previous one. A profile
   * update that could set it to any string bypassed all three.
   */
  private toProfileData(request: {
    fullName?: string;
    dob?: string;
    gender?: number;
  }): Prisma.UserUpdateInput {
    const data: Prisma.UserUpdateInput = {};

    if (request.fullName !== undefined) data.fullName = request.fullName.trim();
    if (request.gender !== undefined) {
      data.gender = fromProtoGender(request.gender);
    }
    if (request.dob !== undefined) {
      // `@db.Date` is a calendar date. Parsed as UTC midnight so the stored day
      // cannot shift for a server west of UTC.
      data.dob = request.dob.trim()
        ? new Date(`${request.dob}T00:00:00Z`)
        : null;
    }

    return data;
  }
}

/**
 * The columns a notification recipient needs, in ONE place.
 *
 * Shared by both audience reads so they cannot drift: the quiet-hours fields
 * were added for `listUsersByIds` and are just as necessary for
 * `listPermissionHolders`, and a second copy would have gained them later or
 * never.
 */
const NOTIFICATION_RECIPIENT_SELECT = {
  id: true,
  email: true,
  fullName: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  timezone: true,
} as const;

function toNotificationRecipient(user: {
  id: string;
  email: string;
  fullName: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
}): NotificationRecipient {
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    // `?? undefined`, not `?? ''`: these are `optional` on the wire, and an
    // empty string would be indistinguishable from a user who set "00:00".
    quietHoursStart: user.quietHoursStart ?? undefined,
    quietHoursEnd: user.quietHoursEnd ?? undefined,
    timezone: user.timezone ?? undefined,
  };
}
