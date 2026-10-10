package com.synapsedesk.gateway.graphql;

import graphql.execution.ExecutionContext;
import graphql.execution.instrumentation.InstrumentationContext;
import graphql.execution.instrumentation.InstrumentationState;
import graphql.execution.instrumentation.SimpleInstrumentationContext;
import graphql.execution.instrumentation.SimplePerformantInstrumentation;
import graphql.execution.instrumentation.parameters.InstrumentationExecuteOperationParameters;
import graphql.language.Argument;
import graphql.language.Field;
import graphql.language.FragmentDefinition;
import graphql.language.FragmentSpread;
import graphql.language.InlineFragment;
import graphql.language.IntValue;
import graphql.language.Selection;
import graphql.language.SelectionSet;
import graphql.schema.GraphQLFieldDefinition;
import graphql.schema.GraphQLObjectType;
import graphql.schema.GraphQLSchema;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Refuses a query scoring above {@link GraphqlLimits#MAX_QUERY_COMPLEXITY},
 * scored from the cost table in {@link GraphqlLimits}.
 *
 * <p>
 * Not graphql-java's own {@code MaxQueryComplexityInstrumentation}: it
 * scores every field equally, and the whole point of this limit is that a
 * cross-service field costs more than a scalar read.
 */
@Component
public class QueryCostInstrumentation extends SimplePerformantInstrumentation {

  /**
   * {@code listFieldDefaults}, cached per schema — cheap once, wasteful per
   * request.
   */
  private final Map<GraphQLSchema, Map<String, Integer>> listDefaultsBySchema =
    new ConcurrentHashMap<>();

  @Override
  public InstrumentationContext<graphql.ExecutionResult> beginExecuteOperation(
    InstrumentationExecuteOperationParameters parameters,
    InstrumentationState state
  ) {
    ExecutionContext executionContext = parameters.getExecutionContext();

    Map<String, Integer> listDefaults = listDefaultsBySchema.computeIfAbsent(
      executionContext.getGraphQLSchema(),
      QueryCostInstrumentation::listFieldDefaults
    );

    int cost = scoreSelectionSet(
      executionContext.getOperationDefinition().getSelectionSet(),
      executionContext.getFragmentsByName(),
      1,
      listDefaults
    );

    if (cost > GraphqlLimits.MAX_QUERY_COMPLEXITY) {
      throw GraphqlLimitExceeded.tooComplex(
        cost,
        GraphqlLimits.MAX_QUERY_COMPLEXITY
      );
    }

    return SimpleInstrumentationContext.noOp();
  }

  private static int scoreSelectionSet(
    SelectionSet selectionSet,
    Map<String, FragmentDefinition> fragments,
    int multiplier,
    Map<String, Integer> listDefaults
  ) {
    int total = 0;

    for (Selection<?> selection : selectionSet.getSelections()) {
      if (selection instanceof Field field) {
        total += scoreField(field, fragments, multiplier, listDefaults);
      } else if (selection instanceof InlineFragment inline) {
        total += scoreSelectionSet(
          inline.getSelectionSet(),
          fragments,
          multiplier,
          listDefaults
        );
      } else if (selection instanceof FragmentSpread spread) {
        FragmentDefinition fragment = fragments.get(spread.getName());
        if (fragment != null) {
          total += scoreSelectionSet(
            fragment.getSelectionSet(),
            fragments,
            multiplier,
            listDefaults
          );
        }
      }
    }

    return total;
  }

  private static int scoreField(
    Field field,
    Map<String, FragmentDefinition> fragments,
    int multiplier,
    Map<String, Integer> listDefaults
  ) {
    if (field.getName().startsWith("__")) {
      return 0;
    }

    int own =
      (GraphqlLimits.CROSS_SERVICE_FIELDS.contains(field.getName())
        ? GraphqlLimits.CROSS_SERVICE_COST
        : GraphqlLimits.SCALAR_COST) * multiplier;

    if (field.getSelectionSet() == null) {
      return own;
    }

    int childMultiplier =
      multiplier *
      listSizeOf(field, listDefaults) *
      GraphqlLimits.LIST_MULTIPLIER;

    return (
      own +
      scoreSelectionSet(
        field.getSelectionSet(),
        fragments,
        childMultiplier,
        listDefaults
      )
    );
  }

  private static int listSizeOf(
    Field field,
    Map<String, Integer> listDefaults
  ) {
    Argument argument = field
      .getArguments()
      .stream()
      .filter(a -> a.getName().equals("first") || a.getName().equals("limit"))
      .findFirst()
      .orElse(null);

    if (argument == null) {
      return listDefaults.getOrDefault(field.getName(), 1);
    }

    if (argument.getValue() instanceof IntValue intValue) {
      return Math.min(
        Math.max(1, intValue.getValue().intValue()),
        GraphqlLimits.MAX_PAGE_SIZE
      );
    }

    return GraphqlLimits.MAX_PAGE_SIZE;
  }

  private static Map<String, Integer> listFieldDefaults(GraphQLSchema schema) {
    Map<String, Integer> defaults = new HashMap<>();

    for (var type : schema.getTypeMap().values()) {
      if (
        !(type instanceof GraphQLObjectType objectType) ||
        objectType.getName().startsWith("__")
      ) {
        continue;
      }

      for (GraphQLFieldDefinition field : objectType.getFields()) {
        var sizing = field
          .getArguments()
          .stream()
          .filter(
            a -> a.getName().equals("first") || a.getName().equals("limit")
          )
          .findFirst()
          .orElse(null);
        if (sizing == null) {
          continue;
        }

        int declared = Math.min(
          defaultValueOf(sizing),
          GraphqlLimits.MAX_PAGE_SIZE
        );

        defaults.merge(field.getName(), declared, Math::max);
      }
    }

    return defaults;
  }

  /**
   * A declared `first`/`limit` default, however graphql-java stored it — a
   * literal AST node parsed straight from the SDL (`Int! = 10`), since this
   * schema is never built from a programmatic value.
   */
  private static int defaultValueOf(graphql.schema.GraphQLArgument argument) {
    var defaultValue = argument.getArgumentDefaultValue();
    if (!defaultValue.isSet()) {
      return GraphqlLimits.MAX_PAGE_SIZE;
    }

    Object value = defaultValue.getValue();
    if (value instanceof IntValue intValue) {
      return intValue.getValue().intValue();
    }
    if (value instanceof Number number) {
      return number.intValue();
    }

    return GraphqlLimits.MAX_PAGE_SIZE;
  }
}
