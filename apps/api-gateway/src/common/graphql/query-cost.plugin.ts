import { Logger } from '@nestjs/common';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLError, isObjectType, Kind } from 'graphql';
import type {
  GraphQLSchema,
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
} from 'graphql';
import {
  FIELD_COST,
  MAX_PAGE_SIZE,
  MAX_QUERY_COMPLEXITY,
} from '../config/graphql-limits.config';

/**
 * Field names resolved by a call to ANOTHER SERVICE — 25-doc §5.
 *
 * A hand-maintained list, and deliberately so: the alternative is reading a
 * custom directive or an extension off the schema, which means the weighting
 * lives in the same file as the field and is therefore invisible when someone
 * reviews the limit. Kept honest by a test that every name here exists in the
 * schema, so a renamed edge fails rather than silently reverting to scalar cost.
 *
 * Empty until the first edge lands (26-doc §5). The scorer is built now because
 * 25-doc §8 puts the limits before the resolvers — a limit added afterwards is a
 * restriction on working clients rather than a constraint on a new surface.
 */
export const CROSS_SERVICE_FIELDS = new Set<string>([
  'assignee',
  'author',
  'sender',
  'department',
  'departments',
  'createdBy',
  'actor',
]);

/**
 * Scores a query before it executes, and refuses it if it is too expensive.
 *
 * **`didResolveOperation` is the hook that matters**: it runs after parse and
 * validation and BEFORE execution, so a refusal costs nothing downstream. A
 * check inside a resolver would fire after the fan-out it was meant to prevent —
 * which is 26-doc §1.3 test 1, asserting that no gRPC stub was called.
 */
/**
 * The plugin type, taken from `ApolloDriverConfig` rather than from
 * `@apollo/server` directly.
 *
 * **`@apollo/server` ships two declaration trees** — `dist/cjs` and `dist/esm` —
 * behind an exports map, and under `moduleResolution: "node"` this file resolves
 * one while `@nestjs/apollo` resolves the other. They are structurally identical
 * and nominally distinct, so importing `ApolloServerPlugin` here produces a type
 * error about `HTTPGraphQLRequest` not being assignable to itself. Deriving the
 * type from the config object that consumes it sidesteps the duplication
 * entirely, and cannot drift from what the driver actually accepts.
 */
type DriverPlugin = NonNullable<ApolloDriverConfig['plugins']>[number];

export function queryCostPlugin(
  maxComplexity = MAX_QUERY_COMPLEXITY,
): DriverPlugin {
  const logger = new Logger('QueryCost');

  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async requestDidStart() {
      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async didResolveOperation({
          document,
          operationName,
          schema,
        }: {
          document: DocumentNode;
          operationName?: string | null;
          schema: GraphQLSchema;
        }) {
          // The schema is what knows each list field's declared default — the
          // query AST alone cannot, which is the whole of §1.3's blind spot.
          const cost = scoreDocument(
            document,
            operationName ?? undefined,
            listFieldDefaults(schema),
          );

          if (cost > maxComplexity) {
            logger.warn(
              `Refused operation ${operationName ?? '(anonymous)'}: cost ${cost} exceeds ${maxComplexity}`,
            );

            throw new GraphQLError(
              `Query is too complex: ${cost} exceeds the maximum of ${maxComplexity}. ` +
                'Request fewer items, or fewer fields that resolve across services.',
              {
                extensions: { code: 'QUERY_TOO_COMPLEX', cost, maxComplexity },
              },
            );
          }
        },
      };
    },
  };
}

/**
 * The default page size each list field declares, by field name — 26-doc §1.3.
 *
 * **Only fields that DECLARE a `first` / `limit` argument appear here**, and
 * that restriction is load-bearing. `TicketPage.items` is also a list, and its
 * size is governed by its parent's `first` — charging it again would multiply
 * the same page twice and price `tickets(first: 50) { items { … } }` at fifty
 * times fifty.
 *
 * Keyed by field NAME rather than by `Type.field`, so two same-named fields on
 * different types collapse to the larger default. That errs toward expensive,
 * which is the correct direction for a limit whose job is to refuse before a
 * resolver runs.
 *
 * Built once per schema and cached: it walks every field of every type, which
 * is cheap once and wasteful per request.
 */
const listDefaultsBySchema = new WeakMap<GraphQLSchema, Map<string, number>>();

export function listFieldDefaults(schema: GraphQLSchema): Map<string, number> {
  const cached = listDefaultsBySchema.get(schema);
  if (cached) return cached;

  const defaults = new Map<string, number>();

  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith('__')) continue;

    for (const field of Object.values(type.getFields())) {
      const sizing = field.args.find(
        (argument) => argument.name === 'first' || argument.name === 'limit',
      );
      if (!sizing) continue;

      // A declared argument with NO default still returns something; the server
      // will cap it at `MAX_PAGE_SIZE`, so that is what it can cost.
      const declared =
        typeof sizing.defaultValue === 'number'
          ? Math.min(sizing.defaultValue, MAX_PAGE_SIZE)
          : MAX_PAGE_SIZE;

      defaults.set(
        field.name,
        Math.max(defaults.get(field.name) ?? 0, declared),
      );
    }
  }

  listDefaultsBySchema.set(schema, defaults);

  return defaults;
}

