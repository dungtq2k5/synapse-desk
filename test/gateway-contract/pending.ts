/**
 * @file Which rows run for which implementation.
 *
 * **Every route is implemented in both**, so no row is skipped for being
 * unserved; the only rows skipped for Java are the ones NAMED in
 * {@link SKIPPED_FOR_JAVA}, each with what it waits for. A row declares the API
 * TAG it exercises — not to be gated by it, but so
 * `declared-tags.contract-spec.ts` can prove every published API has a row.
 *
 * **Skipped means REPORTED skipped.** `rowFor(...)` returns jest's `it.skip`,
 * so the runner prints the row and its name. A conditional `return` inside a
 * test body reports a PASS, which is the one outcome worse than a failure —
 * it says the Java gateway satisfies a contract nothing checked.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { matchingBracketIndex } from './brackets';
import { REPO_ROOT } from './gateway';
import { compareAlphabetically } from '@synapsedesk/common';

/** The implementation under test. */
export const IMPL = process.env.GATEWAY_IMPL ?? 'node';

/**
 * Rows the Java gateway cannot pass yet, by NAME, with what each waits for.
 *
 * **A BEHAVIOUR, never a route.** A row can exercise an API the Java gateway
 * serves and still fail on something it has not grown — a metric that only
 * exists once its labels are first used, an exact Node phrasing, a
 * distinction a project-wide setting erases. Each is recorded here by the
 * row's own title, with the reason beside it.
 *
 * **This list is the progress bar, and it must be EMPTY before the cutover
 * rehearsal.** Each entry names what it waits for, so that emptying it is a
 * checklist rather than an argument. A row skipped here and green for `node`
 * is the honest state; a row that quietly passes both because it asserts
 * nothing is the failure this harness exists to prevent.
 */
export const SKIPPED_FOR_JAVA: Readonly<Record<string, string>> = {
  '`/metrics` exports the job gauge':
    'a metric is registered on first use, so the job gauge appears only once a job has reported — the reporter arrives with the NATS consumer',
  'a DTO validation failure':
    'the exact Node phrasing (whitelist rejection, class-validator type ' +
    'messages) — the per-field text is already ruled loose; this ' +
    'row asserts the exact Node string rather than the shape, and wants a ' +
    'second, shape-only row instead of a Java rewrite of this one',
  '**an explicit `dob: null` clears it**':
    '`openApiNullable` is off project-wide (pom.xml, deliberate), so the ' +
    'generated `UpdateUserDto.dob` cannot distinguish an explicit `null` ' +
    "from an absent key the way Node's `dto.dob === null` check can — both " +
    'deserialize to the same Java `null`',
  '**`changePlan` succeeds without an `Idempotency-Key` header**':
    'the published contract marks `idempotency-key` required on this route ' +
    '(no `@ApiHeader` names it in `billing.controller.ts` — this looks like ' +
    "the Swagger CLI plugin's own default for a bare `@Headers()` parameter, " +
    "not a deliberate spec decision) while Node's handler treats it as " +
    'optional (`idempotencyKey?: string`) and never enforces the header at ' +
    "all. Java's `BillingController` keeps the published contract's " +
    '`@NotNull @RequestHeader(required = true)`, so an absent header 400s ' +
    'before the controller runs — a genuine, pre-existing spec/' +
    'implementation gap this port did not introduce and should not paper ' +
    'over by deviating from the published contract',
};

/** True when this row's NAME is on the explicit list. */
function skippedByName(title: string): boolean {
  return Object.keys(SKIPPED_FOR_JAVA).some((fragment) =>
    title.includes(fragment),
  );
}

/**
 * `it` or `it.skip`, by whether this row is named in {@link SKIPPED_FOR_JAVA}.
 *
 * For `node` it is always `it`: the Node gateway does everything, and a row
 * skipped for it would be a row nothing runs.
 *
 * **The tags are not consulted.** They name the API the row exercises, and
 * are read by `declaredTags()` — never here, because nothing is gated by API
 * any more.
 *
 * @example
 * rowFor('Tickets')('creates a ticket', async () => { … });
 */
