import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, parse } from 'graphql';
import {
  CROSS_SERVICE_FIELDS,
  PER_PAGE_LOADER_EXEMPTIONS,
  listFieldDefaults,
  scoreDocument,
} from './query-cost.plugin';
import { SCHEMA_PATH } from '../config/graphql.config';
import {
  FIELD_COST,
  MAX_PAGE_SIZE,
  MAX_QUERY_COMPLEXITY,
} from '../config/graphql-limits.config';

/**
 * The complexity scorer
 *
 * **The point of scoring at all is the WEIGHTING.** A scorer charging the same
 * for `title` (a property read on an object already in memory) and `assignee`
 * (a gRPC call to auth-service) is measuring the wrong thing — and that is the
 * whole difference between a limit that protects the system and one that merely
 * annoys clients.
 */
describe('Query complexity', () => {
  const cost = (query: string) => scoreDocument(parse(query));

  it('1. **a cross-service field scores higher than a scalar**', () => {
    // The ratio is the design; the absolute numbers are
    // arbitrary units.
    const scalar = cost('{ ticket { title } }');
    const crossService = cost('{ ticket { assignee { fullName } } }');

    expect(crossService).toBeGreaterThan(scalar);
    expect(FIELD_COST.crossService).toBeGreaterThan(FIELD_COST.scalar);
  });

  it('2. **a list multiplies everything beneath it**', () => {
    // The reason `first` exists in the scorer at all: fifty tickets with an
    // assignee is fifty items' worth of payload and downstream work, even
    // though the loader batches it into one RPC.
    const one = cost('{ tickets(first: 1) { assignee { fullName } } }');
    const fifty = cost('{ tickets(first: 50) { assignee { fullName } } }');

    expect(fifty).toBeGreaterThan(one * 10);
  });

  it('3. **a variable list size is priced at the CAP, not at one**', () => {
    // Otherwise `first: $n` is the universal way around this limit — write the
    // expensive query with a variable and it scores as if it asked for one row.
    const literal = cost('{ tickets(first: 100) { assignee { fullName } } }');
    const variable = cost(
      'query Q($n: Int!) { tickets(first: $n) { assignee { fullName } } }',
    );

    expect(variable).toBe(literal);
  });

  it('4. **a fragment does not hide cost**', () => {
    // The obvious way around a naive scorer: move the expensive half into a
    // named fragment and the query looks trivial.
    const inline = cost('{ ticket { assignee { fullName } } }');
    const viaFragment = cost(
      '{ ticket { ...f } } fragment f on Ticket { assignee { fullName } }',
    );

    expect(viaFragment).toBe(inline);
  });

  it('5. introspection is not priced — it would break every IDE', () => {
    // `__schema` is one enormous selection set. Charging for it would exceed
    // any sane budget and refuse the query every GraphQL tool sends first, in
    // exactly the environments where introspection is deliberately on.
    expect(cost('{ __schema { types { name } } }')).toBe(0);
  });

  it('6. a realistic dashboard query stays comfortably under the cap', () => {
    // The guard against a limit tuned so tight the feature is pointless —
    // If this ever fails, the limit is wrong, not the query.
    const realistic = cost(`{
      tickets(first: 50) {
        id title status createdAt
        assignee { id fullName avatarUrl }
        department { id name }
      }
    }`);

    expect(realistic).toBeLessThan(MAX_QUERY_COMPLEXITY);
  });

  /**
   * The cost of one query with a field priced both ways.
   *
   * Comparing two DIFFERENT queries does not isolate the weighting: an edge
   * carries a selection set and the scalar it is compared against does not, so
   * the difference silently includes the nested field's own cost. Toggling the
   * set under one query is the only comparison where the single variable is the
   * price of that field.
   */
  const weightingOf = (field: string, query: string) => {
    const present = CROSS_SERVICE_FIELDS.has(field);
    try {
      CROSS_SERVICE_FIELDS.add(field);
      const weighted = cost(query);
      CROSS_SERVICE_FIELDS.delete(field);

      return weighted - cost(query);
    } finally {
      // Restored whichever way it started, so the toggle cannot leak into the
      // tests below — they read the same module-level set.
      if (present) CROSS_SERVICE_FIELDS.add(field);
      else CROSS_SERVICE_FIELDS.delete(field);
    }
  };

  it('**7a. `IngestionJob.document` is priced as the round trip it is**', () => {
    // The mispricing this pins was live for three fields, and two of them
    // predate the edge that exposed it: `DocumentUsage.document` and
    // `KnowledgeGapFlag.document` were scored as memory reads from the day the
    // scorer shipped.
    //
    // A hundred jobs asking for their document is a hundred ids through the
    // loader — so the weighting has to apply once per row, not once per query.
    const perRow = weightingOf(
      'document',
      '{ ingestionJobs(first: 100) { items { document { id } } } }',
    );

    expect(perRow).toBe(100 * (FIELD_COST.crossService - FIELD_COST.scalar));
    // And it is actually in the set — `weightingOf` would report the same
    // difference for a field nobody registered.
    expect(CROSS_SERVICE_FIELDS.has('document')).toBe(true);
  });

  it('**7b. and the tenant-keyed permission edge is deliberately NOT**', () => {
    // The opposite error, and the one the set's old wording invited: a
    // cross-service call that does not fan out. `loaders.permissions` is keyed
    // by tenant, so a hundred roles make ONE request — charging 10 each would
    // price a single cached read at 1 000.
    //
    // The weighting is measured to show what registering it would cost, then
    // the assertion is that nobody has.
    const wouldCost = weightingOf(
      'permissions',
      '{ roles(first: 100) { items { permissions { code } } } }',
    );

    expect(wouldCost).toBe(100 * (FIELD_COST.crossService - FIELD_COST.scalar));
    expect(CROSS_SERVICE_FIELDS.has('permissions')).toBe(false);
    // Written down rather than merely absent: an omission and a decision look
    // identical in a set, and the docblock's rule reads as though this field
    // belongs in it.
    expect(PER_PAGE_LOADER_EXEMPTIONS.has('permissions')).toBe(true);
  });

  describe('**Every loader-backed field is priced deliberately**', () => {
    /**
     * The direction that catches a MISSING entry.
     *
     * The set's docblock used to claim a test kept it honest by checking every
     * name in it exists in the schema. That test did not exist, and even as
     * described it points the wrong way: it catches a RENAMED edge and can
     * never catch an absent one — which is the failure that actually happened,
     * four times, three of them before the edge that exposed it.
     *
     * This asks the reverse question, from the resolvers rather than the set.
     */
    const MODULES = join(__dirname, '../../modules');

    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else out.push(path);
      }

      return out;
    };

    /** Comments removed, so a sentence naming a loader is not a loader call. */
    const withoutComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    /**
     * Every field whose resolver reaches a loader, by its SCHEMA name.
     *
     * **The schema name, not the method name**, and the difference is the whole
     * reason this is not two lines. The scorer looks up `field.name.value`,
     * while a source scan sees the method — and seven `@Query`s here carry an
     * explicit `name:` that diverges (`permissionCatalogue` → `permissions`,
     * `ingestionJobPage` → `ingestionJobs`, and five more). A scan comparing
     * method names would report `permissionCatalogue` as unregistered forever,
     * and an exemption written to silence it would never match what the scorer
     * reads.
     *
     * **`@Query` as well as `@ResolveField`**: `Query.permissions` reaches a
     * loader from a root field, so a scan of field resolvers alone cannot see
     * it.
     *
     * Members are split on the decorator at two-space indent rather than
     * matched as one expression, because a decorator BETWEEN the options and the
     * method — `@RequirePermission` sits there on every root field — truncates
     * any regex that runs from the decorator to the method signature.
     */
    const loaderBackedFields = (): { field: string; where: string }[] =>
      walk(MODULES)
        .filter((path) => path.endsWith('.resolver.ts'))
        .flatMap((path) => {
          const source = withoutComments(readFileSync(path, 'utf8'));
          const file = path.slice(path.lastIndexOf('/') + 1);
          const starts = [
            ...source.matchAll(/^ {2}@(?:Query|ResolveField)\(/gm),
          ].map((match) => match.index ?? 0);

          return starts
            .map((start, index) =>
              source.slice(start, starts[index + 1] ?? source.length),
            )
            .filter((member) => /loaders\.\w+\.load(?:Many)?\(/.test(member))
            .map((member) => {
              const method = /^ {2}(?:async\s+)?(\w+)\(/m.exec(member)?.[1];
              const renamed = /name:\s*'([^']+)'/.exec(member)?.[1];

              return {
                field: renamed ?? method ?? '?',
                where: `${file}:${method ?? '?'}`,
              };
            });
        });

    it('**1. the scan finds loader-backed fields at all**', () => {
      // Guards the guard. A regex that matched nothing would make the
      // assertion below pass over an empty list, which is the exact failure
      // this whole describe exists to catch somewhere else.
      const found = loaderBackedFields();

      expect(found.length).toBeGreaterThanOrEqual(10);
      // And it resolves the rename, which is the part most likely to break
      // silently: `permissionCatalogue` must appear as `permissions`.
      expect(found.map(({ field }) => field)).toContain('permissions');
      expect(found.map(({ field }) => field)).not.toContain(
        'permissionCatalogue',
      );
    });

    it('**2. and every one is weighted or explicitly exempt**', () => {
      // Written on the day the scorer shipped, this would have failed on
      // `DocumentUsage.document` and `KnowledgeGapFlag.document`. Written on
      // the day the analytics edges landed, it failed on `AgentStat.agent` —
      // a field neither the implementation review nor the validation pass had
      // noticed.
      const unpriced = loaderBackedFields()
        .filter(
          ({ field }) =>
            !CROSS_SERVICE_FIELDS.has(field) &&
            !PER_PAGE_LOADER_EXEMPTIONS.has(field),
        )
        .map(({ where, field }) => `${where} → ${field}`);

      expect(unpriced.sort()).toEqual([]);
    });
  });

  it('7. the weighted field list is not empty', () => {
    // Guards tests 1-2: an empty set would make every field score as a scalar
    // and all of the above would pass while measuring nothing.
    expect(CROSS_SERVICE_FIELDS.size).toBeGreaterThan(0);
  });

  describe('The list-default blind spot', () => {
    // The real schema, so the defaults are the ones clients actually meet.
    const schema = buildSchema(readFileSync(SCHEMA_PATH, 'utf8'));
    const defaults = listFieldDefaults(schema);
    const priced = (query: string) =>
      scoreDocument(parse(query), undefined, defaults);

    it('5. **`messages { id }` costs the same as `messages(first: 50) { id }`**', () => {
      // They return the same thing, so they must cost the same
      // test 5. `listSizeOf` reads the QUERY, and a client that omits `first`
      // leaves nothing to read: the field scored as ONE item while the
      // resolver's `defaultValue` returned fifty.
      //
      // Sharp because of which field it is. `Ticket.messages` is also the one
      // allowlisted direct gRPC call, so `tickets(first: 50) { messages }`
      // is fifty calls returning fifty rows each — the one sanctioned N+1 in
      // the system, under-priced by 50x.
      const omitted = priced('{ ticket(id: "x") { messages { id } } }');
      const explicit = priced(
        '{ ticket(id: "x") { messages(first: 50) { id } } }',
      );

      expect(omitted).toBe(explicit);
      // And it is genuinely the default rather than both collapsing to 1.
      expect(omitted).toBeGreaterThan(
        priced('{ ticket(id: "x") { messages(first: 1) { id } } }'),
      );
    });

    it('6. the schema really declares that default', () => {
      // Guards test 5: if `messages` stopped declaring `first`, the map would
      // be empty and both sides of the comparison would collapse to 1 — equal,
      // and proving nothing.
      expect(defaults.get('messages')).toBe(50);
    });

    it('7. **a list field with NO sizing argument is not charged a default**', () => {
      // `TicketPage.items` is a list too, and its size is governed by its
      // PARENT's `first`. Charging it again would price
      // `tickets(first: 50) { items { … } }` at fifty times fifty.
      expect(defaults.has('items')).toBe(false);

      const page = priced('{ tickets(first: 50) { items { id } } }');
      const bare = priced('{ tickets(first: 50) { items { id } } }');

      expect(page).toBe(bare);
      // Fifty rows of one scalar, not two and a half thousand.
      expect(page).toBeLessThan(FIELD_COST.scalar * 50 * 10);
    });

    it('8. an argument declared with no default is priced at the page cap', () => {
      // "or `MAX_PAGE_SIZE` if it declares none" — the safe direction for a
      // limit that runs before any resolver.
      const withoutDefault = buildSchema(`
        type Thing { id: ID! }
        type Query { things(first: Int): [Thing!]! }
      `);

      expect(listFieldDefaults(withoutDefault).get('things')).toBe(
        MAX_PAGE_SIZE,
      );
    });
  });
});
