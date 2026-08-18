import { Injectable, Logger } from '@nestjs/common';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaCounterService } from '../ai-ledger/quota-counter.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';

/**
 * How far back to look for tenants worth reconciling.
 *
 * Only decides WHO to examine, never what to sum — each tenant's own
 * `billing_cycle_start` decides that. Wide enough that an hourly sweep cannot
 * miss a tenant between runs even after a long outage.
 */
const RECENT_SPEND_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Re-derives spend from the LEDGER and corrects the Redis counter.
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
    private readonly authReference: AuthReferenceService,
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

  /**
   * Every tenant with recent spend, each reconciled against **its OWN cycle**.
   *
   * **This took no parameter by design**. The previous signature
   * was `reconcileAll(cycleStart: Date)`, which applied one date to every
   * tenant and directly contradicted the warning on `reconcile()` above.
   *
   * The consequence was not a wrong log line. `QuotaCounterService` keys on
   * `quota:{org}:{cycleStartEpoch}`, so reconciling with the wrong cycle wrote
   * the corrected total **under a key the gate never reads** while leaving the
   * real key's drift untouched: a sweep that reported success and corrected
   * nothing. For a tenant whose cycle began after the passed date, the summed
   * "truth" also included spend from before their cycle started — so the number
   * written was wrong as well as misfiled.
   *
   * Cycles are resolved in ONE bulk call rather than one per tenant, and a
   * tenant whose cycle cannot be resolved is SKIPPED rather than guessed at.
   */
  async reconcileAll(): Promise<number> {
    // A window wide enough to catch anyone who has spent recently, without
    // scanning the whole ledger. It only decides WHO to look at — each tenant's
    // own cycle then decides what to sum, which is the part that must be right.
    const since = new Date(Date.now() - RECENT_SPEND_WINDOW_MS);

    const tenants = await this.prisma.aiGeneration.groupBy({
      by: ['organizationId'],
      where: { createdAt: { gte: since } },
    });
    if (tenants.length === 0) return 0;

    const cycles = await this.authReference.listOrganizationCycles(
      tenants.map((tenant) => tenant.organizationId),
    );

    let reconciled = 0;

    for (const tenant of tenants) {
      const cycleStart = cycles.get(tenant.organizationId);

      if (!cycleStart) {
        // Skipped, not defaulted. Reconciling against a guessed cycle is the
        // bug this method was rewritten to remove, and the existing drift
        // simply waits for the next hourly run.
        this.logger.warn(
          `No billing cycle for ${tenant.organizationId}; skipping its ` +
            `reconciliation rather than using a guess`,
        );
        continue;
      }

      await this.reconcile(tenant.organizationId, cycleStart);
      reconciled++;
    }

    return reconciled;
  }
}
