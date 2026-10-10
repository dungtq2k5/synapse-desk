package com.synapsedesk.gateway.graphql;

import java.util.Set;

/**
 * The GraphQL depth, complexity and page-size limits, and the cost table.
 *
 * <p>
 * {@link #CROSS_SERVICE_FIELDS} is a hand-maintained set: a directive or
 * schema extension would put the weighting out of sight of the field it prices.
 */
public final class GraphqlLimits {

  /** `MAX_QUERY_DEPTH` — the deepest nesting the product needs is five. */
  public static final int MAX_QUERY_DEPTH = 7;

  /** `MAX_QUERY_COMPLEXITY` — calibrated against {@link #FIELD_COST}. */
  public static final int MAX_QUERY_COMPLEXITY = 2_000;

  /** `MAX_PAGE_SIZE` — clamped, never rejected. */
  public static final int MAX_PAGE_SIZE = 100;

  /**
   * `MAX_EDGE_LIST` — the cap a narrow edge resolver slices ids to before its
   * batch call. Unused until the resolver plan wires the edges that need it;
   * kept here so the cost table this plan owns states the same number the
   * resolvers will read.
   */
  public static final int MAX_EDGE_LIST = 50;

  /** A property already present on the parent object. */
  public static final int SCALAR_COST = 1;

  /** A field resolved by a gRPC call through a loader. */
  public static final int CROSS_SERVICE_COST = 10;

  /** A list field's multiplier per item requested. */
  public static final int LIST_MULTIPLIER = 1;

  /**
   * `CROSS_SERVICE_FIELDS` — field names priced as a per-parent fan-out.
   *
   * <p>
   * {@code permissions} is deliberately NOT here: it resolves
   * through {@link PermissionCatalogueLoaderConfig}, which is keyed by
   * TENANT and always a batch of one, so a hundred roles resolving it make
   * ONE call, not a hundred. Charging it {@link #CROSS_SERVICE_COST} would
   * price a single cached read the same as a hundred fan-out calls.
   */
  public static final Set<String> CROSS_SERVICE_FIELDS = Set.of(
    "assignee",
    "author",
    "sender",
    "department",
    "departments",
    "createdBy",
    "actor",
    "agent",
    "document"
  );

  private GraphqlLimits() {}
}
