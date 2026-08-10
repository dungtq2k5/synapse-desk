import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';
import { MAX_QUERY_DEPTH } from '../config/graphql-limits.config';

/**
 * Refuses a query nested deeper than {@link MAX_QUERY_DEPTH} — 25-doc §5.
 *
 * **A validation rule, not a plugin**, and that is the point: validation runs
 * before execution begins, so a rejected query never reaches a resolver and
 * therefore never makes a gRPC call. 26-doc §1.3 test 1 asserts exactly that —
 * refusing *after* the fan-out is not a limit, it is a log line.
 *
 * Hand-written rather than `graphql-depth-limit`, which is unmaintained
 * (last published 2018), types-free, and forty lines. The forty lines are below.
 *
 * Introspection is exempt: `__schema` is legitimately deep and every GraphQL IDE
 * sends it, so counting it would break tooling in the only environments where
 * introspection is on.
 */
/**
 * The deepest path through `selectionSet`, counting from `current`.
 *
 * At module scope rather than nested inside the rule: it closes over nothing —
 * not `maxDepth`, not the validation context — so nesting it rebuilt the same
 * function on every call to `depthLimitRule`, and hid a pure, directly testable
 * function inside a factory that can only be exercised through graphql-js.
 */
function depthOf(
  selectionSet: SelectionSetNode | undefined,
  current: number,
): number {
  if (!selectionSet) return current;

  let deepest = current;
  for (const selection of selectionSet.selections) {
    if (
      selection.kind === Kind.FIELD &&
      selection.name.value.startsWith('__')
    ) {
      continue;
    }

    // An inline fragment adds no depth of its own — it is a type condition,
    // not a traversal — so its children are measured at the CURRENT level.
    // Counting it would make `... on Ticket { title }` cost a level for
    // nothing, and make the limit depend on how a client chose to express a
    // query rather than on what it fetches.
    const next =
      selection.kind === Kind.INLINE_FRAGMENT ? current : current + 1;

    // A fragment SPREAD has no selection set of its own here; its definition
    // is validated as its own operation-level node by graphql-js, so the
    // depth inside it is measured there rather than being silently free.
    const child =
      selection.kind === Kind.FRAGMENT_SPREAD
        ? undefined
        : selection.selectionSet;

    deepest = Math.max(deepest, depthOf(child, next));
  }

  return deepest;
}

export function depthLimitRule(maxDepth = MAX_QUERY_DEPTH) {
  return (context: ValidationContext): ASTVisitor => ({
    OperationDefinition(operation) {
      const depth = depthOf(operation.selectionSet, 0);

      if (depth > maxDepth) {
        context.reportError(
          new GraphQLError(
            `Query is nested ${depth} levels deep, exceeding the maximum of ${maxDepth}.`,
            {
              nodes: [operation],
              extensions: { code: 'QUERY_TOO_DEEP', depth, maxDepth },
            },
          ),
        );
      }

      // Nothing below the operation needs visiting — the recursion above has
      // already walked it.
      return false;
    },
  });
}
