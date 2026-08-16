/**
 * The analytics shapes the GraphQL schema serves — 19-doc §3, 26-doc §3.
 *
 * **Analytics is a WHOLE SHAPE, not an entity graph.** The overview is one
 * composed read with its own caching and its own daily rollups behind it
 * (19-doc). Decomposing it into resolvable fields would re-run that composition
 * per field: `deflection` and `csat` come from the same query, so a client
 * asking for both would pay for it twice, while a client asking for one would
 * still pay for the whole rollup join. So there are no edges here, and 26-doc §7
 * defers `@ResolveField` into analytics permanently rather than "for now".
 *
 * **Four of the ten REST reads appear here, and the rule is composition rather
 * than parity** — 26-doc §3.1. A read earns a GraphQL query when its rows carry
 * entity ids an existing loader can resolve, or when it is the headline figure
 * a screen opens with. The chart series — `DeflectionDto`, `VolumeDto`,
 * `AiUsageDto` and the rest — are buckets and numbers with no entity id in any
 * row: there is nothing to traverse to, so a query for one would be a REST call
 * with more syntax and a second cache path.
 *
 * That is also why these are separate classes rather than one set shared with
 * `../rest/`: the two surfaces genuinely expose different amounts of this
 * domain, and a shared base could only have covered the overlap.
 *
 * **Every rate carries its denominator, at every level.** A percentage with a
 * hidden denominator is how *"our CSAT is 100%"* reaches a board deck on two
 * responses, and the shape here makes that impossible to do accidentally: there
 * is no bare number to read.
 */

import { DocumentFlagType } from '@synapsedesk/common';
import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('Rate')
export class RateGqlDto {
  /** null when the denominator is zero — NOT zero. The two are different facts. */
  @Field(() => Float, { nullable: true })
  rate!: number | null;

  @Field(() => Int)
  numerator!: number;

  @Field(() => Int)
  denominator!: number;
}

@ObjectType('Mean')
export class MeanGqlDto {
  @Field(() => Float, { nullable: true })
  mean!: number | null;

  @Field(() => Int)
  count!: number;
}

@ObjectType('AnalyticsOverview')
export class AnalyticsOverviewGqlDto {
  @Field(() => Int)
  ticketsCreated!: number;

  @Field(() => Int)
  ticketsResolved!: number;

  @Field(() => Int)
  ticketsEscalated!: number;

  @Field(() => Int)
  openTickets!: number;

  @Field(() => RateGqlDto)
  deflection!: RateGqlDto;

  @Field(() => RateGqlDto)
  csat!: RateGqlDto;

  /** Reported apart from the AI figure, always. */
  @Field(() => MeanGqlDto)
  humanFirstResponseSeconds!: MeanGqlDto;

  @Field(() => MeanGqlDto)
  aiFirstResponseSeconds!: MeanGqlDto;

  @Field(() => MeanGqlDto)
  resolutionSeconds!: MeanGqlDto;

  /**
   * The counterweight to `resolutionSeconds`, which can only see tickets that
   * closed and is therefore biased optimistic.
   */
  @Field(() => Float, { nullable: true })
  openTicketMedianAgeSeconds!: number | null;

  /** When the rollups behind this answer ran. */
  @Field(() => Date, { nullable: true })
  computedAt!: Date | null;

  /**
   * **The last day the rollups behind this answer cover** — 20-doc §4.3,
   * `YYYY-MM-DD`, or `null` when no rollup has ever run for this tenant.
   *
   * Not the same as `computedAt`, and the gap between them is the diagnosis: a
   * recent `computedAt` beside a `dataThrough` two weeks old means the job runs
   * and finds nothing, while `dataThrough: null` means it has never run at all.
   */
  @Field(() => String, { nullable: true })
  dataThrough!: string | null;
}

/**
 * A leg that did not answer — 19-doc §1.
 *
 * **Present on every composed read, and never merged into the numbers.** A
 * dashboard where nine tiles render and one names the service that is down is
 * what somebody diagnosing an incident actually needs; a 500 for the whole
 * query, or a silent zero, is not. A zero and a missing leg look identical in a
 * chart and mean opposite things.
 */
@ObjectType('UnavailableBlock')
export class UnavailableBlockGqlDto {
  /** Which leg failed, by service name. */
  @Field(() => String)
  source!: string;

  @Field(() => String)
  reason!: string;
}

/**
 * One agent's row — 26-doc §3.1, and the read that justifies the whole rule.
 *
 * **`agent` is an edge, not a hydration step.** The REST endpoint resolves
 * names in `analytics.service.ts` as a third leg, called last and
 * unconditionally; here it is `AgentStat.agent`, a field resolver over the
 * users loader that already exists — batched with every other user on the
 * request, and skipped entirely by a client that only wants the numbers. That
 * is GraphQL doing something the REST composition cannot, rather than reaching
 * parity with it.
 *
 * **`fullName` is deliberately absent, and it is the one field that could not
 * stay.** Carrying it would mean running the hydration leg to fill it, which is
 * exactly the round trip the edge exists to avoid — and a client would then
 * have two ways to ask for the same name, one of them unconditionally paid for.
 * `agent { fullName }` is the way.
 */
