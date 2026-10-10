/**
 * @file The metric DEFINITIONS, and **step 2 of its build order is not
 * documentation, it is this file.**
 *
 * Every metric below has a plausible alternative reading, and two endpoints
 * computing "deflection" differently is worse than not having it at all. So
 * each one is a named function taking sums and counts: the second consumer
 * physically cannot compute it differently, because there is nothing to
 * compute — there is only a function to call.
 *
 * **Every rate returns its DENOMINATOR.** A percentage with a hidden
 * denominator is how *"our CSAT is 100%"* gets into a board deck on two
 * responses. The shape is deliberately awkward to unwrap: a caller that wants
 * the number alone has to reach past the count that qualifies it.
 *
 * Lives in `libs/common` rather than in one service because THREE consumers
 * need identical arithmetic — ticket-service and ingestion-service serving
 * their own rollups, and the gateway composing them — and a second copy is how
 * two dashboards start disagreeing.
 */

/**
 * A rate, and the count it was computed over.
 *
 * `rate` is null rather than 0 when the denominator is zero, and the
 * distinction is the whole point: *"nobody has rated anything"* and *"everybody
 * rated it negative"* are different facts, and rendering the first as 0% is a
 * wrong answer rather than a missing one.
 */
export type Rate = {
  /** `[0, 1]`, or null when there is nothing to divide. */
  rate: number | null;
  numerator: number;
  denominator: number;
};

/** A mean, and the count it was averaged over. Same reasoning as `Rate`. */
export type Mean = {
  mean: number | null;
  count: number;
};

/**
 * The one division in this file.
 *
 * Everything else delegates here, so "what happens when the denominator is
 * zero" is answered once. A second inline `a / b` anywhere in the codebase is
 * the bug this file exists to prevent.
 */
export function rateOf(numerator: number, denominator: number): Rate {
  return {
    rate: denominator > 0 ? numerator / denominator : null,
    numerator,
    denominator,
  };
}

export function meanOf(sum: number, count: number): Mean {
  return { mean: count > 0 ? sum / count : null, count };
}

/** The counters a ticket-side metric reads. Sums and counts only. */
export type TicketStatSums = {
  ticketsCreated: number;
  ticketsResolved: number;
  ticketsEscalated: number;
  chatConversations: number;
  chatResolvedWithoutEscalation: number;
  firstResponseSecondsSum: number;
  firstResponseCount: number;
  aiFirstResponseSecondsSum: number;
  aiFirstResponseCount: number;
  resolutionSecondsSum: number;
  resolutionCount: number;
  feedbackPositive: number;
  feedbackNegative: number;
  citationAccurateCount: number;
  citationRatedCount: number;
};

/**
 * **Deflection rate** — the product's headline claim (product-overview §7).
 *
 * `chat_resolved_without_escalation / chat_conversations`.
 *
 * **Not `1 − tickets/conversations`.** Agent-created and email tickets never
 * had a chance to be deflected, so including them makes the number move when
 * the AI did nothing differently — a metric that improves because a customer
 * changed how they file tickets is worse than no metric.
 */
export function deflectionRate(stats: TicketStatSums): Rate {
  return rateOf(stats.chatResolvedWithoutEscalation, stats.chatConversations);
}

/**
 * **Time to first response**, HUMAN only.
 *
 * The AI figure is deliberately a separate function. An AI reply in 2 seconds
 * genuinely is a first response — and blending it with human response time
 * produces a headline that improves whenever AI usage rises, which is the
 * metric measuring itself rather than the team.
 */
export function humanFirstResponseSeconds(stats: TicketStatSums): Mean {
  return meanOf(stats.firstResponseSecondsSum, stats.firstResponseCount);
}

export function aiFirstResponseSeconds(stats: TicketStatSums): Mean {
  return meanOf(stats.aiFirstResponseSecondsSum, stats.aiFirstResponseCount);
}

/**
 * **Resolution time** — `resolved_at − created_at`, resolved tickets only.
 *
 * This one is biased and the bias is knowable: excluding open tickets biases
 * OPTIMISTIC, because a ticket open for 40 days is invisible to it. The
 * endpoint reports median age of open tickets beside it for exactly that
 * reason, and the `count` here is what tells a reader how much of the queue the
 * number describes.
 */
export function resolutionSeconds(stats: TicketStatSums): Mean {
  return meanOf(stats.resolutionSecondsSum, stats.resolutionCount);
}

/**
 * **CSAT** — `positive / (positive + negative)`.
 *
 * Response rates on feedback are low single digits, so the denominator is not
 * optional context — it is most of the information. Two ratings is not a
 * satisfaction score.
 */
