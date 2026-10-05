/**
 * @file **The permission registry for GraphQL**: every `Query`/`Mutation` root field the
 * published schema declares is gated in the gateway exactly as
 * `test/fixtures/permissions/graphql-fields.json` says, and that table names exactly
 * the root fields `docs/reference/schema.gql` declares.
 *
 * The twin of `permission-coverage.contract-spec.ts`, keyed by field rather than by
 * route, and built the same way:
 *
 * - **A registry, checked from both sides.** A field added to the schema is missing
 *   from the table until someone writes down what it requires; an entry for a field
 *   that no longer exists names nothing. Both fail.
 * - **The table is what the code must match.** Changing a field's permission is an
 *   edit to it.
 * - **An open field is checked too.** `[]` requires the resolver to carry no
 *   `@RequirePermission`, and the resolver must be found. Two of them are open by
 *   decision rather than by omission: `Query.me` is the caller's own record ("Requires
 *   no permission." in the schema's own description), and `Mutation.escalateTicket`
 *   matches its REST route, which carries no guard either.
 *
 * `ponytail:` a targeted regex reader of TypeScript and of SDL, not a parser — the same
 * caveat `permission-coverage.contract-spec.ts` states for its own style.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { matchingBracketIndex } from './brackets';
import { REPO_ROOT } from './gateway';

const TABLE = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'test/fixtures/permissions/graphql-fields.json'),
    'utf8',
  ),
) as Record<string, string[]>;

const REQUIRE_PERMISSION = /@RequirePermission\(([^)]*)\)/u;

/** The string-literal codes a decorator's argument list names. */
const codesIn = (decoratorArgs: string): string[] =>
  [...decoratorArgs.matchAll(/'([^']+)'/gu)].map((match) => match[1]);

/**
 * What one ROOT field (`Query.foo` / `Mutation.bar`) requires: `[]` when its resolver
 * carries no `@RequirePermission`, and `undefined` when no resolver for it is found at
 * all, which is never read as open.
 *
 * The decorator names the field either via `{ name: 'foo' }` or, absent that option,
 * via the method name itself — so both forms are checked. The span searched for
 * `@RequirePermission` is everything between the `@Query`/`@Mutation` and the method.
 *
 * **The decorator's arguments are bracket-matched, not `[^)]*`.**
 * `@Query(() => DepartmentPageResponseGqlDto, { name: 'departments' })` nests the arrow
 * function's own `()` inside the argument list, and a `[^)]*` scan stops there, never
 * reaching `name:` — measured: a sabotaged permission code passed clean that way.
 */
export function rootFieldCodes(
  sources: string,
  kind: 'Query' | 'Mutation',
  fieldName: string,
): string[] | undefined {
  const decorator = kind === 'Query' ? '@Query' : '@Mutation';
  let searchFrom = 0;

  for (;;) {
    const start = sources.indexOf(`${decorator}(`, searchFrom);
    if (start < 0) return undefined;

    const openParen = start + decorator.length;
    const closeParen = matchingBracketIndex(sources, openParen, '(', ')');
    if (closeParen < 0) return undefined;

    const args = sources.slice(openParen + 1, closeParen);
    searchFrom = closeParen + 1;

    const rest = sources.slice(closeParen + 1, closeParen + 401);
    const signature = /\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?(\w+)\s*\(/u.exec(
      rest,
    );
    if (!signature) continue;

    const named = new RegExp(String.raw`name:\s*'${fieldName}'`, 'u').test(
      args,
    );
    if (!named && signature[1] !== fieldName) continue;

    const found = REQUIRE_PERMISSION.exec(
      rest.slice(0, signature.index + signature[0].length),
    );

    return found ? codesIn(found[1]) : [];
  }
}

/**
 * The index of the `}` matching the `{` at `openIndex`, treating a
 * `"""..."""` block comment as opaque.
 *
 * **{@link matchingBracketIndex} is not enough here.** That helper assumes
 * every closing character is balanced by a real opening one — true of
 * generics and decorator parens, where the LANGUAGE guarantees it. GraphQL
 * SDL's `"""..."""` description is free text, and free text can contain an
 * UNBALANCED `}` with no matching `{` at all — depth-counting hits it,
 * drops to zero, and stops just as wrongly as the regex it replaced.
 * Skipping description content entirely is the actual fix.
 */
function matchingBraceSkippingDescriptions(
  source: string,
  openIndex: number,
): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    if (source.startsWith('"""', index)) {
      const end = source.indexOf('"""', index + 3);
      index = end < 0 ? source.length : end + 2;
      continue;
    }

    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * `source` with every `"""..."""` span removed entirely — delimiters and
 * content both.
 *
 * **The brace-matching fix alone is not enough.** It finds the right END of
 * the type block, but the per-LINE field regex below still reads whatever
 * text sits between those braces — and a description line can look exactly
 * like a field (`  Example:` matches `/^ {2}(\w+)[:(]/` same as `  foo:
 * String` does). The block has to come out before the lines are split, not
 * just be bounded correctly.
 */
function withoutDescriptions(source: string): string {
  let result = '';
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf('"""', index);
    if (start < 0) {
      result += source.slice(index);
      break;
    }

    result += source.slice(index, start);
    const end = source.indexOf('"""', start + 3);
    index = end < 0 ? source.length : end + 3;
  }

  return result;
}

