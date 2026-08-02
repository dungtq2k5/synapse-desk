import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AddDepartmentMembersRequest,
  AddDepartmentMembersResponse,
  CallerContext,
  CreateDepartmentRequest,
  DeleteDepartmentResponse,
  DepartmentIdRequest,
  DepartmentResponse,
  GetDepartmentRequest,
  ListDepartmentMembersRequest,
  ListDepartmentMembersResponse,
  ListDepartmentsRequest,
  ListDepartmentsResponse,
  RemoveDepartmentMemberRequest,
  RemoveDepartmentMemberResponse,
  toPageMeta,
  UpdateDepartmentRequest,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditResourceType,
  DEPARTMENT_MEMBER_SORTABLE_FIELDS,
  DEPARTMENT_SORTABLE_FIELDS,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditPublisher } from '../audit/audit-publisher.service';
import {
  DepartmentRow,
  toDepartmentMemberResponse,
  toDepartmentResponse,
} from './department.mapper';
import {
  requireActor,
  requireTenant,
  tenantScope,
} from '../../common/utils/tenant-scope';
import {
  emptyPage,
  toPrismaPage,
  toSearchFilter,
} from '../../common/utils/pagination';
import {
  restoreData,
  restoreOrConflict,
  softDeleteData,
} from '../../common/utils/soft-delete';
import { isUniqueConstraintViolation } from '../../common/utils/utils';
import { Prisma } from '../../generated/prisma/client';

