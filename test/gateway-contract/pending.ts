/**
 * @file Which rows run for which implementation, DERIVED from the Java
 * build's own pending list.
 *
 * **One fact, one file.** "This route is not implemented in Java" is already
 * written in `apps/api-gateway-java/src/test/resources/pending-apis.txt`,
 * where `GeneratedApiCoverageTest` asserts it only ever shrinks. A second
 * list here would be the same fact maintained twice, and the two would part
 * company the first time someone implemented an API without remembering the
 * harness. So each row declares the API TAG it exercises and the skip is
 * computed.
 *
 * Reading that file is a FILE READ, not an import: `image-contract.spec.ts`
 * refuses a relative import that leaves a workspace, which is why
 * `canonicalizeEnums` moved into `@synapsedesk/common` — but it says nothing
 * about data, and §3a's binding test already reads `.env.example` the same
 * way.
 *
 * **Skipped means REPORTED skipped.** `rowFor(...)` returns jest's `it.skip`,
 * so the runner prints the row and its name. A conditional `return` inside a
 * test body reports a PASS, which is the one outcome worse than a failure —
 * it says the Java gateway satisfies a contract nothing checked.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './gateway';
import { compareAlphabetically } from '@synapsedesk/common';

/** The tracked list the Java build owns. */
export const PENDING_APIS = join(
  REPO_ROOT,
  'apps/api-gateway-java/src/test/resources/pending-apis.txt',
);

/** Where the generator writes its interfaces, for the typo guard. */
export const GENERATED_APIS = join(
  REPO_ROOT,
  'apps/api-gateway-java/target/generated-sources/openapi/src/main/java/com/synapsedesk/gateway/generated/api',
);

/** The implementation under test. */
export const IMPL = process.env.GATEWAY_IMPL ?? 'node';

/**
 * `Tickets` -> `TicketsApi`, the generated interface's simple name.
 *
 * **Word-capitalized, not merely space-stripped.** A published tag can carry
 * spaces (`'Audit Logs'`, `'User Sessions'`) and even an un-capitalized word
 * (`'Webhook endpoints'` — lowercase `e`), while the generated interface never
 * does (`AuditLogsApi`, `UserSessionsApi`, `WebhookEndpointsApi`). Stripping
 * spaces alone would produce `WebhookendpointsApi`, which matches nothing in
 * `pending-apis.txt` — silently treating every one of that tag's operations as
 * unimplemented forever. Found the hard way: every `rowFor(...)` tag written
 * so far happens to be one word, so this path had never run through THAT
 * caller — it surfaced when `permission-coverage.contract-spec.ts` read tags
 * straight off the published document instead, where
 * multi-word ones already exist for modules not yet implemented.
 */
export const apiNameFor = (tag: string): string =>
  `${tag
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')}Api`;

/** Every interface the Java gateway has NOT implemented, by simple name. */
export function pendingApis(): Set<string> {
  const lines = readFileSync(PENDING_APIS, 'utf8').split('\n');

  return new Set(
    lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

/**
 * Rows the skeleton cannot pass yet, by NAME, with what each waits for.
 *
 * **The derived list covers ROUTES; this covers BEHAVIOURS.** A row can be
 * tagged for an API the Java gateway implements and still fail on something
 * the skeleton has not grown — CORS, the helmet header set, a metric that
 * only exists once its labels are first used. Those are not pending
 * interfaces, so `pending-apis.txt` cannot express them and should not try.
 *
 * **This list is the progress bar, and it must be EMPTY before the cutover
 * rehearsal.** Each entry names what it waits for, so that emptying it is a
 * checklist rather than an argument. A row skipped here and green for `node`
 * is the honest state; a row that quietly passes both because it asserts
 * nothing is the failure this harness exists to prevent.
 */
export const SKIPPED_FOR_JAVA: Readonly<Record<string, string>> = {
  'CORS exposes every rate-limit header':
    'the CORS policy and the per-tier rate-limit headers (the throttler)',
  'the helmet header set is on every response':
    'the security-header middleware',
  '`/metrics` exports the job gauge':
    'a metric is registered on first use, so the job gauge appears only once a job has reported — the reporter arrives with the NATS consumer',
  'a DTO validation failure':
    'the exact Node phrasing (whitelist rejection, class-validator type ' +
    'messages) — the per-field text is already ruled loose; this ' +
    'row asserts the exact Node string rather than the shape, and wants a ' +
    'second, shape-only row instead of a Java rewrite of this one',
  'a preflight from an origin outside the list':
    'the CORS policy — same subsystem as the rate-limit-header row above, not part of auth',
  'the login tier refuses the sixth attempt':
    'the throttler — rate limiting is its own subsystem, not part of auth',
  '**an explicit `dob: null` clears it**':
    '`openApiNullable` is off project-wide (pom.xml, deliberate), so the ' +
    'generated `UpdateUserDto.dob` cannot distinguish an explicit `null` ' +
    "from an absent key the way Node's `dto.dob === null` check can — both " +
    'deserialize to the same Java `null`',
};

/** True when this row's NAME is on the explicit list. */
function skippedByName(title: string): boolean {
  return Object.keys(SKIPPED_FOR_JAVA).some((fragment) =>
    title.includes(fragment),
  );
}

/**
 * `it` or `it.skip`, by whether this implementation serves those tags yet.
 *
 * For `node` it is always `it`: the Node gateway implements everything, and a
 * row skipped for it would be a row nothing runs.
 *
 * @example
 * rowFor('Tickets')('creates a ticket', async () => { … });
 */
export function rowFor(...tags: string[]): jest.It {
  if (IMPL === 'node') return it;

  const pending = pendingApis();
  const blocked = tags.filter((tag) => pending.has(apiNameFor(tag)));

  if (blocked.length > 0) return it.skip;

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
 * Direction, as ever: from the rows toward the interfaces. The reverse would
 * only confirm that the tags someone wrote down exist.
 */
export function declaredTags(): string[] {
  const here = join(REPO_ROOT, 'test/gateway-contract');
  const tags = new Set<string>();

  for (const file of readdirSync(here).filter((name) =>
    name.endsWith('.contract-spec.ts'),
  )) {
    const source = readFileSync(join(here, file), 'utf8');

    // FIXME Type 'IterableIterator<RegExpMatchArray>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.
    for (const call of source.matchAll(/rowFor\(([^)]*)\)/gu)) {
      for (const literal of call[1].matchAll(/'([^']+)'/gu)) {
        tags.add(literal[1]);
      }
    }
  }

  return [...tags].sort(compareAlphabetically);
}
