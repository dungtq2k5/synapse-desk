import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AuditAction,
  AuditPublisher,
  AuditResourceType,
  isUniqueConstraintViolation,
  PERMISSION_CODES,
  PermissionCode,
  requireActor,
  requireTenant,
  ROLE_SORTABLE_FIELDS,
  SystemRoleName,
} from '@synapsedesk/common';
import {
  CallerContext,
  CreateRoleRequest,
  DeleteRoleResponse,
  ListPermissionsResponse,
  ListRolesRequest,
  ListRolesResponse,
  AssignRoleUsersRequest,
  RevokeRoleUserRequest,
  RoleIdRequest,
  RoleResponse,
  SetRolePermissionsRequest,
  toPageMeta,
  UpdateRoleRequest,
  emptyPage,
  toPrismaPage,
  toSearchFilter,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { ROLE_INCLUDE, RoleRow, toRoleResponse } from './role.mapper';
import { Prisma } from '../../generated/prisma/client';

/**
 * Lookups for the four GLOBAL system roles (`organization_id IS NULL`).
 *
 * Split out of AuthService because two call sites needed the same query — the
 * password and Google registration paths — and both ran it on every signup for
 * a value that never changes.
 */
/**
 * Ceiling for one bulk assignment, six times Prisma's 5-second default.
 *
 * The arithmetic behind both this and the batch cap is on
 * `MAX_ROLE_ASSIGNMENT_USERS` — they are one decision. Matches the only other
 * explicit timeout in this service, `SEED_TRANSACTION_TIMEOUT_MS`.
 */
const ROLE_ASSIGNMENT_TIMEOUT_MS = 30_000;

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  /**
   * Cached for the process lifetime, with no invalidation, and that is safe for
   * exactly one reason: system roles are seeded once at boot and their ids are
   * never rewritten. A tenant admin cannot rename or delete them
   * (`is_system_role = true`), so there is no event that would stale this.
   *
   * Deliberately NOT populated in `onModuleInit`: Nest runs every module's init
   * hook BEFORE `DatabaseSeeder.onApplicationBootstrap`, so an eager read would
   * run against an unseeded database on a fresh install and cache a miss
   * forever. Lazy population sidesteps the ordering entirely.
   */
  private readonly systemRoleIds = new Map<SystemRoleName, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
  ) {}

  /**
   * The default role every self-registered user receives.
   *
   * Takes an optional transaction client so callers inside a `$transaction` read
   * through the same connection — on a cache miss the lookup must not deadlock
   * against the transaction that is asking for it.
   */
  getEndUserRoleId(tx?: Prisma.TransactionClient): Promise<string> {
    return this.getSystemRoleId(SystemRoleName.END_USER, tx);
  }

  async getSystemRoleId(
    name: SystemRoleName,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const cached = this.systemRoleIds.get(name);
    if (cached) return cached;

    const client = tx ?? this.prisma;
    const role = await client.role.findFirst({
      // organizationId: null is what makes it the GLOBAL role rather than a
      // tenant's custom role that happens to share the name.
      where: { organizationId: null, name },
      select: { id: true },
    });
    if (!role) {
      // Unrecoverable: the seeder creates these at boot, so a miss means the
      // database was never seeded and every registration will fail the same way.
      this.logger.error(
        `System role '${name}' is missing — has the seeder run?`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `System role '${name}' not found`,
      });
    }

    this.systemRoleIds.set(name, role.id);
    return role.id;
  }

  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------

  /**
   * Tenant roles UNION global system roles.
   *
   * The union is the point: SystemRoleName.SUPPORT_AGENT must be assignable in
   * every tenant, so a list that showed only the tenant's own custom roles
   * would make the four seeded roles unassignable through the UI.
   */
  async listRoles(
    request: ListRolesRequest,
    context: CallerContext,
  ): Promise<ListRolesResponse> {
    const organizationId = requireTenant(context);
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(page, ROLE_SORTABLE_FIELDS);

    const search = toSearchFilter(page.searchTerm);
    const where: Prisma.RoleWhereInput = {
      OR: request.includeSystem
        ? [{ organizationId }, { organizationId: null, isSystemRole: true }]
        : [{ organizationId }],
      ...(search ? { name: search } : {}),
    };

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

  async getRole(
    request: RoleIdRequest,
    context: CallerContext,
  ): Promise<RoleResponse> {
    return toRoleResponse(await this.load(request.id, context));
  }

  /**
   * Always a TENANT role. A tenant cannot mint a global one — only the platform
   * API may, and only it should: a global role is visible to every customer.
   */
  async createRole(
    request: CreateRoleRequest,
    context: CallerContext,
  ): Promise<RoleResponse> {
    const organizationId = requireTenant(context);
    const actorId = requireActor(context);
    const codes = this.assertGrantable(request.permissionCodes, context);

    const role = await this.conflictOnDuplicateName(() =>
      this.prisma.role.create({
        data: {
          organizationId,
          name: request.name.trim(),
          description: request.description?.trim() || null,
          isSystemRole: false,
          createdById: actorId,
          permissions: { connect: codes.map((code) => ({ code })) },
        },
        include: ROLE_INCLUDE,
      }),
    );

    this.audit.record(context, {
      action: AuditAction.ROLE_CREATED,
      resourceType: AuditResourceType.ROLE,
      resourceId: role.id,
      metadata: { name: role.name, permissionCodes: codes },
    });

    return toRoleResponse(role);
  }

  async updateRole(
    request: UpdateRoleRequest,
    context: CallerContext,
  ): Promise<RoleResponse> {
    const existing = await this.loadMutable(request.id, context);

    const data: Prisma.RoleUpdateInput = {};
    if (request.name !== undefined) data.name = request.name.trim();
    if (request.description !== undefined) {
      data.description = request.description.trim() || null;
    }

    const role = await this.conflictOnDuplicateName(() =>
      this.prisma.role.update({
        where: { id: existing.id },
        data,
        include: ROLE_INCLUDE,
      }),
    );

    this.audit.record(context, {
      action: AuditAction.ROLE_UPDATED,
      resourceType: AuditResourceType.ROLE,
      resourceId: role.id,
      metadata: {
        before: { name: existing.name, description: existing.description },
        after: { name: role.name, description: role.description },
      },
    });

    return toRoleResponse(role);
  }

  /**
   * Roles are HARD-deleted — there is no `deleted_at` column — so `user_roles`
   * rows cascade away with them.
   *
   * That is precisely why the `user_assigned > 0` guard is not a nicety: it is
   * the only thing between a mis-click and silently stripping a role from forty
   * people, which is a permission change nobody authorized and which nothing
   * records well enough to undo.
   */
  async deleteRole(
    request: RoleIdRequest,
    context: CallerContext,
  ): Promise<DeleteRoleResponse> {
    const role = await this.loadMutable(request.id, context);

    if (role.userAssigned > 0) {
      throw new RpcException({
        // ABORTED -> 409. A conflict with the current state, retryable once the
        // holders are reassigned.
        code: status.ABORTED,
        message: `This role is assigned to ${role.userAssigned} user(s). Reassign them before deleting it.`,
      });
    }

    await this.prisma.role.delete({ where: { id: role.id } });

    this.audit.record(context, {
      action: AuditAction.ROLE_DELETED,
      resourceType: AuditResourceType.ROLE,
      resourceId: role.id,
      metadata: { name: role.name },
    });

    return {};
  }

  /** Replaces the permission set in one write. */
  async setRolePermissions(
    request: SetRolePermissionsRequest,
    context: CallerContext,
  ): Promise<RoleResponse> {
    const existing = await this.loadMutable(request.id, context);
    const codes = this.assertGrantable(request.permissionCodes, context);

    const role = await this.prisma.role.update({
      where: { id: existing.id },
      // `set` rather than `connect`: this is REPLACE semantics, so sending the
      // same body twice is a no-op instead of a double grant, and a code left
      // out is genuinely revoked.
      data: { permissions: { set: codes.map((code) => ({ code })) } },
      include: ROLE_INCLUDE,
    });

    this.audit.record(context, {
      action: AuditAction.ROLE_PERMISSIONS_UPDATED,
      resourceType: AuditResourceType.ROLE,
      resourceId: role.id,
      metadata: {
        before: existing.permissions.map((p) => p.code),
        after: codes,
      },
    });

    return toRoleResponse(role);
  }

  /**
   * The seeded catalogue, grouped by the `target` prefix of the code.
   *
   * No write path at any level — see
   * [ADR 0038](../../../../../docs/decisions/0038-permissions-are-a-compile-time-artifact.md).
   *
   * Takes no `CallerContext` on purpose: the catalogue is global, so there is
   * no tenant to filter by and a Super Admin with `organizationId: null` reads
   * it like anyone else.
   */
  async listPermissions(): Promise<ListPermissionsResponse> {
    const permissions = await this.prisma.permission.findMany({
      orderBy: { code: 'asc' },
    });

    return {
      items: permissions.map((permission) => ({
        id: permission.id,
        code: permission.code,
        name: permission.name,
        // Derived, not stored — which is what lets the role editor group rows
        // without a column that could disagree with the code.
        group: permission.code.split('.')[0],
        // **The table can legitimately hold rows the union does not.** A code
        // removed from `PERMISSION_CODES` is left here on purpose — custom
        // roles may still reference it — so the catalogue has to say which are
        // still grantable, or the editor offers one `assertGrantable` will
        // refuse (ADR 0038).
        isRetired: !PERMISSION_CODES.includes(
          permission.code as PermissionCode,
        ),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Assignment — shared with UsersService and invitation acceptance
  // -------------------------------------------------------------------------

  /**
   * Replaces a user's roles and keeps `roles.user_assigned` in step, in ONE
   * transaction.
   *
   * Every path that grants or revokes a role must come through here. The
   * counter is denormalized, so a path that writes the junction without
   * adjusting it leaves the count wrong forever — and the count is what gates
   * `DELETE /roles/:id`, so drift there eventually blocks a legitimate delete
   * or permits a destructive one.
   *
   * Returns the ids actually applied.
   */
  async setUserRoles(
    tx: Prisma.TransactionClient,
    userId: string,
    roleIds: string[],
    context: CallerContext,
  ): Promise<string[]> {
    const organizationId = requireTenant(context);
    const wanted = [...new Set(roleIds)];

    // Two branches, and both are needed: a tenant's own custom roles PLUS the
    // global system roles. Checking only the first blocks legitimate system-role
    // assignment; checking neither lets a tenant assign another tenant's role.
    const valid = await tx.role.findMany({
      where: {
        id: { in: wanted },
        OR: [{ organizationId }, { organizationId: null, isSystemRole: true }],
      },
      include: ROLE_INCLUDE,
    });

    if (valid.length !== wanted.length) {
      const known = new Set(valid.map((role) => role.id));
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Unknown role(s): ${wanted.filter((id) => !known.has(id)).join(', ')}`,
      });
    }

    // No-escalation: an actor may not grant permissions they do not themselves
    // hold. Without this, anyone with `user.role.assign` is one request away
    // from granting themselves Org Admin — which makes that permission
    // equivalent to full tenant control.
    this.assertGrantable(
      valid.flatMap((role) => role.permissions.map((p) => p.code)),
      context,
    );

    const current = await tx.role.findMany({
      where: { users: { some: { id: userId } } },
      // `name` as well as `id`: the last-Org-Admin guard below needs to know
      // WHICH role is leaving, and only the name identifies it.
      select: { id: true, name: true },
    });
    const currentIds = new Set(current.map((role) => role.id));
    const wantedIds = new Set(wanted);

    const added = wanted.filter((id) => !currentIds.has(id));
    const removed = [...currentIds].filter((id) => !wantedIds.has(id));

    // **Demotion is the THIRD way to remove an administrator**, and the other
    // two already refuse it: `assertRemovable` guards delete and lock. A role
    // replacement that drops ORG_ADMIN from the last one leaves the tenant
    // unadministrable exactly as a delete would, and there is no in-product way
    // back.
    //
    // `String(...)` because `roles.name` is a plain VarChar while
    // `SystemRoleName` is a TS enum — comparing them directly is an unsafe-enum
    // comparison, and the enum's VALUE is deliberately the column's contents.
    const losingOrgAdmin = current.some(
      (role) =>
        role.name === String(SystemRoleName.ORG_ADMIN) &&
        !wantedIds.has(role.id),
    );
    if (losingOrgAdmin) {
      await this.assertNotLastOrgAdmin(tx, userId, organizationId);
    }

    await tx.user.update({
      where: { id: userId },
      data: { roles: { set: wanted.map((id) => ({ id })) } },
    });

    // Counter adjusted in the SAME transaction as the junction write, so a
    // failure rolls both back together.
    if (added.length > 0) {
      await tx.role.updateMany({
        where: { id: { in: added } },
        data: { userAssigned: { increment: 1 } },
      });
    }
    if (removed.length > 0) {
      await tx.role.updateMany({
        where: { id: { in: removed } },
        data: { userAssigned: { decrement: 1 } },
      });
    }

    return wanted;
  }

  /**
   * Names the user a bulk failure was about.
   *
   * `assertGrantable` builds its message from permission codes alone — it is
   * called from `setUserRoles`, which knows the id but has no reason to say it
   * on the single-user path. Caught and re-thrown here rather than threading a
   * label through the primitive: the loop is the only caller that needs it.
   *
   * Non-RpcException errors pass through untouched — wrapping a Prisma timeout
   * in a permissions-shaped message would be worse than the bare one.
   */
  private withTargetUser(error: unknown, userId: string): unknown {
    if (!(error instanceof RpcException)) return error;

    const payload = error.getError() as { code?: number; message?: string };
    if (typeof payload.code !== 'number') return error;

    return new RpcException({
      code: payload.code,
      message: `${payload.message ?? 'Rejected'} (user ${userId})`,
    });
  }

  /**
   * Adds one role to many users, leaving each user's other roles alone.
   *
   * **Routed through {@link setUserRoles} per user rather than `connect`.** That
   * primitive is the documented entry point — *"every path that grants or
   * revokes a role must come through here"* — so this inherits the tenant and
   * system-role validation, the no-escalation rule, the `user_assigned` delta
   * and the last-Org-Admin guard instead of restating four rules that would
   * then have to stay in step.
   *
   * Re-assigning a role someone already holds is a NO-OP, not an error: a bulk
   * operation over a selected list routinely includes them, and the union below
   * leaves such a user's set unchanged, so the counter does not move.
   *
   * **One transaction, all or nothing.** A partial bulk is worse than a
   * refusal — the caller cannot tell which half applied without re-reading, and
   * the obvious retry re-applies the half that worked.
   *
   * @throws RpcException NOT_FOUND when the role, or any user, is not this
   * tenant's.
   */
  async assignRoleUsers(
    request: AssignRoleUsersRequest,
    context: CallerContext,
  ): Promise<RoleResponse> {
    const organizationId = requireTenant(context);
    const role = await this.load(request.roleId, context);
    const userIds = [...new Set(request.userIds)];

    const changed = await this.prisma.$transaction(
      async (tx) => {
        // **Read INSIDE the transaction.** `setUserRoles` writes
        // `roles: { set: wanted }`, so the set built here is authoritative — a
        // snapshot taken before the transaction opened would silently revert
        // any role granted in between. That is tolerable for
        // `PUT /users/:id/roles`, where the caller said "this is the new set";
        // it is the WRONG OPERATION here, where they said "add this one" and
        // said nothing about the others.
        //
        // Narrows the window to the transaction rather than closing it — under
        // READ COMMITTED two transactions can still both read before either
        // writes. Closing it needs the same per-tenant serialization the
        // last-admin race would, and that is one change covering both.
        //
        // **The check reuse does NOT supply.** `setUserRoles` takes a `userId`
        // and never validates it, so a bulk caller could otherwise slip another
        // tenant's id into the list. `isLocked` is deliberately NOT filtered: a
        // locked user is suspended, not gone, and granting them a role is
        // exactly the sort of thing an admin does while an account is locked.
        const targets = await tx.user.findMany({
          where: { id: { in: userIds }, organizationId, deletedAt: null },
          select: { id: true, roles: { select: { id: true } } },
        });

        // Refused whole rather than silently skipped: a response saying
        // "assigned" about a user that was not is worse than an error. Thrown
        // inside the transaction now, so it rolls back — nothing has been
        // written at this point either way.
        if (targets.length !== userIds.length) {
          const known = new Set(targets.map((user) => user.id));
          throw new RpcException({
            code: status.NOT_FOUND,
            message: `Unknown user(s): ${userIds.filter((id) => !known.has(id)).join(', ')}`,
          });
        }

        const written: { userId: string; before: string[] }[] = [];

        for (const target of targets) {
          const before = target.roles.map((held) => held.id);
          if (before.includes(role.id)) continue;

          // **`assertGrantable` runs over each user's WHOLE resulting set**, not
          // the delta — so a batch containing one existing Org Admin demands the
          // actor hold every ORG_ADMIN permission, and refusing rolls the whole
          // batch back. Strict is the safe direction and matches
          // `PUT /users/:id/roles`; unreachable today because `user.role.assign`
          // belongs to ORG_ADMIN alone, whose set is `PERMISSION_CODES`.
          //
          // Re-thrown with the user named, because the primitive's message lists
          // permissions the caller never asked to grant, about a user they were
          // not trying to change.
          try {
            await this.setUserRoles(
              tx,
              target.id,
              [...before, role.id],
              context,
            );
          } catch (error) {
            throw this.withTargetUser(error, target.id);
          }

          written.push({ userId: target.id, before });
        }

        return written;
      },
      // Sized against `MAX_ROLE_ASSIGNMENT_USERS`, whose docblock carries the
      // arithmetic. The default is 5s, which the cap can reach on its own the
      // moment the database is a network hop away — and a Prisma timeout
      // reaches the caller as a 500 that says nothing about batch size.
      { timeout: ROLE_ASSIGNMENT_TIMEOUT_MS },
    );

    // One row PER USER, not one per request. "When did this user get this role"
    // is the question a trail is read for, and a row whose resource is the role
    // and whose metadata is twenty user ids cannot answer it.
    //
    // The primitive writes no audit at all — `UsersService.setUserRoles` emits
    // this after its own transaction — so reuse buys the counter, the checks
    // and the guard, and explicitly not the trail.
    for (const { userId, before } of changed) {
      this.audit.record(context, {
        action: AuditAction.USER_ROLES_UPDATED,
        resourceType: AuditResourceType.USER,
        resourceId: userId,
        metadata: { before, after: [...before, role.id] },
      });
    }

    return toRoleResponse(await this.load(role.id, context));
  }

  /**
   * Removes one role from one user, leaving their others alone.
   *
   * Through {@link setUserRoles} for the same reasons as the assign path — and
   * one more: this is the route that NAMES the operation "remove this user from
   * the Org Admin role", so the last-admin guard has to fire here or the
   * friendliest-looking path is the unguarded one.
   *
   * @throws RpcException NOT_FOUND when the user does not hold the role. "It
   * was already gone" and "I removed it" must not look the same to an audit
   * reader.
   */
  async revokeRoleUser(
    request: RevokeRoleUserRequest,
    context: CallerContext,
  ): Promise<RoleResponse> {
    const organizationId = requireTenant(context);
    const role = await this.load(request.roleId, context);

    // Read INSIDE, for the reason `assignRoleUsers` gives: `after` is derived
    // from this set and applied as a replacement, so a stale one would revert a
    // role granted between the read and the write.
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: request.userId, organizationId, deletedAt: null },
        select: { id: true, roles: { select: { id: true } } },
      });

      if (!target) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'No user with that id',
        });
      }

      const held = target.roles.map((role) => role.id);
      if (!held.includes(role.id)) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'This user does not hold that role',
        });
      }

      const remaining = held.filter((id) => id !== role.id);
      await this.setUserRoles(tx, target.id, remaining, context);

      return { before: held, after: remaining };
    });

    this.audit.record(context, {
      action: AuditAction.USER_ROLES_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: request.userId,
      metadata: { before, after },
    });

    return toRoleResponse(await this.load(role.id, context));
  }

  /**
   * Refuses a change that would leave the tenant with no active Org Admin.
   *
   * The SAME definition of "active" `assertRemovable` uses — not deleted, not
   * locked, someone other than this user — because two guards that disagree
   * about who counts are two different rules wearing one name.
   *
   * **Self-demotion needs no separate check.** An admin who is not the last one
   * may hand over by demoting themselves; one who is the last one is the
   * lockout, and the count already answers that.
   *
   * **Counts through `tx`, not `this.prisma`.** Reading outside the transaction
   * this protects would widen the window rather than narrow it. It is still a
   * COUNT and not a lock: two concurrent demotions can each see one remaining
   * admin and both proceed. That race is pre-existing on delete and lock,
   * accepted and recorded rather than half-closed here — closing it means
   * serializing per tenant across all three paths.
   *
   * @throws RpcException ABORTED when this is the last active Org Admin.
   */
  private async assertNotLastOrgAdmin(
    tx: Prisma.TransactionClient,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const remaining = await tx.user.count({
      where: {
        organizationId,
        deletedAt: null,
        isLocked: false,
        id: { not: userId },
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
   * Connects roles and bumps the counter, WITHOUT the tenant or no-escalation
   * checks.
   *
   * For paths where the caller is unauthenticated and the roles have already
   * been validated against live rows — invitation acceptance is the only one.
   * `setUserRoles` is the checked entry point and every administrative path
   * must use that instead; this exists so the counter is still maintained on
   * the one path that cannot supply an actor to check against.
   */
  async grantRoles(
    tx: Prisma.TransactionClient,
    userId: string,
    roleIds: string[],
  ): Promise<void> {
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) return;

    await tx.user.update({
      where: { id: userId },
      data: { roles: { connect: unique.map((id) => ({ id })) } },
    });
    await tx.role.updateMany({
      where: { id: { in: unique } },
      data: { userAssigned: { increment: 1 } },
    });
  }

  /** Decrements the counter for every role a departing user held. */
  async releaseUserRoles(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const held = await tx.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { id: true },
    });
    if (held.length === 0) return;

    await tx.role.updateMany({
      where: { id: { in: held.map((role) => role.id) } },
      data: { userAssigned: { decrement: 1 } },
    });
    await tx.user.update({
      where: { id: userId },
      data: { roles: { set: [] } },
    });
  }

  // -------------------------------------------------------------------------

  /**
   * The no-escalation rule, applied to a set of codes.
   *
   * A Super Admin is exempt: they hold no tenant RBAC rows at all, so a naive
   * subset check would forbid them from creating any role whatsoever.
   */
  private assertGrantable(codes: string[], context: CallerContext): string[] {
    const unique = [...new Set(codes)];

    const unknown = unique.filter(
      (code) => !PERMISSION_CODES.includes(code as PermissionCode),
    );
    if (unknown.length > 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Unknown permission code(s): ${unknown.join(', ')}`,
      });
    }

    if (context.isSuperAdmin) return unique;

    const held = new Set<string>(context.permissionCodes);
    const escalating = unique.filter((code) => !held.has(code));
    if (escalating.length > 0) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: `You cannot grant permission(s) you do not hold: ${escalating.join(', ')}`,
      });
    }

    return unique;
  }

  /** Readable: the caller's own roles plus the global ones. */
  private async load(id: string, context: CallerContext): Promise<RoleRow> {
    const organizationId = requireTenant(context);

    const role = await this.prisma.role.findFirst({
      where: {
        id,
        OR: [{ organizationId }, { organizationId: null, isSystemRole: true }],
      },
      include: ROLE_INCLUDE,
    });
    if (!role) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No role with that id',
      });
    }

    return role;
  }

  /**
   * Mutable: the caller's own tenant roles ONLY.
   *
   * A system role loads fine through `load` and is rejected here — 403 rather
   * than 404, because the caller can legitimately see it and hiding its
   * existence would be a lie they can disprove with a list call.
   */
  private async loadMutable(
    id: string,
    context: CallerContext,
  ): Promise<RoleRow> {
    const role = await this.load(id, context);

    // BOTH columns, not just the flag. `organizationId === null` is what makes
    // a role global; `isSystemRole` is what makes it protected. A row with one
    // and not the other is a seeding bug, and treating it as ordinary would be
    // the wrong direction to fail.
    if (role.organizationId === null && role.isSystemRole) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'System roles cannot be modified',
      });
    }

    return role;
  }

  private async conflictOnDuplicateName<T>(
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'A role with that name already exists',
        });
      }
      throw error;
    }
  }
}
