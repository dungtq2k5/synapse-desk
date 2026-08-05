import { Injectable, Logger } from '@nestjs/common';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaCounterService } from '../ai-ledger/quota-counter.service';

/**
 * Re-derives spend from the LEDGER and corrects the Redis counter — §4.4.
 *
 * **This is what makes `record()`'s non-throwing behaviour safe.** The ledger
 * write swallows failures on purpose: the generation already happened and
 * already cost money, so failing the request because bookkeeping failed loses
 * the work as well. The consequence is that the counter and `SUM()` WILL
 * diverge — drift is expected and bounded, not prevented — and something has to
 * converge them. This is that something.
 *
 * The direction matters: `SUM(estimated_cost_micros)` is the DEFINITION of
 * spend (RDM §1.14) and the counter is a cache of it, so reconciliation always
 * moves the counter, never the ledger.
 */
@Injectable()
export class QuotaReconciliationJob {
  private readonly logger = new Logger(QuotaReconciliationJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly counter: QuotaCounterService,
  ) {}

  /**
   * Reconciles one tenant's counter for the cycle it is currently in.
   *
   * Per tenant rather than a global sweep: the cycle start differs per tenant,
   * so there is no single window to sum over, and a job that assumed one would
   * silently reconcile everyone against whichever tenant's cycle it picked.
   */
  async reconcile(organizationId: string, cycleStart: Date): Promise<bigint> {
    const result = await this.prisma.aiGeneration.aggregate({
      where: { organizationId, createdAt: { gte: cycleStart } },
      _sum: { estimatedCostMicros: true },
    });

    const truth = result._sum.estimatedCostMicros ?? 0n;

    try {
      const before = await this.counter.spentMicros(organizationId, cycleStart);

      await this.counter.reconcile(organizationId, cycleStart, truth);

      if (before !== truth) {
        // Logged at WARN rather than silently corrected. Drift is expected,
        // but drift that GROWS is a symptom — a ledger writer failing
        // repeatedly, which nothing else surfaces because `record()` swallows.
        this.logger.warn(
          `Reconciled ${organizationId}: counter ${before} -> ledger ${truth} (drift ${truth - before})`,
        );
      }
    } catch (error) {
      // Non-fatal for one tenant, so a sweep over many does not stop at the
      // first unreachable key.
      this.logger.error(
        `Could not reconcile ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }

    return truth;
  }

  /** Every tenant that spent anything this cycle. */
  async reconcileAll(cycleStart: Date): Promise<number> {
    const tenants = await this.prisma.aiGeneration.groupBy({
      by: ['organizationId'],
      where: { createdAt: { gte: cycleStart } },
    });

    for (const tenant of tenants) {
      await this.reconcile(tenant.organizationId, cycleStart);
    }

    return tenants.length;
  }
}
