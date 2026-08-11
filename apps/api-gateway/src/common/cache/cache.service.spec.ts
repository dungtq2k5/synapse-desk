import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import { entityScope } from '../config/cache.config';
import { CacheService } from './cache.service';

/**
 * An in-memory stand-in for the commands `CacheService` issues.
 *
 * Hand-written rather than mocked wholesale, because two of these tests are
 * about what is NOT called — `keys` must stay untouched — and a permissive
 * auto-mock answers every method including the forbidden one.
 */
class FakeRedis {
  readonly store = new Map<string, string>();
  readonly calls: string[] = [];
  /** Set to make every command reject, for the fail-open tests. */
  broken = false;

  get(key: string): Promise<string | null> {
    this.calls.push('get');
    if (this.broken) return Promise.reject(new Error('Redis is down'));

    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.calls.push('set');
    if (this.broken) return Promise.reject(new Error('Redis is down'));

    this.store.set(key, value);

    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    this.calls.push('del');
    const removed = keys.filter((key) => this.store.delete(key)).length;

    return Promise.resolve(removed);
  }

  scan(
    _cursor: string,
    _match: 'MATCH',
    pattern: string,
  ): Promise<[string, string[]]> {
    this.calls.push('scan');
    const matcher = globToRegExp(pattern);
    const keys = [...this.store.keys()].filter((key) => matcher.test(key));

    // One page, then done — enough to exercise the cursor loop's exit.
    return Promise.resolve(['0', keys]);
  }

  /** Present so a call to it is a REAL call rather than a TypeError. */
  keys(): Promise<string[]> {
    this.calls.push('keys');

    return Promise.resolve([...this.store.keys()]);
  }
}

/** Redis glob → RegExp, for `*` and `[…]`, which is all the service uses. */
function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\[\\\|:\]/g, '[|:]');

  return new RegExp(`^${source}$`);
}