export function rowFor(...tags: string[]): jest.It {
  // Declared for `declaredTags()`, deliberately not consulted here.
  void tags;

  if (IMPL === 'node') return it;

  // The name is not known until the row declares it, so the explicit list is
  // applied by wrapping `it` rather than by choosing it up front.
  const gated = ((title: string, ...rest: unknown[]) =>
    (skippedByName(title) ? it.skip : it)(
      title,
      ...(rest as Parameters<jest.It>[1][]),
    )) as unknown as jest.It;

  return Object.assign(gated, it);
}

/**
 * The tags the rows actually declare, read from the spec SOURCES.
 *
 * **Scanned, not listed.** A hand-kept map beside these files would be the
 * second copy this whole design exists to avoid — and it drifts silently:
 * measured, a `rowFor('Webhookz')` typo left a map saying `Webhooks` and the
 * guard stayed green while the row skipped for ever. The calls are the
 * declaration; this reads them.
 *
 * Direction, as ever: from the rows toward the published document. The
 * reverse would only confirm that the tags someone wrote down exist.
 */
/**
 * Every tag a `rowFor(...)` call in `source` names as a string literal.
 *
 * **Depth-matched, not `rowFor\(([^)]*)\)`.** A `[^)]*` scan stops at the
 * FIRST `)`, so a call like `rowFor(tagsFor(x))` would silently contribute
 * zero tags rather than the real ones — the same failure shape
 * `graphql-permission-coverage`'s `@Query(...)` parsing hit, and
 * `permission-coverage`'s nested `ResponseEntity<...>` hit again. This one
 * is upstream of every guard that trusts {@link declaredTags}, so an
 * under-count here checks fewer tags for typos WHILE STAYING GREEN, rather
 * than failing on the row it missed — the highest-consequence of the three.
 * Exported so the hostile shape can be pinned directly, without a fixture
 * file on disk.
 */
export function tagsIn(source: string): string[] {
  const tags: string[] = [];
  let searchFrom = 0;

  for (;;) {
    const start = source.indexOf('rowFor(', searchFrom);
    if (start < 0) break;

    const openParen = start + 'rowFor'.length;
    const closeParen = matchingBracketIndex(source, openParen, '(', ')');
    if (closeParen < 0) break;

    for (const literal of source
      .slice(openParen + 1, closeParen)
      .matchAll(/'([^']+)'/gu)) {
      tags.push(literal[1]);
    }
    searchFrom = closeParen + 1;
  }

  return tags;
}

export function declaredTags(): string[] {
  const here = join(REPO_ROOT, 'test/gateway-contract');
  const tags = new Set<string>();

  for (const file of readdirSync(here).filter((name) =>
    name.endsWith('.contract-spec.ts'),
  )) {
    for (const tag of tagsIn(readFileSync(join(here, file), 'utf8'))) {
      tags.add(tag);
    }
  }

  return [...tags].sort(compareAlphabetically);
}

/**
 * The root `Query`/`Mutation` fields the Java gateway does not resolve yet.
 * `schema.gql` generates no interface a missing field could fail to
 * implement, so the list is how an unresolved field is told from a forgotten
 * one. `GraphqlFieldCoverageTest` reads the same file and asserts it only ever
 * shrinks.
 */
export const PENDING_GRAPHQL_FIELDS = join(
  REPO_ROOT,
  'apps/api-gateway-java/src/test/resources/pending-graphql-fields.txt',
);

/** Every root `Query`/`Mutation` field the Java gateway does NOT resolve yet. */
export function pendingGraphqlFields(): Set<string> {
  const lines = readFileSync(PENDING_GRAPHQL_FIELDS, 'utf8').split('\n');

  return new Set(
    lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

/**
 * `it` or `it.skip`, by whether this implementation resolves these ROOT
 * FIELDS yet — `rowFor`'s counterpart for GraphQL, keyed by the exact
 * `Query.foo` / `Mutation.bar` name rather than by REST tag, since a field
 * name needs no capitalization dance the way a published tag does.
 *
 * @example
 * rowForField('Query.tickets')('a query at depth 7 passes', async () => { … });
 */
export function rowForField(...fields: string[]): jest.It {
  if (IMPL === 'node') return it;

  const pending = pendingGraphqlFields();
  const blocked = fields.some((field) => pending.has(field));

  return blocked ? it.skip : it;
}
