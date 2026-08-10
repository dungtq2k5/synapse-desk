import { readFileSync } from 'node:fs';
import { buildSchema, parse } from 'graphql';
import {
  CROSS_SERVICE_FIELDS,
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
 * The complexity scorer — 25-doc §5, 26-doc §1.3.
 *
 * **The point of scoring at all is the WEIGHTING.** A scorer charging the same
 * for `title` (a property read on an object already in memory) and `assignee`
 * (a gRPC call to auth-service) is measuring the wrong thing — and that is the
 * whole difference between a limit that protects the system and one that merely
 * annoys clients.
 */
describe('§5 query complexity', () => {
  const cost = (query: string) => scoreDocument(parse(query));

  it('1. **a cross-service field scores higher than a scalar**', () => {
    // 26-doc §1.3 test 2. The ratio is the design; the absolute numbers are
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
    // 26-doc §1.3 test 4. If this ever fails, the limit is wrong, not the query.
    const realistic = cost(`{
      tickets(first: 50) {
        id title status createdAt
        assignee { id fullName avatarUrl }
        department { id name }
      }
    }`);

    expect(realistic).toBeLessThan(MAX_QUERY_COMPLEXITY);
  });

  it('7. the weighted field list is not empty', () => {
    // Guards tests 1-2: an empty set would make every field score as a scalar
    // and all of the above would pass while measuring nothing.
    expect(CROSS_SERVICE_FIELDS.size).toBeGreaterThan(0);
  });

  describe('§1.3 the list-default blind spot', () => {
    // The real schema, so the defaults are the ones clients actually meet.
    const schema = buildSchema(readFileSync(SCHEMA_PATH, 'utf8'));
    const defaults = listFieldDefaults(schema);
    const priced = (query: string) =>
      scoreDocument(parse(query), undefined, defaults);

    it('5. **`messages { id }` costs the same as `messages(first: 50) { id }`**', () => {
      // They return the same thing, so they must cost the same — 26-doc §1.3
      // test 5. `listSizeOf` reads the QUERY, and a client that omits `first`
      // leaves nothing to read: the field scored as ONE item while the
      // resolver's `defaultValue` returned fifty.
      //
      // Sharp because of which field it is. `Ticket.messages` is also the one
      // allowlisted direct gRPC call (§5), so `tickets(first: 50) { messages }`
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
