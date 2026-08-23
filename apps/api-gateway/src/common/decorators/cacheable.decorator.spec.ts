import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cacheable, CACHEABLE_KEY } from './cacheable.decorator';

/**
 * Which reads are cached, and whether anything ever evicts them.
 *
 * Static, because the failure this guards is an ABSENCE: a `@Cacheable` added
 * to a read whose scope nothing invalidates does not fail, does not log, and
 * serves its TTL out forever — correctly, by its own lights. No runtime test
 * looks for a thing nobody wrote.
 */
const SRC = join(__dirname, '../..');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) out.push(path);
  }

  return out;
};

const sources = () =>
  walk(SRC).map((path) => ({
    path: path.slice(SRC.length + 1),
    text: readFileSync(path, 'utf8'),
  }));

describe('A cached route documents itself', () => {
  // Read back from the metadata rather than from a built
  // OpenAPI document, so this holds without booting the app — and so the
  // failure names the decorator rather than a missing key in a large object.
  // The key `@nestjs/swagger` writes extensions under. Spelled out rather than
  // imported from `@nestjs/swagger/dist/constants`, which the package does not
  // export — reaching into `dist/` is how a test breaks on a patch release.
  const API_EXTENSION = 'swagger/apiExtension';

  const extensionsOf = (method: object): Record<string, unknown> =>
    (Reflect.getMetadata(API_EXTENSION, method) as Record<string, unknown>) ??
    {};

  it('**publishes the SAME object the interceptor reads**', () => {
    // One decorator call, two consumers. Publishing a copy would let the
    // document and the behaviour disagree, which is worse than not publishing
    // — a client would trust a TTL nothing honours.
    class Probe {
      @Cacheable({ scope: 'roles', ttlSeconds: 300, varyBy: 'tenant' })
      list(): void {}
    }

    const method = Probe.prototype.list;

    expect(extensionsOf(method)['x-cache']).toEqual({
      scope: 'roles',
      ttlSeconds: 300,
      varyBy: 'tenant',
    });

    // And the interceptor's half is still there — `applyDecorators` composing
    // two decorators is exactly where one of them quietly stops applying.
    expect(Reflect.getMetadata(CACHEABLE_KEY, method)).toEqual({
      scope: 'roles',
      ttlSeconds: 300,
      varyBy: 'tenant',
    });
  });

  it('and `caller` visibility survives to the document', () => {
    class Probe {
      @Cacheable({ scope: 'documents', ttlSeconds: 60, varyBy: 'caller' })
      list(): void {}
    }

    expect(
      (extensionsOf(Probe.prototype.list)['x-cache'] as { varyBy: string })
        .varyBy,
    ).toBe('caller');
  });
});