@ObjectType('AgentStat')
export class AgentStatGqlDto {
  /**
   * The agent's id, flat beside the `agent` edge — 26-doc §3.
   *
   * Same rule as `Ticket.currentAssigneeId`: a client that only wants the id
   * must not pay a network call for it.
   */
  @Field(() => ID)
  agentId!: string;

  @Field(() => Int)
  assigned!: number;

  @Field(() => Int)
  resolved!: number;

  @Field(() => Int)
  messagesSent!: number;

  @Field(() => MeanGqlDto)
  resolutionSeconds!: MeanGqlDto;

  /** From the AI ledger. Null when that leg was unavailable — see above. */
  @Field(() => RateGqlDto, { nullable: true })
  draftAcceptance!: RateGqlDto | null;
}

@ObjectType('AgentAnalytics')
export class AgentAnalyticsGqlDto {
  @Field(() => [AgentStatGqlDto])
  items!: AgentStatGqlDto[];

  /**
   * **The STALEST leg's coverage**, not the freshest — 19-doc §3.2.
   *
   * This spans two schedulers in two services, so one can be days behind the
   * other, and reporting the fresher would let the healthy one vouch for the
   * broken one.
   */
  @Field(() => String, { nullable: true })
  dataThrough!: string | null;

  @Field(() => [UnavailableBlockGqlDto])
  unavailable!: UnavailableBlockGqlDto[];
}

/**
 * One document's retrieval and citation counts.
 *
 * `document` is the edge that gave `ListDocumentsByIds` its first consumer —
 * 27-doc §3. Nullable, because a rollup row outlives the document it counts:
 * the id stays in `document_daily_stats` after a delete, and a null edge beside
 * a live `title` is the honest rendering of that.
 */
@ObjectType('DocumentUsage')
export class DocumentUsageGqlDto {
  @Field(() => ID)
  documentId!: string;

  /** The title AS THE ROLLUP RECORDED IT — see the class note on staleness. */
  @Field(() => String)
  title!: string;

  @Field(() => Int)
  retrievalCount!: number;

  @Field(() => Int)
  citationCount!: number;

  @Field(() => Int)
  chunkCount!: number;
}

@ObjectType('DocumentAnalytics')
export class DocumentAnalyticsGqlDto {
  @Field(() => [DocumentUsageGqlDto])
  mostCited!: DocumentUsageGqlDto[];

  /**
   * **Two DIFFERENT findings** (RDM Table 27), never merged into one list.
   *
   * A document nothing retrieves is invisible to search; one retrieved and
   * never cited is found and unhelpful. The fixes are opposite — retitle it
   * versus rewrite it — so a combined "unused documents" list would send every
   * reader down the wrong one half the time.
   */
  @Field(() => [DocumentUsageGqlDto])
  neverRetrieved!: DocumentUsageGqlDto[];

  @Field(() => [DocumentUsageGqlDto])
  retrievedNeverCited!: DocumentUsageGqlDto[];

  /** Citation accuracy from `ai_response_feedbacks` — the other service's leg. */
  @Field(() => RateGqlDto, { nullable: true })
  citationAccuracy!: RateGqlDto | null;

  /** See `AgentAnalytics.dataThrough`. */
  @Field(() => String, { nullable: true })
  dataThrough!: string | null;

  @Field(() => [UnavailableBlockGqlDto])
  unavailable!: UnavailableBlockGqlDto[];
}

/** One flagged document. `document` resolves through the documents loader. */
@ObjectType('KnowledgeGapFlag')
export class KnowledgeGapFlagGqlDto {
  @Field(() => ID)
  documentId!: string;

  @Field(() => String)
  documentTitle!: string;

  // Nullable, matching the REST DTO: a flag type this build cannot name is
  // reported as absent rather than as a string the client's union lacks.
  @Field(() => String, { nullable: true })
  flagType!: DocumentFlagType | null;

  @Field(() => String)
  detail!: string;
}

@ObjectType('KnowledgeGaps')
export class KnowledgeGapsGqlDto {
  @Field(() => Int)
  emptyRetrievals!: number;

  @Field(() => Int)
  answeringGenerations!: number;

  /**
   * The rate WITH its denominator — see the file note.
   *
   * `emptyRetrievals` alone is a number nobody can act on: fifty empty
   * retrievals out of sixty is a broken knowledge base and out of fifty
   * thousand is noise.
   */
  @Field(() => RateGqlDto)
  emptyRetrievalRate!: RateGqlDto;

  @Field(() => [KnowledgeGapFlagGqlDto])
  flags!: KnowledgeGapFlagGqlDto[];

  /** See `AgentAnalytics.dataThrough`. */
  @Field(() => String, { nullable: true })
  dataThrough!: string | null;

  @Field(() => [UnavailableBlockGqlDto])
  unavailable!: UnavailableBlockGqlDto[];
}