/** The scored cost of an operation in a parsed document. */
export function scoreDocument(
  document: DocumentNode,
  operationName?: string,
  listDefaults: Map<string, number> = new Map(),
): number {
  const fragments = new Map<string, FragmentDefinitionNode>();
  const operations: OperationDefinitionNode[] = [];

  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    } else if (definition.kind === Kind.OPERATION_DEFINITION) {
      operations.push(definition);
    }
  }

  const operation =
    operations.find((o) => o.name?.value === operationName) ?? operations[0];
  if (!operation) return 0;

  return scoreSelectionSet(operation.selectionSet, fragments, 1, listDefaults);
}

/**
 * Walks a selection set, multiplying by list size as it descends.
 *
 * `multiplier` is what makes this reflect the real cost: a cross-service field
 * under `tickets(first: 100)` is not one call's worth of risk, it is a hundred
 * items' worth — and although the loader batches them into one RPC, the payload
 * and the downstream work still scale with the page.
 */
function scoreSelectionSet(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  multiplier: number,
  listDefaults: Map<string, number>,
): number {
  let total = 0;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      total += scoreField(selection, fragments, multiplier, listDefaults);
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      total += scoreSelectionSet(
        selection.selectionSet,
        fragments,
        multiplier,
        listDefaults,
      );
      continue;
    }

    // A named fragment spread. Resolved rather than skipped: a query that hid
    // its whole expensive half in a fragment would otherwise score as trivial,
    // which is the obvious way around a scorer.
    const fragment = fragments.get(selection.name.value);
    if (fragment) {
      total += scoreSelectionSet(
        fragment.selectionSet,
        fragments,
        multiplier,
        listDefaults,
      );
    }
  }

  return total;
}

function scoreField(
  field: FieldNode,
  fragments: Map<string, FragmentDefinitionNode>,
  multiplier: number,
  listDefaults: Map<string, number>,
): number {
  // Introspection is not the client's traffic and must not be priced as if it
  // were: `__schema` is one enormous selection set and would exceed any sane
  // budget, breaking every GraphQL IDE in non-production.
  if (field.name.value.startsWith('__')) return 0;

  const own =
    (CROSS_SERVICE_FIELDS.has(field.name.value)
      ? FIELD_COST.crossService
      : FIELD_COST.scalar) * multiplier;

  if (!field.selectionSet) return own;

  const childMultiplier =
    multiplier * listSizeOf(field, listDefaults) * FIELD_COST.listMultiplier;

  return (
    own +
    scoreSelectionSet(
      field.selectionSet,
      fragments,
      childMultiplier,
      listDefaults,
    )
  );
}

/**
 * How many items this field is asking for.
 *
 * Read from the literal `first` / `limit` argument, and never more than
 * {@link MAX_PAGE_SIZE} — which is the most the server will return whatever the
 * client asks for.
 *
 * A VARIABLE cannot be read here — `didResolveOperation` has the values, but
 * resolving them per argument would duplicate graphql-js's coercion — so a
 * variable is priced at the cap. Pricing it at 1 would make `first: $n` the
 * universal way around this limit.
 */
function listSizeOf(
  field: FieldNode,
  listDefaults: Map<string, number>,
): number {
  const argument = field.arguments?.find(
    (a) => a.name.value === 'first' || a.name.value === 'limit',
  );

  if (!argument) {
    // **The blind spot** — 26-doc §1.3. `listSizeOf` reads the QUERY, and a
    // client that omits `first` leaves nothing to read — so the field scored as
    // one item while the resolver's own `defaultValue` returned fifty.
    //
    // Sharp because of which field it is: `Ticket.messages` declares
    // `defaultValue: 50` AND is the one allowlisted direct gRPC call (§5), so
    // `tickets(first: 50) { messages { … } }` is fifty calls returning fifty
    // rows each — and the scorer charged it fifty. **The one sanctioned N+1 in
    // the system was the one under-priced by 50x.**
    //
    // A field that declares no sizing argument at all is not a page and stays
    // at 1; see `listFieldDefaults`.
    return listDefaults.get(field.name.value) ?? 1;
  }

  if (argument.value.kind === Kind.INT) {
    // **Capped at the page size the server will actually honour.**
    //
    // Resolvers CLAMP `first` rather than rejecting it (25-doc §5), so a query
    // asking for 500 receives 100. Pricing it at 500 charges for work that
    // cannot happen — and it refused `first: 500` outright, which defeats the
    // clamp entirely and turns "clamped, not rejected" back into "rejected".
    // Found by 26-doc §1.3 test 3, which is exactly what that test is for.
    return Math.min(
      Math.max(1, Number.parseInt(argument.value.value, 10)),
      MAX_PAGE_SIZE,
    );
  }

  // A variable, or anything else not statically known.
  return MAX_PAGE_SIZE;
}
