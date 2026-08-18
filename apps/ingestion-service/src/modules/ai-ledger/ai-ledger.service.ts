import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { randomUUID } from 'node:crypto';
import { CallerContext } from '@synapsedesk/grpc-proto';
import {
  AiGenerationOutcome,
  isSameText,
  AiGenerationPurpose,
  AiGenerationStatus,
  AiSurface,
  AT_CAP_POLICY,
  AtCapAction,
  BudgetDecision,
  estimateCostMicros,
  formatErrorMsg,
  QUOTA_ALERT_THRESHOLDS,
  withHttpStatus,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { QuotaCounterService } from './quota-counter.service';
import { QuotaAlertService } from './quota-alert.service';

/** One AI call, as it is written to the ledger. */
export type AiGenerationEntry = {
  organizationId: string;
  /** NULL for system-initiated work — ingestion embeddings, scheduled jobs. */
  userId?: string | null;
  ticketId?: string | null;
  purpose: AiGenerationPurpose;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs?: number;
  status?: AiGenerationStatus;
  content?: string | null;
  retrievedChunkIds?: string[];
  citedChunkIds?: string[];
};

/**
 * Every LLM and embedding call goes through this. There is no other write path.
 *
 * Three methods, and the split between them is the design (RDM §1.14):
 *
 *   - **`checkBudget`** reads Redis, never `SUM()`. The sum is the DEFINITION
 *     of spend and a growing scan on the hot path.
 *   - **`charge`** is SYNCHRONOUS and awaited. One INCRBY, sub-millisecond,
 *     deliberately on the hot path — the only thing between a burst of
 *     concurrent requests and all of them passing a stale gate.
 *   - **`record`** is fire-and-forget and NON-THROWING. The generation already
 *     cost money; failing the request because bookkeeping failed loses the work
 *     AND the money. Reconciliation fixes the drift.
 *
 * Merging charge into record reopens the exact hole the counter closes, by
 * making the increment asynchronous.
 *
 * See `docs/decisions/0005-meter-cost-not-tokens.md`.
 */
@Injectable()
export class AiLedgerService {
  private readonly logger = new Logger(AiLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly counter: QuotaCounterService,
    private readonly authReference: AuthReferenceService,
    private readonly alerts: QuotaAlertService,
  ) {}

  /**
   * Allowed, or the specific thing THIS surface does instead.
   *
   * Returns a decision rather than throwing, because three of the four at-cap
   * actions are not errors: chat escalates, knowledge search degrades, and
   * ingestion defers. A caller handed a bare exception would have to guess what
   * its surface is supposed to do, and would guess differently in each service
   * — which is the failure this signature exists to prevent.
   */
  async checkBudget(
    organizationId: string,
    surface: AiSurface,
    context: CallerContext,
  ): Promise<BudgetDecision> {
    const policy = AT_CAP_POLICY[surface];
    const entitlement = await this.authReference.getAiEntitlement(context);
    const limitMicros = entitlement.budgetMicros;

    let spentMicros: bigint;
    try {
      spentMicros = await this.counter.spentMicros(
        organizationId,
        entitlement.billingCycleStart,
      );
    } catch (error) {
      // FAILS CLOSED. Returning "allowed" on an unreachable Redis would open
      // the gate for every tenant at once, at exactly the moment nobody can see
      // what is being spent. The surface's own at-cap action still applies, so
      // chat escalates rather than erroring even during a Redis outage.
      this.logger.error(
        `Quota counter unreadable for ${organizationId}; failing closed: ${formatErrorMsg(error)}`,
      );
      return {
        allowed: false,
        action: policy.action,
        spentMicros: 0n,
        limitMicros,
      };
    }

    // The grace is applied HERE rather than by the caller, so a surface cannot
    // accidentally grant itself one. Only ESCALATION_SUMMARY has a non-zero
    // ratio, and it is bounded at 10% — an unbounded exemption is not a cap.
    const effectiveLimit =
      limitMicros + BigInt(Math.floor(Number(limitMicros) * policy.graceRatio));

    if (spentMicros >= effectiveLimit) {
      return {
        allowed: false,
        action: policy.action,
        spentMicros,
        limitMicros,
      };
    }

    return { allowed: true, spentMicros, limitMicros };
  }

  /**
   * The convenience wrapper for surfaces whose at-cap action IS "refuse".
   *
   * Answers **402 Payment Required**, carried across the wire by
   * `withHttpStatus` because no gRPC code means it: `RESOURCE_EXHAUSTED` maps
   * to 429 and legitimately so — OTP throttling uses it to say "slow down",
   * which is a different instruction from "buy more" — while 403 would send an
   * admin looking at role grants for a problem that has nothing to do with
   * roles.
   *
   * Calling this for a surface whose action is ESCALATE or DEGRADE is a
   * programming error and says so — those callers must read the decision.
   */
  async assertWithinBudget(
    organizationId: string,
    surface: AiSurface,
    context: CallerContext,
  ): Promise<void> {
    const decision = await this.checkBudget(organizationId, surface, context);
    if (decision.allowed) return;

    if (decision.action !== AtCapAction.REFUSE) {
      throw new Error(
        `${surface} is a ${decision.action} surface — read the decision from checkBudget() instead of asserting.`,
      );
    }

    throw new RpcException({
      code: status.RESOURCE_EXHAUSTED,
      message: withHttpStatus(
        402,
        'This workspace has used its AI allowance for the current billing cycle',
      ),
    });
  }

  /**
   * SYNCHRONOUS and awaited by the caller.
   *
   * Also where the threshold ladder fires, because the post-increment total is
   * the only value that can tell 79% from 81% — computing it separately would
   * race every concurrent charge.
   */
  async charge(
    organizationId: string,
    costMicros: bigint,
    context: CallerContext,
  ): Promise<void> {
    const entitlement = await this.authReference.getAiEntitlement(context);

    try {
      const total = await this.counter.charge(
        organizationId,
        entitlement.billingCycleStart,
        costMicros,
      );

      // Fire-and-forget: a notification that fails must not fail the request
      // that already spent the money.
      this.alerts.maybeAlert(
        organizationId,
        entitlement.billingCycleStart,
        total,
        entitlement.budgetMicros,
      );
    } catch (error) {
      // Swallowed, and this is the deliberate asymmetry: the GATE fails closed,
      // the CHARGE fails open. By the time we are here the model has already
      // run and the money is already gone — refusing the caller their answer
      // would lose the work as well as the money, and the ledger row below plus
      // reconciliation is what recovers the number.
      this.logger.error(
        `Could not charge ${costMicros} micros to ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }
  }

  /**
   * The durable row. Fire-and-forget, non-throwing, returns immediately.
   *
   * Returns the id SYNCHRONOUSLY — before the write completes — because the
   * caller needs it in the response body (`generatedFromId` closes the draft
   * acceptance loop) and awaiting a durable write for an id we already know
   * would put a Postgres round trip on the streaming path.
   */
  record(entry: AiGenerationEntry): string {
    const id = randomUUID();

    const costMicros = this.safeCost(entry);

    void this.prisma.aiGeneration
      .create({
        data: {
          id,
          organizationId: entry.organizationId,
          userId: entry.userId ?? null,
          ticketId: entry.ticketId ?? null,
          purpose: entry.purpose,
          modelName: entry.modelName,
          promptTokens: entry.promptTokens,
          completionTokens: entry.completionTokens,
          estimatedCostMicros: costMicros,
          latencyMs: entry.latencyMs ?? null,
          status: entry.status ?? AiGenerationStatus.SUCCESS,
          content: entry.content ?? null,
          retrievedChunkIds: entry.retrievedChunkIds ?? [],
          citedChunkIds: entry.citedChunkIds ?? [],
        },
      })
      .catch((error: unknown) => {
        // Swallowed and logged, like `AuditPublisher`. The consequence is
        // honest: the Redis counter and `SUM()` will now DISAGREE, and
        // reconciliation is what restores agreement. A test asserts the
        // divergence and the convergence, rather than pretending they always
        // match.
        this.logger.error(
          `Ledger write failed for ${entry.organizationId} (${entry.purpose}): ${formatErrorMsg(error)}`,
        );
      });

    return id;
  }

  /**
   * Charge AND record, in the right order, for the ordinary caller.
   *
   * The order is load-bearing and is the reason this convenience exists: charge
   * first and awaited, record second and not. Callers writing the two lines
   * themselves get it backwards eventually, and backwards means the counter
   * lags every burst.
   */
  async chargeAndRecord(
    entry: AiGenerationEntry,
    context: CallerContext,
  ): Promise<string> {
    await this.charge(entry.organizationId, this.safeCost(entry), context);

    return this.record(entry);
  }

  /**
   * Re-derives the true spend from the ledger and corrects the counter.
   *
   * The ledger is the definition; Redis is the fast answer. This is what makes
   * a swallowed `record()` failure recoverable rather than permanent — and it
   * is why the invariant worth testing is "reconciliation converges", not "the
   * two always agree".
   */
  /**
   * Classifies a draft the agent actually sent — the acceptance loop's close.
   *
   * The comparison is NORMALISED (NFC, whitespace collapse, trim). Exact
   * equality systematically understates acceptance: a rich-text editor adds a
   * trailing newline or emits a decomposed accent, and a draft nobody touched
   * reports as EDITED. That number is the whole justification for the co-pilot,
   * so it has to measure what a person would call an edit.
   *
   * A generation that no longer exists is NOT_FOUND rather than a silent
   * no-op: the caller is about to tell a user their reply was sent, and a
   * quietly dropped outcome makes the acceptance rate wrong in a way that
   * cannot be reconstructed.
   */
  async recordOutcome(
    generationId: string,
    resultingMessageId: string,
    sentText: string,
  ): Promise<AiGenerationOutcome> {
    const generation = await this.prisma.aiGeneration.findUnique({
      where: { id: generationId },
      select: { content: true },
    });
    if (!generation) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `No generation with id '${generationId}'`,
      });
    }

    const outcome = isSameText(generation.content ?? '', sentText)
      ? AiGenerationOutcome.ACCEPTED
      : AiGenerationOutcome.EDITED;

    await this.prisma.aiGeneration.update({
      where: { id: generationId },
      data: { outcome, resultingMessageId },
    });

    return outcome;
  }

  async reconcile(
    organizationId: string,
    billingCycleStart: Date,
  ): Promise<bigint> {
    const result = await this.prisma.aiGeneration.aggregate({
      where: {
        organizationId,
        createdAt: { gte: billingCycleStart },
      },
      _sum: { estimatedCostMicros: true },
    });

    const trueSpend = result._sum.estimatedCostMicros ?? 0n;
    await this.counter.reconcile(organizationId, billingCycleStart, trueSpend);

    return trueSpend;
  }

  /**
   * Cost, or zero plus a loud log.
   *
   * `pricingFor` throws for an unpriced model, and that throw must not escape:
   * `record` is non-throwing by contract, and a caller whose request died
   * because a pricing entry was missing would lose an answer that had already
   * been paid for. The startup check is what makes this branch unreachable in
   * practice — this is the belt to that's braces, and it logs loudly enough to
   * be found.
   */
  private safeCost(entry: AiGenerationEntry): bigint {
    try {
      return estimateCostMicros(
        entry.modelName,
        entry.promptTokens,
        entry.completionTokens,
      );
    } catch (error) {
      this.logger.error(
        `Metering as ZERO — ${formatErrorMsg(error)}. This under-counts spend and must be fixed.`,
      );
      return 0n;
    }
  }

  /** Exposed for the alert service's threshold arithmetic. */
  static thresholdsCrossed(
    previousMicros: bigint,
    currentMicros: bigint,
    limitMicros: bigint,
  ): number[] {
    if (limitMicros <= 0n) return [];

    const percent = (value: bigint) => Number((value * 100n) / limitMicros);

    const before = percent(previousMicros);
    const after = percent(currentMicros);

    return QUOTA_ALERT_THRESHOLDS.filter(
      (threshold) => before < threshold && after >= threshold,
    );
  }
}
