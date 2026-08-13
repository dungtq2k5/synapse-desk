/**
 * What AI costs, and what happens when a tenant runs out of it.
 *
 * Three things live here because all three are needed by more than one service
 * and one of them will shortly be needed by a service written in a different
 * language:
 *
 *   - the PRICING table, which turns tokens into money
 *   - the QUOTA KEY format, which `rag-service` will also build (in Python)
 *   - the per-SURFACE policy at the cap, which is a product decision rather
 *     than something each caller should improvise
 */

/**
 * Cost per million tokens, in micros (millionths of a currency unit).
 *
 * Micros rather than floats: money in floating point accumulates error over
 * millions of rows, and a metering ledger is exactly where that compounds. Per
 * MILLION tokens rather than per token because the per-token figures are
 * fractions too small to express as integers.
 *
 * **A model missing from this table is a STARTUP error, not a silent zero.**
 * An unpriced model meters as free, which is precisely the hole the table
 * exists to close — and it would close it invisibly, reporting a tenant well
 * under budget while they spent freely. `assertPricingTableCovers` is what
 * turns that into a boot failure.
 */
export type ModelPricing = {
  /** Micros per 1,000,000 input tokens. */
  promptMicrosPerMillion: number;
  /** Micros per 1,000,000 output tokens. Zero for an embedding model. */
  completionMicrosPerMillion: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Generation — the QUALITY tier, sellable once billing lands (doc 15).
  'gemini-2.5-pro': {
    promptMicrosPerMillion: 1_250_000,
    completionMicrosPerMillion: 10_000_000,
  },
  // Embedding. No completion side at all, which is why the column is 0 rather
  // than absent: `completionTokens` is always 0 for EMBEDDING, so any non-zero
  // rate here would be unreachable and misleading.
  'gemini-embedding-2': {
    promptMicrosPerMillion: 200_000,
    completionMicrosPerMillion: 0,
  },
  // The FAST tier's generation model AND the cheap tier used for greeting
  // classification, reformulation and injection detection. One model, two
  // roles, one price — see `GENERATION_MODEL_BY_TIER` for why that is a
  // pricing decision rather than a merge.
  'gemini-3.5-flash-lite': {
    promptMicrosPerMillion: 300_000,
    completionMicrosPerMillion: 2_500_000,
  },
};

/** The pricing entry, or a thrown error naming the model. Never a silent zero. */
export function pricingFor(modelName: string): ModelPricing {
  const pricing = MODEL_PRICING[modelName];
  if (!pricing) {
    throw new Error(
      `No pricing for model '${modelName}'. Add it to MODEL_PRICING — an unpriced model meters as free.`,
    );
  }

  return pricing;
}

/**
 * Tokens -> money, at write time.
 *
 * Rounded UP. A fractional micro rounded down on every call under-counts
 * systematically, and the direction matters: an under-count lets a tenant spend
 * past their cap, while an over-count of at most one micro per call costs
 * nobody anything measurable.
 */
export function estimateCostMicros(
  modelName: string,
  promptTokens: number,
  completionTokens: number,
): bigint {
  const pricing = pricingFor(modelName);

  const prompt = Math.ceil(
    (promptTokens * pricing.promptMicrosPerMillion) / 1_000_000,
  );
  const completion = Math.ceil(
    (completionTokens * pricing.completionMicrosPerMillion) / 1_000_000,
  );

  return BigInt(prompt + completion);
}

/**
 * Fails at BOOT if any model the system is configured to use is unpriced.
 *
 * Called from the settings layer's startup path, not lazily at first use: an
 * unpriced model discovered at first use has already been billed as free at
 * least once, and the whole point is that it never is.
 */
