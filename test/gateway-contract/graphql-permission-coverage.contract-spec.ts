/**
 * @file **The GraphQL permission-parity guard**: every root field Node gates
 * with `@RequirePermission` must be gated the same way in Java, for every
 * field NOT on `pending-graphql-fields.txt` — the field-keyed twin of
 * `permission-coverage.contract-spec.ts`, which reads REST controllers and
 * the published `openapi.json` instead.
 *
 * There is no generated interface or published document for GraphQL fields
 * to read tags from, so this reads the two real sources of
 * truth directly: Node's `*.resolver.ts` decorators, and the tracked
 * `schema.gql`'s own `Query`/`Mutation` field list.
 *
 * Two fields are gated in Node's schema but carry no code on purpose —
 * `users`' `me`-style query (caller-scoped) and `tickets`' escalate
 * mutation (matches its REST route) — and this guard must treat both as
 * DECISIONS, not gaps, or its first real run reports two false positives
 * whose usual fix is loosening the guard.
 *
 * `ponytail:` a targeted regex reader, not a TypeScript parser — same
 * caveat `permission-coverage.contract-spec.ts` states for its own style.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './gateway';
import { pendingGraphqlFields } from './pending';

const REQUIRE_PERMISSION = /@RequirePermission\(([^)]*)\)/u;
const STRING_LITERAL = /'([^']+)'/gu;

/** The codes a decorator's argument list names, in call order. */
function codesIn(decoratorArgs: string): string[] {
  return [...decoratorArgs.matchAll(STRING_LITERAL)].map((m) => m[1]);
}

/** Every `*.resolver.ts` source under the gateway, read once. */
function nodeResolverSources(): string[] {
  const sources: string[] = [];
  const root = join(REPO_ROOT, 'apps/api-gateway/src/modules');

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.resolver.ts'))
        sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk(root);

  return sources;
}

/**
 * The index of the `)` matching the `(` at `openIndex`, tracking depth.
 *
 * **Required, not a nicety.** `@Query(() => DepartmentPageResponseGqlDto, {
 * name: 'departments', ... })` nests a real `(` `)` pair — the arrow
 * function's own empty parameter list — inside the decorator's argument
 * list. A `[^)]*` scan (this file's first version) stops at that INNER `)`,
 * never reaches `name: 'departments'`, and returns `null` for every
 * `@Query(() => Type, {...})` decorator in the codebase — which is all of
 * them. Measured the hard way: a sabotaged permission code on
 * `DepartmentsResolver` passed this guard clean, because `nodeRootFieldCodes`
 * had already given up and the per-field assertion's `nodeCodes === null`
 * branch returned before comparing anything.
 */
