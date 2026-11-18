import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { CallerContext } from '@synapsedesk/contracts';
import { requireTenant } from './tenant-scope';

/**
 * **The tenant-scoped Prisma client**: a query extension that adds the
 * caller's tenant to every query on a tenant-owned model, so a forgotten
 * `organizationId` can't read or write another tenant's rows.
 *
 * Each service's `PrismaService` exposes it as `scoped(context)`, built from
 * that service's rule table (one rule per model, held complete by a test), and
 * keeps the bare client behind `unscoped(reason)` for what crosses tenants by
 * design. Soft delete is not this client's business: call sites keep their
 * `deletedAt: null`.
 */

/** How one model reaches its tenant. */
export type TenantRule =
  /** The model has an `organizationId` column. */
  | { kind: 'tenant' }
  /**
   * `organizationId`, or NULL for a row every tenant shares (auth's system
   * roles). Reads see both; a write names the caller's tenant.
   */
  | { kind: 'tenantOrGlobal' }
  /** The model IS the tenant (`Organization`): its `id` is the tenant. */
  | { kind: 'self' }
  /**
   * A child table with no tenant column: the relation filter that reaches one,
   * e.g. `(org) => ({ ticket: { organizationId: org } })`. Reads and bulk
   * writes are filtered through it; a create is the caller's to check, by
   * loading the parent scoped first.
   */
  | { kind: 'through'; where: (organizationId: string) => object }
  /** Not tenant data: a global catalog, a job heartbeat, a cursor. */
  | { kind: 'none' };

/** One rule per model, keyed by Prisma's model name (`TicketMessage`). */
export type TenantRules = Record<string, TenantRule>;

/**
 * Why a call site may use the bare client. A closed list, so every use is
 * greppable and reviewed; the guard in `packages/config` holds which files may.
 */
export const UNSCOPED_REASONS = [
  /** A sweep, rollup or retention job that walks every tenant. */
  'cross-tenant job',
  /** A queued job that carries only the id of a row this service wrote. */
  'job by row id',
  /** The platform console: a Super Admin naming any tenant. */
  'platform',
  /** Seeding, schema objects and the readiness check. */
  'schema',
  /** A caller that has no tenant yet: sign-in, sign-up, a token in a link. */
  'before a tenant',
  /**
   * A row keyed by a value unique across every tenant (a device's push
   * token), which moves to whichever tenant presents it.
   */
  'globally unique key',
] as const;

export type UnscopedReason = (typeof UNSCOPED_REASONS)[number];

const READS_AND_BULK = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const CREATES = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: unknown;
};

function filterFor(rule: TenantRule, organizationId: string): object | null {
  switch (rule.kind) {
    case 'tenant':
      return { organizationId };
    case 'tenantOrGlobal':
      return { OR: [{ organizationId }, { organizationId: null }] };
    case 'self':
      return { id: organizationId };
    case 'through':
      return rule.where(organizationId);
    case 'none':
      return null;
  }
}

/**
 * `where` with the tenant filter added under `AND`, which keeps every unique
 * field at the top for `findUnique`/`update`/`delete` and never clobbers an
 * `OR` the caller wrote.
 */
function withFilter(
  where: Record<string, unknown> | undefined,
  filter: object,
): Record<string, unknown> {
  const and: unknown = where?.AND;
  const existing: unknown[] =
    and === undefined ? [] : Array.isArray(and) ? and : [and];

  return { ...where, AND: [...existing, filter] };
}

/** One row's `data` for a create, with the tenant set or checked. */
function stamped(
  model: string,
  data: unknown,
  organizationId: string,
): unknown {
  const row = (data ?? {}) as Record<string, unknown>;
  const named = row.organizationId;

  if (named !== undefined && named !== organizationId) {
    throw new RpcException({
      code: status.INTERNAL,
      message: `A ${model} create names tenant ${JSON.stringify(named)} from a client scoped to ${organizationId}`,
    });
  }

  return { ...row, organizationId };
}

/**
 * The args a query runs with once scoped to `organizationId` under `rule`.
 * Pure, so every operation kind is unit-tested without a database.
 *
 * @example scopedArgs('Ticket', { kind: 'tenant' }, 'findUnique', { where: { id } }, org)
 * // { where: { id, AND: [{ organizationId: org }] } }
 */
export function scopedArgs(
  model: string,
  rule: TenantRule | undefined,
  operation: string,
  args: unknown,
  organizationId: string,
): unknown {
  if (!rule) {
    throw new RpcException({
      code: status.INTERNAL,
      message: `No tenant rule for model ${model}: add it to the service's rule table`,
    });
  }
  const filter = filterFor(rule, organizationId);
  if (!filter) return args;

  const given = (args ?? {}) as Args;

  if (READS_AND_BULK.has(operation)) {
    return { ...given, where: withFilter(given.where, filter) };
  }

  if (CREATES.has(operation) || operation === 'upsert') {
    if (rule.kind === 'self') {
      throw new RpcException({
        code: status.INTERNAL,
        message: `A tenant-scoped client can't create a ${model}: use the platform's unscoped client`,
      });
    }
    if (rule.kind === 'through') {
      // The parent was loaded scoped; the child's filter still guards reads.
      return operation === 'upsert'
        ? { ...given, where: withFilter(given.where, filter) }
        : args;
    }
    if (operation === 'upsert') {
      return {
        ...given,
        where: withFilter(given.where, filter),
        create: stamped(model, given.create, organizationId),
      };
    }

    const data = Array.isArray(given.data)
      ? given.data.map((row) => stamped(model, row, organizationId))
      : stamped(model, given.data, organizationId);

    return { ...given, data };
  }

  // A new Prisma operation is refused until this file knows how to scope it.
  throw new RpcException({
    code: status.INTERNAL,
    message: `The tenant-scoped client doesn't know how to scope ${model}.${operation}`,
  });
}

/**
 * The tenant a scoped client is bound to, or `null` for a Super Admin, who
 * has none and gets no tenant filter (soft delete stays at the call sites).
 * Anyone else without a tenant is refused, as `requireTenant` refuses them.
 */
export function scopeTenant(context: CallerContext): string | null {
  if (context.isSuperAdmin && !context.organizationId) return null;

  return requireTenant(context);
}

type QueryInput = {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

/**
 * The `$extends` argument that scopes every model query to the caller's
 * tenant. A service's `PrismaService.scoped()` passes it to its own client,
 * which keeps the model types intact.
 *
 * A Super Admin (no tenant) gets the same extension passing every query
 * through, so `scoped()` has one return type for every caller.
 *
 * @example this.$extends(tenantExtension(TENANT_RULES, context))
 */
export function tenantExtension(rules: TenantRules, context: CallerContext) {
  const organizationId = scopeTenant(context);

  return {
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }: QueryInput) {
          if (organizationId === null) return query(args);

          return query(
            scopedArgs(
              model ?? '?',
              rules[model ?? ''],
              operation,
              args,
              organizationId,
            ),
          );
        },
      },
    },
  };
}