export function assertPricingTableCovers(modelNames: string[]): void {
  const missing = modelNames.filter((name) => !MODEL_PRICING[name]);

  if (missing.length > 0) {
    throw new Error(
      `Unpriced model(s) configured: ${missing.join(', ')}. Add them to MODEL_PRICING before boot — an unpriced model meters as free.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The quota counter's key
// ---------------------------------------------------------------------------

/**
 * THE Redis key for a tenant's spend this cycle.
 *
 * One function, and it will shortly have a Python twin in `rag-service` —
 * because every service that spends increments this counter DIRECTLY rather
 * than over gRPC to whoever owns the ledger table. A cross-service hop on the
 * charge path would put a network round trip on every AI request to avoid
 * duplicating one string format; the format is duplicated instead, with a
 * contract test on both sides.
 *
 * **The cycle start is in the key on purpose.** A billing reset invalidates the
 * counter for free — no cache bust, no migration, no job. The old key simply
 * stops being read and expires on its own.
 *
 * Seconds, not milliseconds: Python's `datetime.timestamp()` yields seconds and
 * JavaScript's `getTime()` yields milliseconds, and that mismatch is the single
 * most likely way the two implementations silently disagree.
 */
export function quotaCounterKey(
  organizationId: string,
  billingCycleStart: Date,
): string {
  const epochSeconds = Math.floor(billingCycleStart.getTime() / 1000);

  return `quota:${organizationId}:${epochSeconds}`;
}

/**
 * The `notifications.event_id` for a threshold alert.
 *
 * Idempotency comes free from `UNIQUE (recipient_id, event_id)` — each
 * threshold fires exactly once per cycle with no extra bookkeeping, and because
 * the cycle start is in the key a billing reset re-arms every alert
 * automatically.
 */
export function quotaThresholdEventId(
  organizationId: string,
  billingCycleStart: Date,
  threshold: number,
): string {
  return `${quotaCounterKey(organizationId, billingCycleStart)}:${threshold}`;
}

/** 80 / 95 / 100, in the order they fire. */
export const QUOTA_ALERT_THRESHOLDS = [80, 95, 100] as const;

// ---------------------------------------------------------------------------
// What happens at the cap, per surface
// ---------------------------------------------------------------------------

/**
 * Every place the system spends AI budget.
 *
 * A surface is not the same thing as an `AiGenerationPurpose`: the purpose says
 * what the call WAS, this says what the caller should do when there is no money
 * left. `SUMMARY` appears twice below because a manually requested summary and
 * an escalation-triggered one are the same purpose with different answers at
 * the cap — which is exactly the distinction a bare purpose cannot make.
 */
export enum AiSurface {
  CHAT_ANSWER = 'CHAT_ANSWER',
  DRAFT = 'DRAFT',
  CLASSIFY = 'CLASSIFY',
  SUGGESTIONS = 'SUGGESTIONS',
  /** Requested by an agent pressing a button. Discretionary. */
  MANUAL_SUMMARY = 'MANUAL_SUMMARY',
  /** Fired automatically by `POST /tickets/:id/escalate`. */
  ESCALATION_SUMMARY = 'ESCALATION_SUMMARY',
  GREETING_CLASSIFY = 'GREETING_CLASSIFY',
  REFORMULATION = 'REFORMULATION',
  KNOWLEDGE_SEARCH = 'KNOWLEDGE_SEARCH',
  KNOWLEDGE_ASK = 'KNOWLEDGE_ASK',
  INGESTION_EMBEDDING = 'INGESTION_EMBEDDING',
}

/**
 * What a caller must do when the budget is gone.
 *
 * Returned rather than thrown, because three of these four are NOT errors — a
 * caller handed a bare exception would have to guess, and would guess
 * differently in each service.
 */
export enum AtCapAction {
  /** 402. The feature is unavailable and the user works without it. */
  REFUSE = 'REFUSE',
  /** Persist the user's message and route to a human. Never a bare error. */
  ESCALATE = 'ESCALATE',
  /** Answer anyway, with the free half. 200 plus a `degraded` marker. */
  DEGRADE = 'DEGRADE',
  /** Leave the work queued and resume at cycle roll. Never FAILED. */
  DEFER = 'DEFER',
}

/**
 * The at-cap policy table — RDM §1.14, decided here rather than discovered at
 * runtime.
 *
 * `graceRatio` is the escalation summary's exception, and it earns it: at the
 * cap two failures compound. Deflection stops, so ticket volume spikes 3-5x —
 * and every one of those tickets arrives WITHOUT a summary, because summaries
 * are an AI surface too. Agents get several times the work with none of the
 * context that makes them fast. An escalation summary is among the cheapest
 * calls the system makes and has its highest marginal value precisely when the
 * queue is flooded.
 *
 * The grace is BOUNDED at 10% rather than unlimited, because an unbounded
 * exemption is not a cap.
 */
export const AT_CAP_POLICY: Record<
  AiSurface,
  { action: AtCapAction; graceRatio: number }
> = {
  [AiSurface.CHAT_ANSWER]: { action: AtCapAction.ESCALATE, graceRatio: 0 },
  [AiSurface.DRAFT]: { action: AtCapAction.REFUSE, graceRatio: 0 },
  [AiSurface.CLASSIFY]: { action: AtCapAction.REFUSE, graceRatio: 0 },
  [AiSurface.SUGGESTIONS]: { action: AtCapAction.REFUSE, graceRatio: 0 },
  [AiSurface.MANUAL_SUMMARY]: { action: AtCapAction.REFUSE, graceRatio: 0 },
  [AiSurface.ESCALATION_SUMMARY]: {
    action: AtCapAction.REFUSE,
    graceRatio: 0.1,
  },
  // Layer 2 stops; Layer 1's regex and the canned reply are free at any budget,
  // so a greeting is still answered for nothing.
  [AiSurface.GREETING_CLASSIFY]: { action: AtCapAction.REFUSE, graceRatio: 0 },
  [AiSurface.REFORMULATION]: { action: AtCapAction.REFUSE, graceRatio: 0 },
  // The FTS arm needs no embedding and therefore costs nothing. A flat 402 here
  // would take away corpus diagnostics at the exact moment somebody is trying
  // to understand what happened.
  [AiSurface.KNOWLEDGE_SEARCH]: { action: AtCapAction.DEGRADE, graceRatio: 0 },
  // Retrieval could degrade, but the answer is a generation and there is no
  // free version of it.
  [AiSurface.KNOWLEDGE_ASK]: { action: AtCapAction.REFUSE, graceRatio: 0 },
  [AiSurface.INGESTION_EMBEDDING]: { action: AtCapAction.DEFER, graceRatio: 0 },
};

/** Allowed, or the specific thing this surface does instead. */
export type BudgetDecision =
  | { allowed: true; spentMicros: bigint; limitMicros: bigint }
  | {
      allowed: false;
      action: AtCapAction;
      spentMicros: bigint;
      limitMicros: bigint;
    };
