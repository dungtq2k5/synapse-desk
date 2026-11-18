import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { CallerContext } from '@synapsedesk/contracts';
import {
  tenantExtension,
  type TenantRule,
  type UnscopedReason,
} from '@synapsedesk/nest-common';
import { Prisma, PrismaClient } from '../../generated/prisma/client';

/**
 * How each model reaches its tenant. `satisfies` holds it complete: a new
 * model fails to compile until it has a rule.
 */
export const TENANT_RULES = {
  // The tenant itself: read by id = tenant, never created through scope.
  Organization: { kind: 'self' },
  Department: { kind: 'tenant' },
  // A Super Admin's row has no tenant, and a Super Admin gets no filter.
  User: { kind: 'tenant' },
  // System roles have no tenant and every tenant reads them.
  Role: { kind: 'tenantOrGlobal' },
  UserInvitation: { kind: 'tenant' },
  BillingEvent: { kind: 'tenant' },
  LimitAlertGeneration: { kind: 'tenant' },
  UserDepartment: {
    kind: 'through',
    where: (organizationId) => ({ user: { organizationId } }),
  },
  DeviceSession: {
    kind: 'through',
    where: (organizationId) => ({ user: { organizationId } }),
  },
  TwoFactorBackupCode: {
    kind: 'through',
    where: (organizationId) => ({ user: { organizationId } }),
  },
  Otp: {
    kind: 'through',
    where: (organizationId) => ({ user: { organizationId } }),
  },
  PasswordResetToken: {
    kind: 'through',
    where: (organizationId) => ({ user: { organizationId } }),
  },
  Permission: { kind: 'none' },
  SubscriptionPlan: { kind: 'none' },
  SubscriptionPlanPrice: { kind: 'none' },
  JobRun: { kind: 'none' },
} satisfies Record<Prisma.ModelName, TenantRule>;

/** The tenant-scoped client `scoped()` returns. */
export type ScopedClient = ReturnType<PrismaService['scoped']>;

/** The `tx` an interactive transaction on the scoped client hands its callback. */
export type ScopedTransaction = Parameters<
  Extract<
    Parameters<ScopedClient['$transaction']>[0],
    (...args: never[]) => unknown
  >
>[0];

/**
 * A transaction on either client, for the helpers both kinds of caller share
 * (a tenant's admin, and sign-up or the platform). At runtime a scoped one
 * keeps its filter; the type is the bare client's for the calls.
 */
export type AnyTransaction = ScopedTransaction | Prisma.TransactionClient;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      }),
    });
  }

  /**
   * This client bound to the caller's tenant: every query on a tenant-owned
   * model carries it. A system caller (`systemContext(orgId)`) is scoped like
   * anyone else; a Super Admin gets no tenant filter.
   *
   * @example await this.prisma.scoped(context).ticket.findMany()
   */
  scoped(context: CallerContext) {
    return this.$extends(tenantExtension(TENANT_RULES, context));
  }

  /**
   * The bare client, for what crosses tenants by design. `reason` comes from
   * a closed list, and the guard in `packages/config` holds which files may
   * call this.
   */
  unscoped(reason: UnscopedReason): PrismaClient {
    void reason;
    return this;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