export function csat(stats: TicketStatSums): Rate {
  return rateOf(
    stats.feedbackPositive,
    stats.feedbackPositive + stats.feedbackNegative,
  );
}

/** Citation accuracy, over the ratings that actually answered the question. */
export function citationAccuracy(stats: TicketStatSums): Rate {
  return rateOf(stats.citationAccurateCount, stats.citationRatedCount);
}

/** The counters an AI-side metric reads. */
export type AiStatSums = {
  generations: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMsSum: number;
  latencyCount: number;
  failures: number;
  emptyRetrievals: number;
  attachmentGenerations: number;
  attachmentEmptyRetrievals: number;
  draftsAccepted: number;
  draftsEdited: number;
  draftsDiscarded: number;
};

/**
 * **Draft acceptance** — `accepted / (accepted + edited + discarded)`.
 *
 * The denominator NEEDS `DISCARDED`, which comes from the sweep.
 * Without it the denominator only ever contains drafts that were used, and
 * acceptance reports ~100% regardless of quality — a number that cannot go
 * down, which is the clearest possible sign it is measuring nothing.
 *
 * `EDITED` counts against acceptance deliberately: an agent who rewrote the
 * draft did not accept it, even though they sent something.
 */
export function draftAcceptanceRate(stats: AiStatSums): Rate {
  return rateOf(
    stats.draftsAccepted,
    stats.draftsAccepted + stats.draftsEdited + stats.draftsDiscarded,
  );
}

/**
 * The share of ATTACHMENT-FREE answering generations that retrieved nothing.
 *
 * The knowledge-gap headline: a question the corpus could not answer is a
 * content backlog item, not an error, and it appears in no other counter.
 *
 * **The attachment-grounded slice is subtracted out, and the reason is the
 * INFERENCE rather than the count.** Those rows are not factually wrong —
 * retrieval ran and returned nothing. What is wrong is what the rate is read to
 * mean: "the corpus is failing to answer questions it should answer". A
 * customer asking about their own invoice is asking something the corpus was
 * never expected to answer, so counting it conflates *the corpus had nothing*
 * with *the corpus should have had something*.
 *
 * Those rows are not discarded — {@link attachmentGroundedRate} reports them —
 * because "how many answers came from user files" is the signal that says a
 * corpus is being routed around, and excluding it silently makes that
 * invisible.
 */
export function emptyRetrievalRate(stats: AiStatSums): Rate {
  return rateOf(
    stats.emptyRetrievals - stats.attachmentEmptyRetrievals,
    stats.generations - stats.attachmentGenerations,
  );
}

/**
 * The share of answering generations that were given an attachment.
 *
 * **The half that would otherwise be thrown away.** Excluding attachment-
 * grounded answers from the gap rate fixes the rate and loses a real number: a
 * corpus being routed around looks identical to a corpus nobody is asking
 * about. Reported beside the rate rather than folded into it, because they
 * answer different questions.
 */
export function attachmentGroundedRate(stats: AiStatSums): Rate {
  return rateOf(stats.attachmentGenerations, stats.generations);
}

export function failureRate(stats: AiStatSums): Rate {
  return rateOf(stats.failures, stats.generations);
}

export function meanLatencyMs(stats: AiStatSums): Mean {
  return meanOf(stats.latencyMsSum, stats.latencyCount);
}

/** Micros → whole currency units, for display only. Never used in arithmetic. */
export function costFromMicros(costMicros: number): number {
  return costMicros / 1_000_000;
}

/** Zeroed sums, so a tenant with no rows reads as zero rather than as an error. */
export const EMPTY_TICKET_STATS: TicketStatSums = {
  ticketsCreated: 0,
  ticketsResolved: 0,
  ticketsEscalated: 0,
  chatConversations: 0,
  chatResolvedWithoutEscalation: 0,
  firstResponseSecondsSum: 0,
  firstResponseCount: 0,
  aiFirstResponseSecondsSum: 0,
  aiFirstResponseCount: 0,
  resolutionSecondsSum: 0,
  resolutionCount: 0,
  feedbackPositive: 0,
  feedbackNegative: 0,
  citationAccurateCount: 0,
  citationRatedCount: 0,
};

export const EMPTY_AI_STATS: AiStatSums = {
  generations: 0,
  promptTokens: 0,
  completionTokens: 0,
  costMicros: 0,
  latencyMsSum: 0,
  latencyCount: 0,
  failures: 0,
  emptyRetrievals: 0,
  attachmentGenerations: 0,
  attachmentEmptyRetrievals: 0,
  draftsAccepted: 0,
  draftsEdited: 0,
  draftsDiscarded: 0,
};