/** The joins every DepartmentResponse needs. */
const DEPARTMENT_INCLUDE = {
  _count: { select: { userDepartments: true } },
  deletedBy: { select: { fullName: true } },
} satisfies Prisma.DepartmentInclude;

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
  ) {}

  async listDepartments(
    request: ListDepartmentsRequest,
    context: CallerContext,
  ): Promise<ListDepartmentsResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      DEPARTMENT_SORTABLE_FIELDS,
    );

    const where: Prisma.DepartmentWhereInput = {
      ...tenantScope(context),
      // `tenantScope` always pins `deletedAt: null`; an admin asking for the
      // recycle bin overrides it. Spread AFTER, or the scope wins and the flag
      // silently does nothing.
      ...(request.includeDeleted ? { deletedAt: undefined } : {}),
      ...(toSearchFilter(page.searchTerm)
        ? { name: toSearchFilter(page.searchTerm) }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.department.findMany({
        where,
        include: DEPARTMENT_INCLUDE,
        orderBy,
        skip,
        take,
      }),
      this.prisma.department.count({ where }),
    ]);

    return {
      items: items.map(toDepartmentResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  async getDepartment(
    request: GetDepartmentRequest,
    context: CallerContext,
  ): Promise<DepartmentResponse> {
    return toDepartmentResponse(await this.load(request.id, context));
  }

  async createDepartment(
    request: CreateDepartmentRequest,
    context: CallerContext,
  ): Promise<DepartmentResponse> {
    const organizationId = requireTenant(context);
    const name = request.name.trim();

    const department = await this.createOrConflict(() =>
      this.prisma.department.create({
        data: {
          organizationId,
          name,
          description: request.description?.trim() || null,
        },
        include: DEPARTMENT_INCLUDE,
      }),
    );

    this.audit.record(context, {
      action: AuditAction.DEPARTMENT_CREATED,
      resourceType: AuditResourceType.DEPARTMENT,
      resourceId: department.id,
      metadata: { name: department.name },
    });

    return toDepartmentResponse(department);
  }

  async updateDepartment(
    request: UpdateDepartmentRequest,
    context: CallerContext,
  ): Promise<DepartmentResponse> {
    const existing = await this.load(request.id, context);

    // An absent field means "leave unchanged"; an empty description means
    // "clear it". Collapsing the two would make it impossible to remove a
    // description once set.
    const data: Prisma.DepartmentUpdateInput = {};
    if (request.name !== undefined) data.name = request.name.trim();
    if (request.description !== undefined) {
      data.description = request.description.trim() || null;
    }

    const department = await this.createOrConflict(() =>
      this.prisma.department.update({
        where: { id: existing.id },
        data,
        include: DEPARTMENT_INCLUDE,
      }),
    );

    this.audit.record(context, {
      action: AuditAction.DEPARTMENT_UPDATED,
      resourceType: AuditResourceType.DEPARTMENT,
      resourceId: department.id,
      // Before/after, so "who renamed Support to Tier 1?" is answerable. Both
      // columns are non-sensitive; nothing here needs redacting.
      metadata: {
        before: { name: existing.name, description: existing.description },
        after: { name: department.name, description: department.description },
      },
    });

    return toDepartmentResponse(department);
  }

  /**
   * Soft delete, BLOCKED while the department still has members.
   *
   * Deleting one with members silently strips their `is_primary` and their
   * document scoping — a permission and routing change nobody authorised. The
   * caller is told how many are in the way so they can reassign first.
   *
   * (The plan's real rule is "blocked while it holds open tickets". That is
   * Domain B and does not exist yet; membership is the same class of guard and
   * is checkable today.)
   */
  async deleteDepartment(
    request: DepartmentIdRequest,
    context: CallerContext,
  ): Promise<DeleteDepartmentResponse> {
    const department = await this.load(request.id, context);

    const memberCount = department._count.userDepartments;
    if (memberCount > 0) {
      throw new RpcException({
        // ABORTED, not FAILED_PRECONDITION: both are "the state is wrong", but
        // the gateway maps FAILED_PRECONDITION to 400 and ABORTED to 409 per
        // the canonical gRPC/HTTP table. This is a conflict with the CURRENT
        // state of the resource -- retryable once the members move -- which is
        // what 409 means and what api-endpoints-plan §1.5 specifies.
        code: status.ABORTED,
        message: `This department still has ${memberCount} member(s). Reassign them before deleting it.`,
      });
    }

    await this.prisma.department.update({
      where: { id: department.id },
      data: softDeleteData(requireActor(context)),
    });

    this.audit.record(context, {
      action: AuditAction.DEPARTMENT_DELETED,
      resourceType: AuditResourceType.DEPARTMENT,
      resourceId: department.id,
      metadata: { name: department.name },
    });

    return {};
  }

  async restoreDepartment(
    request: DepartmentIdRequest,
    context: CallerContext,
  ): Promise<DepartmentResponse> {
    // Deliberately NOT `this.load`, which excludes soft-deleted rows — the only
    // rows this method can act on.
    const existing = await this.prisma.department.findFirst({
      where: {
        id: request.id,
        ...tenantScope(context),
        deletedAt: { not: null },
      },
      select: { id: true, name: true },
    });
    if (!existing) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No deleted department with that id',
      });
    }

    // Clearing `deleted_at` re-enters `departments_org_name_key`, which is
    // partial on `WHERE deleted_at IS NULL`. If someone reused the name while
    // this row was deleted, that is a 409 rather than a 500.
    const department = await restoreOrConflict(
      () =>
        this.prisma.department.update({
          where: { id: existing.id },
          data: restoreData(),
          include: DEPARTMENT_INCLUDE,
        }),
      `Another department is already named '${existing.name}'. Rename it before restoring this one.`,
    );

    this.audit.record(context, {
      action: AuditAction.DEPARTMENT_RESTORED,
      resourceType: AuditResourceType.DEPARTMENT,
      resourceId: department.id,
      metadata: { name: department.name },
    });

    return toDepartmentResponse(department);
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  async listDepartmentMembers(
    request: ListDepartmentMembersRequest,
    context: CallerContext,
  ): Promise<ListDepartmentMembersResponse> {
    // Resolves the department under the tenant filter first, so a department id
    // from another tenant 404s here rather than returning its member list.
    const department = await this.load(request.departmentId, context);

    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      DEPARTMENT_MEMBER_SORTABLE_FIELDS,
    );

    const search = toSearchFilter(page.searchTerm);
    const where: Prisma.UserDepartmentWhereInput = {
      departmentId: department.id,
      user: {
        deletedAt: null,
        ...(search ? { OR: [{ fullName: search }, { email: search }] } : {}),
      },
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.userDepartment.findMany({
        where,
        include: {
          user: true,
          assignedBy: { select: { fullName: true } },
        },
        orderBy,
        skip,
        take,
      }),
      this.prisma.userDepartment.count({ where }),
    ]);

    return {
      items: items.map(toDepartmentMemberResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * Bulk add. Idempotent: re-adding an existing member updates the row rather
   * than failing on the composite primary key, so a retried request is safe.
   */
  async addDepartmentMembers(
    request: AddDepartmentMembersRequest,
    context: CallerContext,
  ): Promise<AddDepartmentMembersResponse> {
    const department = await this.load(request.departmentId, context);
    const actorId = requireActor(context);

    const userIds = [...new Set(request.userIds)];
    if (userIds.length === 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'No users given',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // EVERY user must be in the caller's tenant, and this is the only thing
      // that checks it: nothing in `user_departments` FKs prevents linking a
      // foreign user to your department, because both ids are individually
      // valid. Without this an admin could add another tenant's users and read
      // them back through the member list.
      const found = await tx.user.findMany({
        where: { id: { in: userIds }, ...tenantScope(context) },
        select: { id: true },
      });

      if (found.length !== userIds.length) {
        const known = new Set(found.map((user) => user.id));
        throw new RpcException({
          code: status.NOT_FOUND,
          // NOT_FOUND rather than PERMISSION_DENIED: "that user exists but is
          // not yours" confirms the id, turning this into a cross-tenant
          // existence oracle.
          message: `Unknown user(s): ${userIds.filter((id) => !known.has(id)).join(', ')}`,
        });
      }

      const existing = await tx.userDepartment.findMany({
        where: { departmentId: department.id, userId: { in: userIds } },
        select: { userId: true },
      });
      const existingIds = new Set(existing.map((row) => row.userId));

      // `updateMany` + `createMany` rather than N upserts: two statements
      // regardless of batch size.
      if (existingIds.size > 0) {
        await tx.userDepartment.updateMany({
          where: {
            departmentId: department.id,
            userId: { in: [...existingIds] },
          },
          data: { isPrimary: request.isPrimary, assignedById: actorId },
        });
      }

      const toCreate = userIds.filter((id) => !existingIds.has(id));
      if (toCreate.length > 0) {
        await tx.userDepartment.createMany({
          data: toCreate.map((userId) => ({
            userId,
            departmentId: department.id,
            isPrimary: request.isPrimary,
            assignedById: actorId,
          })),
        });
      }

      // Only one membership per user may be primary, enforced by a partial
      // unique index. Demoting the others HERE, inside the same transaction, is
      // what keeps that true — doing it afterwards leaves a window in which the
      // index rejects the write and the whole batch fails.
      if (request.isPrimary) {
        await tx.userDepartment.updateMany({
          where: {
            userId: { in: userIds },
            departmentId: { not: department.id },
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }

      return { addedCount: toCreate.length, updatedCount: existingIds.size };
    });

    this.audit.record(context, {
      action: AuditAction.DEPARTMENT_MEMBERS_ADDED,
      resourceType: AuditResourceType.DEPARTMENT,
      resourceId: department.id,
      metadata: { userIds, isPrimary: request.isPrimary, ...result },
    });

    return result;
  }

  /**
   * Removes one membership.
   *
   * **409 when it is the user's primary and they have others**, rather than
   * promoting one automatically. Silently reassigning someone's primary
   * department changes their ticket routing and their RAG document scope
   * without anyone deciding to — the caller must choose the replacement.
   *
   * Removing the ONLY membership is allowed: the user ends up in no department,
   * which nothing forbids, and blocking it would make an employee impossible to
   * take off a team.
   */
  async removeDepartmentMember(
    request: RemoveDepartmentMemberRequest,
    context: CallerContext,
  ): Promise<RemoveDepartmentMemberResponse> {
    const department = await this.load(request.departmentId, context);

    const membership = await this.prisma.userDepartment.findUnique({
      // Safe as a findUnique despite the rule in `tenantScope`: `department` was
      // already resolved under the tenant filter above, so this composite key is
      // pinned to a department the caller may see.
      where: {
        userId_departmentId: {
          userId: request.userId,
          departmentId: department.id,
        },
      },
      select: { isPrimary: true },
    });
    if (!membership) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'That user is not a member of this department',
      });
    }

    if (membership.isPrimary) {
      const otherCount = await this.prisma.userDepartment.count({
        where: {
          userId: request.userId,
          departmentId: { not: department.id },
        },
      });
      if (otherCount > 0) {
        throw new RpcException({
          // ABORTED -> 409, same reasoning as deleteDepartment above.
          code: status.ABORTED,
          message:
            "This is the user's primary department. Set another of their departments as primary first.",
        });
      }
    }

    await this.prisma.userDepartment.delete({
      where: {
        userId_departmentId: {
          userId: request.userId,
          departmentId: department.id,
        },
      },
    });

    this.audit.record(context, {
      action: AuditAction.DEPARTMENT_MEMBER_REMOVED,
      resourceType: AuditResourceType.DEPARTMENT,
      resourceId: department.id,
      metadata: { userId: request.userId, wasPrimary: membership.isPrimary },
    });

    return {};
  }

  // -------------------------------------------------------------------------

  /**
   * Single-row read, always `findFirst` with the tenant filter.
   *
   * `findUnique({ where: { id } })` is the tempting version and is a
   * cross-tenant read: its `where` accepts only unique fields, so the tenant
   * filter is inexpressible and another tenant's row comes back and gets
   * serialized. NOT_FOUND on a miss, never PERMISSION_DENIED — the latter
   * confirms the row exists.
   */
  private async load(
    id: string,
    context: CallerContext,
  ): Promise<DepartmentRow> {
    const department = await this.prisma.department.findFirst({
      where: { id, ...tenantScope(context) },
      include: DEPARTMENT_INCLUDE,
    });
    if (!department) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No department with that id',
      });
    }

    return department;
  }

  /**
   * Turns the name-uniqueness violation into a conflict.
   *
   * The index is partial (`WHERE deleted_at IS NULL`), so a pre-check would
   * still race two concurrent creates of the same name — the constraint is the
   * only thing that makes the duplicate impossible, and this reports it as what
   * it is.
   */
  private async createOrConflict<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'A department with that name already exists',
        });
      }
      throw error;
    }
  }
}

/**
 * ts-proto types every message-valued field as `T | undefined`, so a caller
 * that omits `page` entirely is representable. The defaults below are the same
 * ones the gateway DTO applies, so behaviour does not depend on which edge the
 * request came through.
 */
