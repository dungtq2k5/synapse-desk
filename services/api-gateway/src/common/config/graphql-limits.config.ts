/**
 * The cost limits.
 *
 * REST bounds cost structurally — one route, one handler, a known fan-out.
 * GraphQL hands the client a query language, and with cross-service field
 * resolvers, a way to turn one HTTP request into thousands of gRPC calls:
 *
 * ```graphql
 * query {
 *   tickets(first: 100) {
 *     assignee { departments { members { tickets(first: 100) { … } } } }
 *   }
 *   }
 * ```
 *
 * **A separate file from `graphql.config.ts`, and it has to be.** That file
 * builds the driver options, so it imports `depthLimitRule` and
 * `queryCostPlugin`, and both read the numbers below. Keeping them there makes
 * `config → graphql → config` a cycle that happens to work only because every
 * read sits inside a function body. This file imports nothing, so it can be a
 * leaf of both.
 *
 * See `docs/decisions/0014-narrow-graphql-edge-types.md`.
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
 * The most items a LIST EDGE returns.
 *
 * **A cap, not pagination, and the two are mutually exclusive.** A paginated
 * edge's DataLoader key is `(parentId, first, offset, orderBy)`, so the batch
 * RPC would have to page PER PARENT — a window function partitioned by parent
 * id, which no `ListXByIds` expresses. Cardinality decides which an edge gets:
 *
 *   - `Ticket.messages` — hundreds, a long thread is normal → **paginate**, and
 *     that is why it is the allowlisted direct call rather than a loader.
 *   - `User.departments`, `Document.departments` — single digits → **cap**.
 *
 * Fifty rather than {@link MAX_PAGE_SIZE}: the cap bounds the pathological case
 * rather than paging a normal one.
 *
 * **The ids are capped BEFORE the batch, never the results after.** A user in
 * 250 departments produces a 250-key batch against a ~200-id RPC cap, and that
 * cap is an ERROR rather than a truncation — an uncapped parent does not return
 * fewer departments, it fails the whole field. Slicing first turns a hard
 * failure into a documented ceiling.
 */
export const MAX_EDGE_LIST = 50;
