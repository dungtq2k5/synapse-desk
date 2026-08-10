/**
 * The cost limits — 25-doc §5.
 *
 * **REST bounds cost structurally**: one route, one handler, a known fan-out.
 * GraphQL hands the client a query language, and with cross-service field
 * resolvers it hands them a way to turn one HTTP request into thousands of gRPC
 * calls:
 *
 * ```graphql
 * query {
 *   tickets(first: 100) {
 *     assignee { departments { members { tickets(first: 100) { … } } } }
 *   }
 * }
 * ```
 *
 * These exist BEFORE the first resolver, deliberately. They are a constraint on
 * a surface nobody uses yet; added later they are a restriction on one clients
 * already depend on, and the conversation changes from "what is safe" to "whose
 * dashboard breaks".
 *
 * **A separate file from `graphql.config.ts`, and it has to be.** That file
 * holds `getGraphqlConfig`, which builds the driver options — so it imports
 * `depthLimitRule` and `queryCostPlugin`, and both of those read the numbers
 * below. Keeping the numbers there would make `config → graphql → config` a
 * cycle: it would happen to work, because every read is inside a function body
 * rather than at module scope, and it is exactly the arrangement that breaks
 * the day someone moves one of those reads to a top-level constant. This file
 * imports nothing, so it can be a leaf of both.
 */

/**
 * Maximum nesting depth. The blunt instrument, and the cheapest.
 *
 * Seven allows the deepest query the product genuinely needs —
 * `ticket → assignee → departments → …` is five — while stopping recursive
 * traversal dead. Static, evaluated before execution, and costs nothing.
 */
export const MAX_QUERY_DEPTH = 7;

/**
 * Maximum scored complexity, where **cross-service fields cost more than local
 * ones**.
 *
 * This is the limit that reflects reality here. A scorer charging the same for
 * `title` (a property read on an object already in memory) and `assignee` (a
 * gRPC call to auth-service) is measuring the wrong thing — and the difference
 * between a limit that protects the system and one that merely annoys clients is
 * exactly that weighting.
 *
 * The number is calibrated against {@link FIELD_COST}: a 50-ticket page with two
 * cross-service edges scores 50 × (10 + 10) + overhead, comfortably under; the
 * same page nested three deep is not.
 */
export const MAX_QUERY_COMPLEXITY = 2_000;

/**
 * The most items any paginated field may return.
 *
 * **Clamped, not rejected** — an unbounded list multiplies every nested field
 * beneath it, but rejecting `first: 500` makes the cap a breaking change for a
 * client that was working yesterday. Clamping keeps them working, with less
 * data than they asked for and a bounded cost.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * What each kind of field costs.
 *
 * The unit is arbitrary; only the RATIO matters, and the ratio is the point —
 * a network round trip is not one scalar read, it is a hundred.
 */
export const FIELD_COST = {
  /** A property already present on the parent object. */
  scalar: 1,
  /**
   * A field resolved by a gRPC call to another service, through a loader.
   *
   * Ten rather than a hundred because DataLoader batches: fifty of these on one
   * page are ONE call, so charging each of them a full round trip would price
   * the batching out of existence and push clients back to N queries.
   */
  crossService: 10,
  /**
   * A list field, multiplied by the number of items requested.
   *
   * Charged as a multiplier rather than a flat cost because that is what it is:
   * a list of 100 with a cross-service child costs a hundred times that child.
   */
  listMultiplier: 1,
} as const;

/**
 * The most items a LIST EDGE returns — 26-doc §3.2.
 *
 * **A cap, not pagination, and the two are mutually exclusive.** A paginated
 * edge's DataLoader key is `(parentId, first, offset, orderBy)`, so the batch
 * RPC behind it would have to page PER PARENT — a window function partitioned
 * by parent id, which no `ListXByIds` expresses and none should. Which approach
 * an edge gets is decided by cardinality:
 *
 *   - `Ticket.messages` — hundreds, a long thread is normal → **paginate**, and
 *     that is exactly why it is the allowlisted direct call rather than a loader.
 *   - `User.departments`, `Document.departments` — single digits → **cap**.
 *
 * Fifty rather than {@link MAX_PAGE_SIZE}: these are single-digit lists in
 * practice, and the cap exists to bound the pathological case rather than to
 * page a normal one.
 *
 * **The ids are capped BEFORE the batch, never the results after** — 27-doc §1
 * property 5. A user in 250 departments produces a 250-key batch against a
 * ~200-id RPC cap, and that cap is an ERROR rather than a truncation: an
 * uncapped parent does not return fewer departments, it fails the whole field.
 * Slicing first turns a hard failure into a documented ceiling.
 */
export const MAX_EDGE_LIST = 50;
