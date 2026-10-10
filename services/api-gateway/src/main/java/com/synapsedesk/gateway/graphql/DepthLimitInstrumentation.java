package com.synapsedesk.gateway.graphql;

import graphql.execution.ExecutionContext;
import graphql.execution.instrumentation.InstrumentationContext;
import graphql.execution.instrumentation.InstrumentationState;
import graphql.execution.instrumentation.SimpleInstrumentationContext;
import graphql.execution.instrumentation.SimplePerformantInstrumentation;
import graphql.execution.instrumentation.parameters.InstrumentationExecuteOperationParameters;
import graphql.language.Field;
import graphql.language.FragmentSpread;
import graphql.language.InlineFragment;
import graphql.language.Selection;
import graphql.language.SelectionSet;
import org.springframework.stereotype.Component;

/**
 * Refuses a query nested deeper than {@link GraphqlLimits#MAX_QUERY_DEPTH}.
 *
 * <p>
 * Runs in {@code beginExecuteOperation} — after validation, before any
 * resolver — and throws {@link GraphqlLimitExceeded} ({@code QUERY_TOO_DEEP}) to
 * short-circuit before execution starts. graphql-java's own {@code
 * MaxQueryDepthInstrumentation} is not reused: this counts by its own rule
 * (introspection exempt, an inline fragment adds no depth, a fragment spread
 * measured at its own AST node), and a different counting rule is a different
 * limit.
 */
@Component
public class DepthLimitInstrumentation extends SimplePerformantInstrumentation {

  private static final int MAX_DEPTH = GraphqlLimits.MAX_QUERY_DEPTH;

  @Override
  public InstrumentationContext<graphql.ExecutionResult> beginExecuteOperation(
    InstrumentationExecuteOperationParameters parameters,
    InstrumentationState state
  ) {
    ExecutionContext executionContext = parameters.getExecutionContext();

    int depth = depthOf(
      executionContext,
      executionContext.getOperationDefinition().getSelectionSet(),
      0
    );

    if (depth > MAX_DEPTH) {
      throw GraphqlLimitExceeded.tooDeep(depth, MAX_DEPTH);
    }

    return SimpleInstrumentationContext.noOp();
  }

  private static int depthOf(
    ExecutionContext executionContext,
    SelectionSet selectionSet,
    int current
  ) {
    if (selectionSet == null) {
      return current;
    }

    int deepest = current;
    for (Selection<?> selection : selectionSet.getSelections()) {
      if (
        selection instanceof Field field && field.getName().startsWith("__")
      ) {
        continue;
      }

      int next = selection instanceof InlineFragment ? current : current + 1;

      // A fragment SPREAD has no selection set of its own here: its own
      // fields are not walked from this call, only the `next + 1` from the
      // spread itself.
      SelectionSet child =
        selection instanceof FragmentSpread
          ? null
          : selection instanceof InlineFragment inline
            ? inline.getSelectionSet()
            : ((Field) selection).getSelectionSet();

      deepest = Math.max(deepest, depthOf(executionContext, child, next));
    }

    return deepest;
  }
}
