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
  Ticket: { kind: 'tenant' },
  InboundEmail: { kind: 'tenant' },
  TicketStatusChange: { kind: 'tenant' },
  TicketReadState: { kind: 'tenant' },
  AiResponseFeedback: { kind: 'tenant' },
  // Platform rows (no tenant) are a Super Admin's, who gets no filter.
  AuditLog: { kind: 'tenant' },
  TicketDailyStat: { kind: 'tenant' },
  AgentDailyStat: { kind: 'tenant' },
  Export: { kind: 'tenant' },
  TicketAssignment: {
    kind: 'through',
    where: (organizationId) => ({ ticket: { organizationId } }),
  },
  TicketMessage: {
    kind: 'through',
    where: (organizationId) => ({ ticket: { organizationId } }),
  },
  // On a message, or on the ticket's opening (no message).
  MessageAttachment: {
    kind: 'through',
    where: (organizationId) => ({
      OR: [
        { message: { ticket: { organizationId } } },
        { ticket: { organizationId } },
      ],
    }),
  },
  AiSummary: {
    kind: 'through',
    where: (organizationId) => ({ ticket: { organizationId } }),
  },
  JobRun: { kind: 'none' },
  // The hourly retry's queue, read only by that job across every tenant.
  PendingDraftOutcome: { kind: 'none' },
} satisfies Record<Prisma.ModelName, TenantRule>;

/**
 * ticket-service's own Prisma client, against its own database.
 *
 * Deliberately NOT shared with auth-service's: this is a different physical
 * Postgres, which is the whole reason cross-service ids carry no foreign key.
 * The two clients are generated from two schemas and are not interchangeable.
 */
/** The tenant-scoped client `scoped()` returns. */
export type ScopedClient = ReturnType<PrismaService['scoped']>;

/** The `tx` an interactive transaction on the scoped client hands its callback. */
export type ScopedTransaction = Parameters<
  Extract<
    Parameters<ScopedClient['$transaction']>[0],
    (...args: never[]) => unknown
  >
>[0];

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