describe('What is cached', () => {
  /** Every `scope: CACHE_SCOPES.x` inside a `@Cacheable({ … })`. */
  const cachedScopes = (): string[] =>
    sources()
      .flatMap(({ text }) => [
        ...text.matchAll(/@Cacheable\(\{[\s\S]*?scope:\s*CACHE_SCOPES\.(\w+)/g),
      ])
      .map((match) => match[1])
      .sort();

  /** Every scope some write or some event drops. */
  const evictedScopes = (): Set<string> =>
    new Set(
      sources()
        .flatMap(({ text }) => [
          ...text.matchAll(/@InvalidateCache\(CACHE_SCOPES\.(\w+)/g),
          ...text.matchAll(/this\.drop\(CACHE_SCOPES\.(\w+)/g),
        ])
        .map((match) => match[1]),
    );

  /**
   * Cached scopes with no invalidation path, and why.
   *
   * `permissions` is the permission REGISTRY: seeded rows, changed by a
   * migration and a deploy rather than by any request. There is no write to hang
   * an eviction on, and its one-hour TTL is bounded by a process that restarts
   * when the catalogue changes.
   */
  const EVICTION_EXEMPT = new Set(['permissions']);

  it('the sweep sees source files at all', () => {
    // Guards the guard: an empty scan reports a perfectly disciplined codebase.
    expect(sources().length).toBeGreaterThan(100);
  });

  it('**exactly the intended reads, and no others**', () => {
    // A short list on purpose. A cache on a read that changes constantly is a
    // bug with a hit rate, and the way this list grows is one plausible
    // addition at a time.
    expect(cachedScopes()).toEqual([
      'departments',
      'documents',
      'organizations',
      'permissions',
      'roles',
    ]);
  });

  it('**and nothing a mutation on the same screen writes**', () => {
    // Tickets, messages and notifications. A user watching their own ticket
    // must not watch their own reply disappear for a minute — and
    // `unread-count` is the trap: the most-polled route in the product, whose
    // polling the WebSocket already made unnecessary.
    const offenders = sources()
      .filter(({ path }) =>
        /modules\/(tickets|notifications|realtime|chat|feedback)\//.test(path),
      )
      .filter(({ text }) => text.includes('@Cacheable('))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('**no cached handler authorizes in its own body**', () => {
    // The systemic version of a bug that was live: a response
    // cache serves a hit WITHOUT running the handler, so any authorization
    // inside the handler is skipped for every caller after the first. It cost
    // `?includeDeleted=true` — one caller with `department.delete` warmed the
    // entry and the next caller without it got a 200.
    //
    // File-level and deliberately blunt: a controller here is thin, so a
    // permission check anywhere in one is close enough to "in a handler", and
    // the remedy in either case is the same — move it to a guard, which runs
    // before interceptors.
    const offenders = sources()
      .filter(({ text }) => text.includes('@Cacheable('))
      .filter(({ text }) =>
        /permissionCodes\.includes\(|ForbiddenException/.test(text),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('and the sweep would notice one', () => {
    // Guards the guard: the filter above finds nothing either when every
    // controller is clean or when `@Cacheable` stops being spelled that way.
    const cached = sources().filter(({ text }) => text.includes('@Cacheable('));

    expect(cached.length).toBeGreaterThanOrEqual(5);
  });

  it('**every cached scope has something that evicts it**', () => {
    // The systemic failure: a cached read nobody invalidates. It looks
    // finished, it is fast, and it is wrong for exactly as long as its TTL —
    // forever, from the reader's point of view, since the TTL just resets.
    const evicted = evictedScopes();

    const orphans = [...new Set(cachedScopes())].filter(
      (scope) => !evicted.has(scope) && !EVICTION_EXEMPT.has(scope),
    );

    expect(orphans).toEqual([]);
  });

  it('and the exemptions are still exempt for the stated reason', () => {
    // An exemption nobody re-reads becomes an exemption nobody can justify.
    // `permissions` is the seeded catalogue — it changes on DEPLOY, which
    // restarts the process and cannot be signalled by any tenant's write. If a
    // runtime writer for it ever appears, this fails and asks the question.
    for (const scope of EVICTION_EXEMPT) {
      expect(evictedScopes().has(scope)).toBe(false);
    }
  });
});

describe('A cached route carries no per-request advisory', () => {
  /**
   * The hazard, and why it is worth a scan rather than a comment.
   *
   * `CacheableInterceptor` is an `APP_INTERCEPTOR` and `TransformInterceptor`
   * is bound with `useGlobalInterceptors`, so the cache sits OUTSIDE the
   * envelope and stores `{ success, statusCode, message, warning, data }`
   * whole. Anything the envelope carries is frozen into the entry for the rest
   * of the TTL.
   *
   * For `data` that is the point. For `message` and `warning` it is a defect:
   * an advisory attached to the ONE caller who missed the cache is then replayed
   * to every other caller in the tenant for an hour — and nothing reports it,
   * because serving a cached response is the decorator working.
   *
   * **Latent today, deliberately pinned anyway.** None of the five `@Cacheable`
   * handlers sets a message or a warning, so nothing is being replayed. The
   * combination is one decorator away, and the interceptor's own docblock
   * asserted the opposite behaviour for long enough that a GraphQL loader was
   * built on the wrong sentence — which is the argument for checking rather
   * than describing.
   */
  const cacheableHandlers = () =>
    sources()
      .filter(({ text }) => text.includes('@Cacheable('))
      .flatMap(({ path, text }) =>
        // Split on BLANK LINES, not on decorators. Splitting at every `@` puts
        // each decorator in its own block, so `@ResponseMessage` sitting above
        // `@Cacheable` on the same method lands in a different one and the pair
        // is invisible — which is exactly what this scan exists to see, and how
        // its first version passed a sabotage that added the advisory.
        //
        // Per member rather than per FILE, because a controller that caches one
        // route and sets a message on another is legal and common.
        text
          .split(/\n\s*\n(?= {2}\S)/)
          .filter((member) => member.includes('@Cacheable('))
          .map((member) => ({ path, member })),
      );

  it('**1. the scan finds the cached handlers at all**', () => {
    // Guards the guard: a regex matching nothing passes the assertion below
    // over an empty list, which is the failure this whole file is about.
    expect(cacheableHandlers()).toHaveLength(5);
  });

  it('**2. and none of them sets a message or a warning**', () => {
    const offenders = cacheableHandlers()
      .filter(({ member }) =>
        /@ResponseMessage\(|locals\.(?:warning|message)\s*=/.test(member),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
