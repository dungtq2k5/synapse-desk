import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every feature module in the gateway — because resolvers do not live in one
 * folder, and this file does not live beside them.
 *
 * Resolvers sit next to the controllers they mirror
 * (`modules/tickets/tickets.resolver.ts`, `modules/users/users.resolver.ts`, …)
 * while the GraphQL infrastructure lives in `common/graphql/`. So the path is
 * spelled out from `src/`: a relative `'..'` would resolve to `common/`, find no
 * resolvers at all, and — but for the pinned list in the first test — pass every
 * rule below over an empty set.
 */
const MODULES_DIR = join(__dirname, '../../modules');

/** Every `*.resolver.ts` under `modules/`, at any depth. */
const walkFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, out);
    else out.push(path);
  }

  return out;
};

/**
 * The rule that decays first — 26-doc §5 test 5.
 *
 * **A FIELD resolver never calls a gRPC client directly; only a loader.** A
 * direct call is an N+1 that works perfectly in every test with one parent row,
 * and only misbehaves at fifty — which is the page size the product actually
 * uses.
 *
 * 26-doc says to write this test early, and the reason is behavioural rather
 * than technical: people break rule 1 in the direction that works locally.
 *
 * **Written now, before the first field resolver exists** (those need 27-doc's
 * batch RPCs). A guard added after the thing it guards is a guard written while
 * looking at the code it is supposed to judge.
 */
describe('§5 field resolvers never inject a gRPC client', () => {
  const resolverFiles = () =>
    walkFiles(MODULES_DIR)
      .filter((path) => path.endsWith('.resolver.ts'))
      .map((path) => ({
        // The BASENAME, so the allowlist below stays readable and does not
        // encode a folder layout it has no opinion about.
        name: path.slice(path.lastIndexOf('/') + 1),
        source: readFileSync(path, 'utf8'),
      }));

  it('1. the scan finds resolver files at all', () => {
    // Guards the guard: an empty file list makes every assertion below pass
    // while checking nothing, which is the exact failure mode this suite is
    // about somewhere else.
    //
    // Pinned to the CURRENT count rather than `> 0`, because the failure this
    // now has to catch is a scan that finds SOME resolvers — the walk breaking
    // and returning only the one in this folder would still be "greater than
    // zero" while silently exempting seven files.
    const found = resolverFiles()
      .map(({ name }) => name)
      .sort();

    expect(found).toEqual([
      'analytics.resolver.ts',
      'api-info.resolver.ts',
      'departments.resolver.ts',
      'documents.resolver.ts',
      'notifications.resolver.ts',
      'ticket-messages.resolver.ts',
      'tickets.resolver.ts',
      'users.resolver.ts',
    ]);
  });

  /**
   * The ONE sanctioned direct call — 26-doc §3.
   *
   * `Ticket.messages` has no loader because there is nothing to batch INTO:
   * messages live in the same service as the ticket and are fetched by ticket
   * id, so no `ListMessagesByIds` exists and inventing one would batch a query
   * nobody makes. The doc's own edge table records it as "same service, one
   * call".
   *
   * **An allowlist rather than a widened rule.** Relaxing the pattern would
   * exempt every future direct call too; naming this one keeps the rule intact
   * and makes the next exception a deliberate edit with a reason beside it.
   */
  const SANCTIONED_DIRECT_CALLS = ['tickets.resolver.ts:messages'];

  /** Every `@ResolveField` method, as `file:fieldName`. */
  const resolveFields = () =>
    resolverFiles().flatMap(({ name, source }) =>
      [
        ...source.matchAll(
          /@ResolveField\([\s\S]*?\n(?<body>[\s\S]*?)(?=\n {2}@|\n}$)/g,
        ),
      ].map((match) => {
        const body = match.groups?.body ?? '';

        return {
          id: `${name}:${/^\s+(?:async\s+)?(\w+)\(/m.exec(body)?.[1] ?? '?'}`,
          body,
        };
      }),
    );

  it('2. **no `@ResolveField` method calls a gRPC client**', () => {
    // Matched on the METHOD BODY rather than on the constructor: a root query
    // and a field resolver legitimately live on the same class —
    // `TicketsResolver` owns both — so a constructor-level ban would forbid the
    // root query from doing the one thing it is supposed to do.
    const offenders = resolveFields()
      .filter(({ body }) => /this\.\w*(?:GrpcClient|Client)\b\s*\./.test(body))
      .map(({ id }) => id);

    expect(offenders.sort()).toEqual([...SANCTIONED_DIRECT_CALLS].sort());
  });

  it('and the sanctioned list has not gone stale', () => {
    // Guards the allowlist from the other direction: an entry for a field that
    // no longer makes a direct call is an exemption nobody is using, and the
    // next person to read it learns the wrong rule.
    const all = resolveFields().map(({ id }) => id);

    for (const sanctioned of SANCTIONED_DIRECT_CALLS) {
      expect(all).toContain(sanctioned);
    }
  });

  it('3. **loaders come from the CONTEXT, never from injection**', () => {
    // 25-doc §6. Injection means either a shared cache across tenants — a
    // cross-tenant leak whose cause is a performance optimisation — or
    // `Scope.REQUEST` bubbling through the module graph and dragging half the
    // gateway's providers into request scope with it.
    const offenders = resolverFiles()
      .filter(({ source }) => {
        const constructor =
          /constructor\(([\s\S]*?)\)\s*\{/.exec(source)?.[1] ?? '';

        return /Loader|loaders/i.test(constructor);
      })
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  it('4. the loader factory is the ONLY place a DataLoader is constructed', () => {
    // The other half of rule 2, from the opposite direction: a `new DataLoader`
    // anywhere else is a loader whose lifetime nobody decided.
    //
    // **Swept across the whole of `src/`, not just `modules/`.** Two places are
    // tempting and each is invisible to a scan of the other: next to the
    // resolver that wants a loader (`modules/`), and next to the loaders that
    // already exist (`common/graphql/loaders/`). Scanning from the source root
    // covers both, and will cover wherever the third place turns out to be.
    const SRC_DIR = join(__dirname, '../..');
    const factory = join(__dirname, 'loaders/loaders.factory.ts');

    expect(existsSync(factory)).toBe(true);

    const offenders = walkFiles(SRC_DIR)
      .filter(
        (path) =>
          path.endsWith('.ts') &&
          !path.endsWith('.spec.ts') &&
          path !== factory,
      )
      .filter((path) => /new DataLoader\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.replace(SRC_DIR, ''));

    expect(offenders).toEqual([]);
  });
});
