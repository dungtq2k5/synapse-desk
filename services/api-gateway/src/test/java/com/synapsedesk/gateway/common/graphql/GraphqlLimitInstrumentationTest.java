package com.synapsedesk.gateway.common.graphql;

import static org.assertj.core.api.Assertions.assertThat;

import graphql.ExecutionResult;
import graphql.GraphQL;
import graphql.schema.GraphQLSchema;
import graphql.schema.idl.RuntimeWiring;
import graphql.schema.idl.SchemaGenerator;
import graphql.schema.idl.SchemaParser;
import graphql.schema.idl.TypeDefinitionRegistry;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/**
 * {@link DepthLimitInstrumentation} and {@link QueryCostInstrumentation}
 * against the real tracked schema — a direct graphql-java execution, with no
 * Spring context, so a sabotage in either walk shows up as a wrong verdict on
 * a real query rather than a mocked one.
 */
class GraphqlLimitInstrumentationTest {

  private static final Path SCHEMA = Path.of(
    "target/classes/schema/schema.gql"
  );

  private GraphQL graphQl() throws Exception {
    TypeDefinitionRegistry registry = new SchemaParser().parse(
      Files.readString(SCHEMA)
    );

    RuntimeWiring wiring = RuntimeWiring.newRuntimeWiring()
      .scalar(DateTimeScalar.TYPE)
      .build();

    GraphQLSchema schema = new SchemaGenerator().makeExecutableSchema(
      registry,
      wiring
    );

    return GraphQL.newGraphQL(schema)
      .instrumentation(new DepthLimitInstrumentation())
      .instrumentation(new QueryCostInstrumentation())
      .build();
  }

  /**
   * No resolver is wired yet, so a query
   * that clears both limits still errors on the null field graphql-java's
   * default `PropertyDataFetcher` produces — asserted OUT rather than
   * asserting an empty list, which the resolver plan will make true instead.
   */
  private static boolean refusedByALimit(ExecutionResult result) {
    return result
      .getErrors()
      .stream()
      .anyMatch(
        error ->
          error.getMessage().contains("levels deep") ||
          error.getMessage().contains("too complex")
      );
  }

  @Test
  void aShallowQueryIsNotRefused() throws Exception {
    ExecutionResult result = graphQl().execute("{ version { version } }");

    assertThat(refusedByALimit(result)).isFalse();
  }

  /**
   * A self-referential toy schema, for the depth walk alone.
   *
   * <p>
   * The tracked schema cannot express a genuinely valid query past depth
   * 5 (ADR 0014's narrow edge types), and {@link DepthLimitInstrumentation}
   * hooks {@code beginExecuteOperation} — AFTER validation — so an unknown
   * field never reaches it at all; it fails on `FieldUndefined` first, same
   * as graphql-java's own default. A recursive `node { child { … } }` shape
   * lets a real, valid query reach any depth, isolating the walk from the
   * production schema's field limits.
   */
  private GraphQL recursiveGraphQl() {
    TypeDefinitionRegistry registry = new SchemaParser().parse(
      "type Query { node: Node } type Node { id: ID child: Node }"
    );
    GraphQLSchema schema = new SchemaGenerator().makeExecutableSchema(
      registry,
      RuntimeWiring.newRuntimeWiring().build()
    );

    return GraphQL.newGraphQL(schema)
      .instrumentation(new DepthLimitInstrumentation())
      .build();
  }

  @Test
  void aQueryNestedPastTheDepthLimitIsRefused() {
    String deep =
      "{ node { " +
      "child { ".repeat(GraphqlLimits.MAX_QUERY_DEPTH) +
      "id" +
      " }".repeat(GraphqlLimits.MAX_QUERY_DEPTH) +
      " } }";

    ExecutionResult result = recursiveGraphQl().execute(deep);

    assertThat(result.getErrors()).isNotEmpty();
    assertThat(result.getErrors().get(0).getMessage()).isEqualTo(
      "Query is nested 9 levels deep, exceeding the maximum of 7."
    );
    assertThat(result.getErrors().get(0).getExtensions()).isEqualTo(
      java.util.Map.of("code", "QUERY_TOO_DEEP", "depth", 9, "maxDepth", 7)
    );
    assertThat((Object) result.getData()).isNull();
  }

  @Test
  void aQueryExactlyAtTheLimitIsNotRefused() {
    // `node` + this many `child` + the leaf `id` = MAX_QUERY_DEPTH exactly —
    // the rule refuses on `>`, not `>=`.
    int repeats = GraphqlLimits.MAX_QUERY_DEPTH - 2;
    String atLimit =
      "{ node { " +
      "child { ".repeat(repeats) +
      "id" +
      " }".repeat(repeats) +
      " } }";

    ExecutionResult result = recursiveGraphQl().execute(atLimit);

    assertThat(result.getErrors()).isEmpty();
  }

  @Test
  void aQueryScoringOverTheComplexityLimitIsRefused() throws Exception {
    // 1 + 23×87 = 2 002 — the exact pair
    // `test/gateway-contract/graphql.contract-spec.ts` uses over HTTP, so the
    // same boundary is proven at the instrumentation too.
    ExecutionResult result = graphQl().execute(
      "{ tickets(first: 87) { items { assignee { fullName } department { name } } } }"
    );

    assertThat(result.getErrors()).isNotEmpty();
    assertThat(result.getErrors().get(0).getMessage()).contains("too complex");
    assertThat(result.getErrors().get(0).getExtensions()).isEqualTo(
      java.util.Map.of(
        "code",
        "QUERY_TOO_COMPLEX",
        "cost",
        2002,
        "maxComplexity",
        2000
      )
    );
  }

  @Test
  void theSamePairJustUnderTheLimitIsNotRefused() throws Exception {
    ExecutionResult result = graphQl().execute(
      "{ tickets(first: 86) { items { assignee { fullName } department { name } } } }"
    );

    assertThat(refusedByALimit(result)).isFalse();
  }
}