describe('CacheService', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = new CacheService({
      client: redis as unknown as Redis,
    } as RedisService);
  });

  const ORG = 'org-1';

  describe('§1 test 2 — the key is order-insensitive', () => {
    it('reordered parameters hit the same entry', () => {
      // The mild failure is a halved hit rate, invisibly. The severe one is an
      // invalidation that clears one spelling and leaves the other serving
      // stale data until its TTL.
      const a = cache.buildKey({
        organizationId: ORG,
        scope: 'analytics:overview',
        params: { from: '2026-01-01', to: '2026-02-01' },
      });
      const b = cache.buildKey({
        organizationId: ORG,
        scope: 'analytics:overview',
        params: { to: '2026-02-01', from: '2026-01-01' },
      });

      expect(a).toBe(b);
      // Pinned, because "they are equal" also holds if both are empty.
      expect(a).toBe(
        'cache:org-1|analytics:overview|from=2026-01-01&to=2026-02-01',
      );
    });
  });

  describe('§1 test 3 — absent and empty agree', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
    ])('%s is dropped and matches an absent parameter', (_, value) => {
      const absent = cache.buildKey({
        organizationId: ORG,
        scope: 'tickets',
        params: { status: 'OPEN' },
      });
      const present = cache.buildKey({
        organizationId: ORG,
        scope: 'tickets',
        params: { status: 'OPEN', search: value },
      });

      expect(present).toBe(absent);
    });

    it('but a meaningful falsy value is KEPT', () => {
      // `0` and `false` are answers, not absences. Dropping them would merge
      // `?page=0` into `?page` unset — and the two are different questions.
      const key = cache.buildKey({
        organizationId: ORG,
        scope: 'tickets',
        params: { page: 0, archived: false },
      });

      expect(key).toContain('archived=false');
      expect(key).toContain('page=0');
    });
  });

  describe('§2 the tenant is the first segment', () => {
    it('two tenants asking the identical question produce different keys', () => {
      const input = { scope: 'roles', params: { page: 1 } };

      expect(cache.buildKey({ ...input, organizationId: 'org-a' })).not.toBe(
        cache.buildKey({ ...input, organizationId: 'org-b' }),
      );
    });

    it('and a null tenant is a NAMED segment, not an empty one', () => {
      // An empty segment would collide every tenantless read under `cache:|…`.
      expect(
        cache.buildKey({ organizationId: null, scope: 'permissions' }),
      ).toBe('cache:no-tenant|permissions|');
    });
  });

  describe('§1 test 5 — a failure is never cached', () => {
    it('`produce()` throwing propagates and writes nothing', async () => {
      // Caching a failure turns one bad response into a minute of them, and
      // does it exactly when the origin is already struggling.
      const boom = new Error('origin exploded');

      await expect(
        cache.wrap({ organizationId: ORG, scope: 'roles' }, 60, () =>
          Promise.reject(boom),
        ),
      ).rejects.toBe(boom);

      expect(redis.store.size).toBe(0);
      expect(redis.calls).not.toContain('set');
    });

    it('and a second call still reaches the origin', async () => {
      const produce = jest
        .fn<Promise<string>, []>()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('recovered');

      const input = { organizationId: ORG, scope: 'roles' };

      await expect(cache.wrap(input, 60, produce)).rejects.toThrow('transient');
      await expect(cache.wrap(input, 60, produce)).resolves.toBe('recovered');

      expect(produce).toHaveBeenCalledTimes(2);
    });
  });

  describe('§1 test 4 — a cache fails OPEN', () => {
    it('a Redis outage still answers, from the origin', async () => {
      // The opposite of the throttler next door, which fails CLOSED. A cache
      // outage must make the product slow; it must not make it down.
      redis.broken = true;

      await expect(
        cache.wrap({ organizationId: ORG, scope: 'roles' }, 60, () =>
          Promise.resolve('from the origin'),
        ),
      ).resolves.toBe('from the origin');
    });
  });

  describe('read-through', () => {
    it('a hit does not call the origin', async () => {
      const input = { organizationId: ORG, scope: 'roles' };
      const produce = jest.fn().mockResolvedValue({ items: ['admin'] });

      await cache.wrap(input, 60, produce);
      const second = await cache.wrap(input, 60, produce);

      expect(produce).toHaveBeenCalledTimes(1);
      expect(second).toEqual({ items: ['admin'] });
    });

    it('**a cached `null` is a hit, not a miss**', async () => {
      // "This id resolves to nothing" is worth remembering, and it arrives back
      // from Redis as the string `"null"` — which a truthiness check treats as
      // a hit but an `if (cached)` on the PARSED value would treat as a miss,
      // re-querying the origin on every request for a row that does not exist.
      const input = {
        organizationId: ORG,
        scope: 'users',
        params: { id: 'x' },
      };
      const produce = jest.fn().mockResolvedValue(null);

      await cache.wrap(input, 60, produce);
      await cache.wrap(input, 60, produce);

      expect(produce).toHaveBeenCalledTimes(1);
    });

    it('and `undefined` is not written at all', async () => {
      // `JSON.stringify(undefined)` is `undefined`, not a string: writing it
      // stores the literal text and throws on the next parse.
      await cache.wrap({ organizationId: ORG, scope: 'roles' }, 60, () =>
        Promise.resolve(undefined),
      );

      expect(redis.store.size).toBe(0);
    });
  });

  describe('a `Date` survives the round trip', () => {
    it('**comes back as a Date, not an ISO string**', async () => {
      // The bug this fixes was live and silent. `GraphQLISODateTime.serialize()`
      // given a string returns `null` rather than throwing, so
      // `analyticsOverview { computedAt }` answered the real timestamp on a
      // cache MISS and `null` on a cache HIT — and `computedAt: null` means
      // "the rollups have never run", which is the exact diagnostic this field
      // exists to carry.
      const computedAt = new Date('2026-08-10T12:00:00.000Z');
      const input = { organizationId: ORG, scope: 'analytics:overview' };

      type Overview = { computedAt: Date | null };

      await cache.wrap<Overview>(input, 60, () =>
        Promise.resolve({ computedAt }),
      );
      const hit = await cache.wrap<Overview>(input, 60, () =>
        Promise.resolve({ computedAt: null }),
      );

      expect(hit.computedAt).toBeInstanceOf(Date);
      expect(hit.computedAt?.toISOString()).toBe('2026-08-10T12:00:00.000Z');
    });

    it('nested and in arrays too', async () => {
      const input = { organizationId: ORG, scope: 'tickets' };
      const at = new Date('2026-01-02T03:04:05.000Z');

      type Page = {
        items: { createdAt: Date }[];
        meta: { at: Date | null };
      };

      await cache.wrap<Page>(input, 60, () =>
        Promise.resolve({ items: [{ createdAt: at }], meta: { at } }),
      );
      const hit = await cache.wrap<Page>(input, 60, () =>
        Promise.resolve({ items: [], meta: { at: null } }),
      );

      expect(hit.items[0].createdAt).toBeInstanceOf(Date);
      expect(hit.meta.at).toBeInstanceOf(Date);
    });

    it('**and a string that merely LOOKS like a date stays a string**', async () => {
      // Why the tag exists instead of a reviver that guesses. `dataThrough` is
      // deliberately a `YYYY-MM-DD` string — a calendar day, not an instant —
      // and reviving it would shift it by the reader's timezone offset, which
      // is the exact bug its own docblock says it was typed this way to avoid.
      const input = { organizationId: ORG, scope: 'analytics:agents' };

      await cache.wrap(input, 60, () =>
        Promise.resolve({ dataThrough: '2026-08-09', title: '2026-08-09' }),
      );
      const hit = await cache.wrap(input, 60, () =>
        Promise.resolve({ dataThrough: '', title: '' }),
      );

      expect(hit.dataThrough).toBe('2026-08-09');
      expect(typeof hit.title).toBe('string');
    });
  });

  describe('§4 test 6 — invalidation uses SCAN, never KEYS', () => {
    beforeEach(async () => {
      const seed = async (organizationId: string, scope: string) => {
        await cache.wrap({ organizationId, scope }, 60, () =>
          Promise.resolve(`${organizationId}/${scope}`),
        );
      };

      await seed(ORG, 'analytics:overview');
      await seed(ORG, 'analytics:agents');
      await seed(ORG, 'analytics-export');
      await seed(ORG, 'roles');
      await seed('org-2', 'analytics:overview');
    });

    it('drops the scope and everything nested under it', async () => {
      const removed = await cache.invalidateScope(ORG, 'analytics');

      expect(removed).toBe(2);
      expect(redis.calls).toContain('scan');
      // `KEYS` blocks the server for the length of the keyspace, and this Redis
      // also serves the throttler and the socket adapter.
      expect(redis.calls).not.toContain('keys');
    });

    it('**and NOT a differently-named scope that merely shares a prefix**', async () => {
      // The reason the pattern is `scope[|:]*` and not `scope*`: the bare
      // wildcard deletes `analytics-export` too, which is a different cache
      // belonging to a different read.
      await cache.invalidateScope(ORG, 'analytics');

      expect([...redis.store.keys()]).toEqual(
        expect.arrayContaining([
          'cache:org-1|analytics-export|',
          'cache:org-1|roles|',
        ]),
      );
    });

    it('**and never another tenant**', async () => {
      await cache.invalidateScope(ORG, 'analytics');

      expect([...redis.store.keys()]).toContain(
        'cache:org-2|analytics:overview|',
      );
    });
  });

  describe('§31 C7 the scope pattern against names that do not exist yet', () => {
    it('**`entity:user` drops `entity:user:{id}` but NOT `entity:user-preferences`**', async () => {
      // The hyphen is what saves it, and nothing about the code says so — the
      // pattern is `scope[|:]*`, and `-` is neither. A future
      // `entity:user-preferences` scope silently disappearing on every profile
      // edit is the failure this names.
      const seed = (scope: string) =>
        cache.wrap({ organizationId: ORG, scope }, 60, () =>
          Promise.resolve(scope),
        );

      await seed(entityScope('user', 'abc'));
      await seed(entityScope('user', 'def'));
      await seed('entity:user-preferences:abc');
      await seed(entityScope('department', 'abc'));

      const removed = await cache.invalidateScope(ORG, 'entity:user');

      expect(removed).toBe(2);
      expect([...redis.store.keys()].sort()).toEqual([
        'cache:org-1|entity:department:abc|',
        'cache:org-1|entity:user-preferences:abc|',
      ]);
    });

    it('and one entity id drops only itself', async () => {
      // The precise granularity a mutation uses. Same mechanism, longer scope.
      await cache.wrap(
        { organizationId: ORG, scope: entityScope('user', 'abc') },
        60,
        () => Promise.resolve('abc'),
      );
      await cache.wrap(
        { organizationId: ORG, scope: entityScope('user', 'abcd') },
        60,
        () => Promise.resolve('abcd'),
      );

      // `abc` must not take `abcd` with it — a bare `abc*` would.
      expect(await cache.invalidateScope(ORG, entityScope('user', 'abc'))).toBe(
        1,
      );
      expect([...redis.store.keys()]).toEqual([
        'cache:org-1|entity:user:abcd|',
      ]);
    });
  });

  describe('invalidate', () => {
    it('drops one exact entry', async () => {
      const input = {
        organizationId: ORG,
        scope: 'roles',
        params: { page: 1 },
      };
      const produce = jest.fn().mockResolvedValue(['admin']);

      await cache.wrap(input, 60, produce);
      await cache.invalidate(input);
      await cache.wrap(input, 60, produce);

      expect(produce).toHaveBeenCalledTimes(2);
    });
  });

  describe('a nested query parameter cannot collide', () => {
    // The bug this replaced: `String(value)` rendered every object as
    // `[object Object]`, and `CacheableInterceptor` spreads `request.query`
    // straight in — which Express's default parser turns into objects for
    // `?f[x]=1`. Two different filters therefore built ONE key, and the second
    // caller was served the first's answer.
    const key = (params: Record<string, unknown>) =>
      cache.buildKey({ organizationId: ORG, scope: 'tickets', params });

    it('**two different nested filters produce different keys**', () => {
      expect(key({ f: { x: '1' } })).not.toBe(key({ f: { y: '2' } }));
    });

    it('and the same filter in a different key order produces ONE key', () => {
      // The other half: sorted recursively, so `{a,b}` and `{b,a}` are the same
      // question rather than two cache entries for it.
      expect(key({ f: { a: '1', b: '2' } })).toBe(
        key({ f: { b: '2', a: '1' } }),
      );
    });

    it('an array is bracketed, so it cannot collide with the joined string', () => {
      // `?a=1&a=2` arrives as `['1','2']`; a bare join would make it
      // indistinguishable from the literal `'1,2'`.
      expect(key({ a: ['1', '2'] })).not.toBe(key({ a: '1,2' }));
    });

    it('a Date keys by ISO, not by the machine locale', () => {
      const at = new Date('2026-02-01T10:00:00.000Z');

      expect(key({ at })).toContain('2026-02-01T10:00:00.000Z');
    });
  });
});