/**
 * The `Query`/`Mutation` root fields a `schema.gql` SOURCE declares.
 *
 * **Not `\{\n([\s\S]*?)\n\}`.** The non-greedy body stops at the FIRST line
 * that is bare `}` — which a multi-line field description (a `"""..."""`
 * doc comment, ordinary GraphQL SDL) can contain as plain text. Measured: a
 * description line reading `Example:` immediately before a stray `}` line
 * inside the doc comment made this regex read `Example` as a field name and
 * silently drop every real field after it — same failure shape as the other
 * two guards in this directory, on a THIRD kind of bracket, and the one
 * where naive depth-matching ALSO fails (see {@link
 * matchingBraceSkippingDescriptions}). Takes the schema as a parameter so
 * the hostile shape can be pinned directly.
 */
export function schemaFieldsIn(
  schema: string,
): { kind: 'Query' | 'Mutation'; name: string }[] {
  const fields: { kind: 'Query' | 'Mutation'; name: string }[] = [];

  for (const kind of ['Query', 'Mutation'] as const) {
    const openIndex = schema.indexOf(`type ${kind} {`);
    if (openIndex < 0) continue;

    const braceIndex = openIndex + `type ${kind} `.length;
    const closeIndex = matchingBraceSkippingDescriptions(schema, braceIndex);
    if (closeIndex < 0) continue;

    const body = withoutDescriptions(schema.slice(braceIndex + 1, closeIndex));
    for (const line of body.split('\n')) {
      const field = /^ {2}(\w+)[:(]/.exec(line);
      if (field) fields.push({ kind, name: field[1] });
    }
  }

  return fields;
}

function schemaRootFields(): { kind: 'Query' | 'Mutation'; name: string }[] {
  return schemaFieldsIn(
    readFileSync(join(REPO_ROOT, 'docs/reference/schema.gql'), 'utf8'),
  );
}

describe('GraphQL permission coverage — every root field is gated as the table says', () => {
  const declared = new Set(
    schemaRootFields().map((field) => `${field.kind}.${field.name}`),
  );
  const resolverSources = (() => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.resolver.ts')) files.push(path);
      }
    };
    walk(join(REPO_ROOT, 'apps/api-gateway/src/modules'));

    return files.map((file) => readFileSync(file, 'utf8')).join('\n');
  })();

  it('the table names exactly the root fields the schema declares, no more and no fewer', () => {
    expect({
      missingFromTheTable: [...declared].filter((key) => !(key in TABLE)),
      namingNothing: Object.keys(TABLE).filter((key) => !declared.has(key)),
    }).toEqual({ missingFromTheTable: [], namingNothing: [] });
  });

  it('gates at least the 16 fields it was frozen with', () => {
    expect(
      Object.values(TABLE).filter((codes) => codes.length > 0).length,
    ).toBeGreaterThanOrEqual(16);
  });

  for (const [key, codes] of Object.entries(TABLE)) {
    it(`${key} requires ${codes.length ? codes.join(', ') : 'no permission'}`, () => {
      const [kind, field] = key.split('.') as ['Query' | 'Mutation', string];
      const required = rootFieldCodes(resolverSources, kind, field);

      expect(required).toBeDefined();
      expect(new Set(required)).toEqual(new Set(codes));
    });
  }

  it('rootFieldCodes reads a named decorator, tells an open resolver from a missing one', () => {
    const sources = `
class Resolvers {
  @Query(() => Page, { name: 'tickets', description: 'All of them.' })
  @RequirePermission('ticket.read')
  async list() {}

  @Query(() => User)
  async me() {}
}
`;

    expect(rootFieldCodes(sources, 'Query', 'tickets')).toEqual([
      'ticket.read',
    ]);
    expect(rootFieldCodes(sources, 'Query', 'me')).toEqual([]);
    expect(rootFieldCodes(sources, 'Query', 'renamed')).toBeUndefined();
    expect(rootFieldCodes(sources, 'Mutation', 'me')).toBeUndefined();
  });

  it('schemaFieldsIn survives a doc comment containing a bare `}` line', () => {
    // Measured against the PREVIOUS non-greedy `\{\n([\s\S]*?)\n\}`: a doc
    // comment line reading `Example:` immediately above a stray `}` line
    // (ordinary text inside a `"""..."""` description) made the block match
    // end there — `Example` was read as a field name, and every real field
    // after it silently vanished from `declaredTags`'s universe. Root
    // fields going missing from THIS scan is the direction that matters
    // (`declared-tags.contract-spec.ts`'s own "a row DECLARES" vs "the field
    // EXISTS" distinction) — the exact failure mode this guard exists to
    // catch, now caused by the guard's own reader instead.
    const hostile = `type Query {
  """
  Example:
}
  """
  foo: String
  bar: String
}

type Mutation {
  baz: String
}
`;

    expect(schemaFieldsIn(hostile)).toEqual([
      { kind: 'Query', name: 'foo' },
      { kind: 'Query', name: 'bar' },
      { kind: 'Mutation', name: 'baz' },
    ]);
  });
});