/** Adds two rows' counters. The only way totals are produced. */
export function addTicketStats(
  left: TicketStatSums,
  right: TicketStatSums,
): TicketStatSums {
  return {
    ticketsCreated: left.ticketsCreated + right.ticketsCreated,
    ticketsResolved: left.ticketsResolved + right.ticketsResolved,
    ticketsEscalated: left.ticketsEscalated + right.ticketsEscalated,
    chatConversations: left.chatConversations + right.chatConversations,
    chatResolvedWithoutEscalation:
      left.chatResolvedWithoutEscalation + right.chatResolvedWithoutEscalation,
    firstResponseSecondsSum:
      left.firstResponseSecondsSum + right.firstResponseSecondsSum,
    firstResponseCount: left.firstResponseCount + right.firstResponseCount,
    aiFirstResponseSecondsSum:
      left.aiFirstResponseSecondsSum + right.aiFirstResponseSecondsSum,
    aiFirstResponseCount:
      left.aiFirstResponseCount + right.aiFirstResponseCount,
    resolutionSecondsSum:
      left.resolutionSecondsSum + right.resolutionSecondsSum,
    resolutionCount: left.resolutionCount + right.resolutionCount,
    feedbackPositive: left.feedbackPositive + right.feedbackPositive,
    feedbackNegative: left.feedbackNegative + right.feedbackNegative,
    citationAccurateCount:
      left.citationAccurateCount + right.citationAccurateCount,
    citationRatedCount: left.citationRatedCount + right.citationRatedCount,
  };
}

export function addAiStats(left: AiStatSums, right: AiStatSums): AiStatSums {
  return {
    generations: left.generations + right.generations,
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    costMicros: left.costMicros + right.costMicros,
    latencyMsSum: left.latencyMsSum + right.latencyMsSum,
    latencyCount: left.latencyCount + right.latencyCount,
    failures: left.failures + right.failures,
    emptyRetrievals: left.emptyRetrievals + right.emptyRetrievals,
    attachmentGenerations:
      left.attachmentGenerations + right.attachmentGenerations,
    attachmentEmptyRetrievals:
      left.attachmentEmptyRetrievals + right.attachmentEmptyRetrievals,
    draftsAccepted: left.draftsAccepted + right.draftsAccepted,
    draftsEdited: left.draftsEdited + right.draftsEdited,
    draftsDiscarded: left.draftsDiscarded + right.draftsDiscarded,
  };
}

/** How a time series is bucketed. */
export enum AnalyticsGranularity {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export const ANALYTICS_GRANULARITIES = Object.values(AnalyticsGranularity);

/**
 * The widest range a single request may ask for.
 *
 * Not a paranoid limit: a five-year range over daily rows is 1,825 buckets per
 * department, which is a response no dashboard renders and a query that holds a
 * connection while it serializes. Multi-year ranges are the warehouse's job.
 *
 */
export const MAX_ANALYTICS_RANGE_DAYS = 400;

/**
 * The tenant's analytics window, composed against the platform's.
 *
 * **One function, called by BOTH analytics services**, because the failure this
 * limit invites is divergence rather than absence: `ai-analytics.service.ts` and
 * `analytics.service.ts` each guard their own `parseRange`, and a window
 * honoured by one and not the other means the history a tenant can see depends
 * on which page they opened. Two correct-looking implementations would each
 * pass their own suite.
 *
 * `?? 0` and not `?? MAX_ANALYTICS_RANGE_DAYS`: the column is NOT NULL and the
 * proto field is not `optional`, so absent is a wire that lost a field, and
 * refusing every range is the loud direction — the same asymmetry the byte
 * limits carry.
 *
 * @param granted the tenant's `maxAnalyticsRangeDays`, off `OrganizationResponse`.
 * @returns the number of days a range may span.
 *
 * @example
 * resolveAnalyticsRangeDays(30)        // 30  — the plan narrows
 * resolveAnalyticsRangeDays(9_000)     // 400 — the platform still binds
 * resolveAnalyticsRangeDays(undefined) // 0   — refuses, rather than widening
 */
export function resolveAnalyticsRangeDays(granted: number | undefined): number {
  return Math.min(MAX_ANALYTICS_RANGE_DAYS, granted ?? 0);
}

/**
 * How many rows a top-N list returns — knowledge gaps, document lists.
 *
 * Its own constant rather than `DEFAULT_SEARCH`: these lists are read as "the
 * worst offenders", where a page of ten is too short to spot a pattern, so the
 * default is deliberately higher than the paginated one.
 */
export const ANALYTICS_TOP_N = {
  MIN: 1,
  MAX: 100,
  DEFAULT: 20,
} as const;