function matchingParenIndex(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * What Node requires for one ROOT field (`Query.foo` / `Mutation.bar`), or
 * `null` for none.
 *
 * Root fields only — `@ResolveField` needs the owning TYPE, which is the
 * `@Resolver(() => X)` class argument rather than anything textual near the
 * method, and every field this plan's first pass implements is a root
 * field. Extending this to nested fields is the resolver plan's own
 * problem to solve when a `@ResolveField` carries a permission.
 *
 * The decorator names the field either via `{ name: 'foo' }` or, absent
 * that option, via the method name itself — so both forms are checked. The
 * signature scan also skips any decorators BETWEEN the `@Query`/`@Mutation`
 * and the method — `@RequirePermission` among them — which is exactly the
 * span searched for it.
 */
function nodeRootFieldCodes(
  sources: string[],
  kind: 'Query' | 'Mutation',
  fieldName: string,
): string[] | null {
  const decorator = kind === 'Query' ? '@Query' : '@Mutation';

  for (const source of sources) {
    let searchFrom = 0;

    for (;;) {
      const start = source.indexOf(`${decorator}(`, searchFrom);
      if (start < 0) break;

      const openParen = start + decorator.length;
      const closeParen = matchingParenIndex(source, openParen);
      if (closeParen < 0) break;

      const args = source.slice(openParen + 1, closeParen);
      searchFrom = closeParen + 1;

      const rest = source.slice(closeParen + 1, closeParen + 401);
      const signature = /\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?(\w+)\s*\(/u.exec(
        rest,
      );
      if (!signature) continue;

      const named = new RegExp(String.raw`name:\s*'${fieldName}'`, 'u').test(
        args,
      );
      if (!named && signature[1] !== fieldName) continue;

      const between = rest.slice(0, signature.index + signature[0].length);
      const found = REQUIRE_PERMISSION.exec(between);

      return found ? codesIn(found[1]) : null;
    }
  }

  return null;
}

/**
 * What Java requires for one root field's `@QueryMapping`/`@MutationMapping`
 * method, or `null`.
 *
 * **Line-anchored AND disambiguated by `@QueryMapping`/`@MutationMapping`,
 * not a free scan.** A first version allowed the "return type" segment to
 * contain `\s` — which crosses newlines — with no anchor forcing the match
 * to start at a real declaration. Measured: for `Query.documents` it matched
 * `"> documents("`, a fragment from unrelated text elsewhere in the 500-file
 * concatenation. Line-anchoring fixed that, and immediately surfaced the
 * NEXT failure mode: this codebase has more than one Java method literally
 * named `documents` — a private REST mapper among them — so the first
 * textual match is not necessarily the resolver's own. Every match is
 * walked, and the one THIS scan trusts is whichever decorator block
 * actually carries `@QueryMapping`/`@MutationMapping` — a REST helper never
 * does.
 */
function javaRootFieldCodes(
  javaSources: string,
  fieldName: string,
): string[] | null {
  const pattern = new RegExp(
    String.raw`\n([ \t]*(?:@[^\n]*\n[ \t]*)*)(?:public\s+)?[^\n(]*?\b${fieldName}\s*\(`,
    'gu',
  );

  let decorators: string | null = null;
  for (const match of javaSources.matchAll(pattern)) {
    if (/@(?:Query|Mutation)Mapping/u.test(match[1])) {
      decorators = match[1];
      break;
    }
  }
  if (decorators === null) return null;

  const found = /@RequirePermission\(([^)]*)\)/u.exec(decorators);
  if (!found) return null;

  return [...found[1].matchAll(/PermissionCodesEnum\.(\w+)/gu)].map((m) =>
    m[1].toLowerCase().replaceAll('_', '.'),
  );
}

/** The `Query`/`Mutation` root fields the tracked schema declares. */
function schemaRootFields(): { kind: 'Query' | 'Mutation'; name: string }[] {
  const schema = readFileSync(
    join(REPO_ROOT, 'apps/api-gateway/src/schema.gql'),
    'utf8',
  );
  const fields: { kind: 'Query' | 'Mutation'; name: string }[] = [];

  for (const kind of ['Query', 'Mutation'] as const) {
    const block = new RegExp(
      String.raw`type ${kind} \{\n([\s\S]*?)\n\}`,
      'u',
    ).exec(schema);
    if (!block) continue;

    for (const line of block[1].split('\n')) {
      const field = /^ {2}(\w+)[:(]/.exec(line);
      if (field) fields.push({ kind, name: field[1] });
    }
  }

  return fields;
}

/**
 * Fields Node gates BY DESIGN with no code — a per-field exception a flat
 * per-file column cannot express. Listed with the reason, so
 * an omission and a decision stay distinguishable here too.
 */
const DELIBERATELY_UNGATED = new Map<string, string>([
  [
    'Query.me',
    'caller-scoped — "The authenticated caller. Requires no permission." in the schema description itself',
  ],
  [
    'Mutation.escalateTicket',
    'matches its REST route, which carries no guard either',
  ],
]);

describe('GraphQL permission coverage — every gated Node field stays gated in Java', () => {
  const pending = pendingGraphqlFields();
  const nodeSources = nodeResolverSources();
  const javaRoot = join(REPO_ROOT, 'apps/api-gateway-java/src/main/java');
  const javaSourcesConcatenated = (() => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.java')) files.push(path);
      }
    };
    walk(javaRoot);

    return files.map((f) => readFileSync(f, 'utf8')).join('\n');
  })();

  const implemented = schemaRootFields().filter(
    (field) => !pending.has(`${field.kind}.${field.name}`),
  );

  for (const field of implemented) {
    const key = `${field.kind}.${field.name}`;

    it(`${key} is gated the same in Java as in Node`, () => {
      const nodeCodes = nodeRootFieldCodes(nodeSources, field.kind, field.name);

      if (DELIBERATELY_UNGATED.has(key)) {
        expect(nodeCodes).toBeNull();
        // The decision is about BOTH sides staying open, not just Node's —
        // a return here checked only that Node matched the exception list
        // and never looked at Java at all, so a `@RequirePermission` added
        // to the Java side of a deliberately-ungated field passed silently.
        expect(
          javaRootFieldCodes(javaSourcesConcatenated, field.name),
        ).toBeNull();

        return;
      }

      if (nodeCodes === null) {
        // Node itself is open here — nothing for Java to be missing, and
        // not one of the named exceptions either, so this is Node's own
        // caller-scoped design (`notifications`, `ticket-messages`), which
        // the coverage guard has no code to compare.
        return;
      }

      const javaCodes = javaRootFieldCodes(javaSourcesConcatenated, field.name);

      expect(javaCodes).not.toBeNull();
      expect(new Set(javaCodes)).toEqual(new Set(nodeCodes));
    });
  }

  it('the exception list names only fields the schema actually declares', () => {
    // An exception for a field that got renamed or removed would silently
    // stop meaning anything — the same "guard the guard" floor
    // `permission-coverage.contract-spec.ts` applies to its own list.
    const names = new Set(
      schemaRootFields().map((field) => `${field.kind}.${field.name}`),
    );

    for (const key of DELIBERATELY_UNGATED.keys()) {
      expect(names.has(key)).toBe(true);
    }
  });
});
