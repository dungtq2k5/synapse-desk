package com.synapsedesk.gateway.common.graphql;

import graphql.execution.AbortExecutionException;
import java.util.Map;

/**
 * A query refused by a limit, with {@code extensions} naming which one and by how
 * much, so a client tells the two apart without reading the message.
 *
 * <p>Still an execution-time refusal: HTTP 200, the error under {@code errors}, no
 * {@code data}.
 *
 * <p>@example {@code {"code":"QUERY_TOO_DEEP","depth":9,"maxDepth":7}}
 */
final class GraphqlLimitExceeded extends AbortExecutionException {

  private final transient Map<String, Object> extensions;

  private GraphqlLimitExceeded(String message, Map<String, Object> extensions) {
    super(message);
    this.extensions = extensions;
  }

  static GraphqlLimitExceeded tooDeep(int depth, int maxDepth) {
    return new GraphqlLimitExceeded(
      "Query is nested %d levels deep, exceeding the maximum of %d.".formatted(
        depth,
        maxDepth
      ),
      Map.of("code", "QUERY_TOO_DEEP", "depth", depth, "maxDepth", maxDepth)
    );
  }

  static GraphqlLimitExceeded tooComplex(int cost, int maxComplexity) {
    return new GraphqlLimitExceeded(
      "Query is too complex: %d exceeds the maximum of %d. Request fewer items, or fewer fields that resolve across services.".formatted(
        cost,
        maxComplexity
      ),
      Map.of(
        "code",
        "QUERY_TOO_COMPLEX",
        "cost",
        cost,
        "maxComplexity",
        maxComplexity
      )
    );
  }

  @Override
  public Map<String, Object> getExtensions() {
    return extensions;
  }
}
