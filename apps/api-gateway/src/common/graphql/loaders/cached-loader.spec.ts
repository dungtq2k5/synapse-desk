import type { CacheService } from '../../cache/cache.service';
import { entityScope } from '../../config/cache.config';
import { createCachedLoader } from './loaders.factory';

/**
 * The entity cache's ordering contract, written first.
 *
 * **The batch-alignment bug, in its new and likelier form.** A DataLoader batch must
 * return `results[i]` for `keys[i]`. With a cache in front, the natural
 * implementation concatenates the hits and the fetched rows — producing an
 * array of the right LENGTH in the cache's order, so every assertion about
 * counts passes and every field resolver renders the wrong user against the
 * wrong parent. Nothing throws. With `UserSummary` being a name and an avatar,
 * nothing on the page looks wrong either.
 *
 * A partial hit is where this happens, and a partial hit is the normal case.
 */
describe('createCachedLoader', () => {
  const ttlSeconds = 300;
  const organizationId = 'org-1';

  type Row = { userId: string; fullName: string };

  /** A cache that hits for exactly the ids given. */
  const cacheWith = (hits: Record<string, Row>) => {
    const written: { scope: string; value: Row }[] = [];

    const cache: Pick<CacheService, 'mget' | 'msetEx'> = {
      mget: <T>(inputs: { scope: string }[]) =>
        Promise.resolve(
          inputs.map(
            (input) =>
              (Object.entries(hits).find(
                ([id]) => input.scope === entityScope('user', id),
              )?.[1] as T | undefined) ?? null,
          ),
        ),
      msetEx: <T>(
        entries: { input: { scope: string }; value: T }[],
      ): Promise<void> => {
        for (const entry of entries) {
          written.push({
            scope: entry.input.scope,
            value: entry.value as Row,
          });
        }

        return Promise.resolve();
      },
    };

    return { cache: cache as CacheService, written };
  };

  const build = (
    hits: Record<string, Row>,
    fetch: (ids: string[]) => Promise<Row[]>,
    tenant: string | null = organizationId,
  ) => {
    const { cache, written } = cacheWith(hits);

    return {
      written,
      loader: createCachedLoader<Row>({
        cache,
        organizationId: () => tenant,
        scopeOf: (id) => entityScope('user', id),
        ttlSeconds,
        keyOf: (row) => row.userId,
        fetch,
      }),
    };
  };

  it('**a partial hit stays aligned to the KEYS**', async () => {
    // `b` is cached; `a` and `c` are not. The RPC answers in ITS order, which
    // is not the caller's — a database returns `WHERE id IN ('c','a')` however
    // it likes.
    const fetch = jest.fn((ids: string[]) =>
      Promise.resolve(
        // Deliberately reversed relative to the request.
        [...ids].reverse().map((id) => ({ userId: id, fullName: `RPC ${id}` })),
      ),
    );

    const { loader } = build(
      { b: { userId: 'b', fullName: 'CACHED b' } },
      fetch,
    );

    const rows = await loader.loadMany(['a', 'b', 'c']);

    expect(rows).toEqual([
      { userId: 'a', fullName: 'RPC a' },
      { userId: 'b', fullName: 'CACHED b' },
      { userId: 'c', fullName: 'RPC c' },
    ]);
  });

  it('**and the RPC is called with the MISSES only**', async () => {
    const fetch = jest.fn((ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ userId: id, fullName: `RPC ${id}` }))),
    );

    const { loader } = build(
      { b: { userId: 'b', fullName: 'CACHED b' } },
      fetch,
    );

    await loader.loadMany(['a', 'b', 'c']);

    expect(fetch).toHaveBeenCalledWith(['a', 'c']);
  });

  it('an all-hit batch makes NO rpc call at all', async () => {
    // The point of the layer, at the unit level.
    const fetch = jest.fn(() => Promise.resolve([]));

    const { loader } = build(
      {
        a: { userId: 'a', fullName: 'CACHED a' },
        b: { userId: 'b', fullName: 'CACHED b' },
      },
      fetch,
    );

    const rows = await loader.loadMany(['a', 'b']);

    expect(fetch).not.toHaveBeenCalled();
    expect(rows).toEqual([
      { userId: 'a', fullName: 'CACHED a' },
      { userId: 'b', fullName: 'CACHED b' },
    ]);
  });

  it('writes only what it fetched, under the per-entity scope', async () => {
    const fetch = (ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ userId: id, fullName: `RPC ${id}` })));

    const { loader, written } = build(
      { b: { userId: 'b', fullName: 'CACHED b' } },
      fetch,
    );

    await loader.loadMany(['a', 'b', 'c']);

    expect(written.map((entry) => entry.scope).sort()).toEqual([
      entityScope('user', 'a'),
      entityScope('user', 'c'),
    ]);
  });

  it('**an id that resolves to nothing is a null in ITS OWN slot**', async () => {
    // Not a shift in every slot after it, which is what a short array does.
    const fetch = (ids: string[]) =>
      Promise.resolve(
        ids
          .filter((id) => id !== 'gone')
          .map((id) => ({ userId: id, fullName: `RPC ${id}` })),
      );

    const { loader } = build({}, fetch);

    expect(await loader.loadMany(['a', 'gone', 'c'])).toEqual([
      { userId: 'a', fullName: 'RPC a' },
      null,
      { userId: 'c', fullName: 'RPC c' },
    ]);
  });

  it('and it is NOT remembered as absent', async () => {
    // No negative caching: a miss and a cached `null` are indistinguishable
    // through `MGET`, and the failure mode of getting that wrong is a live
    // user permanently invisible behind a cached "does not exist".
    const fetch = jest.fn(() => Promise.resolve([]));
    const { loader, written } = build({}, fetch);

    await loader.load('gone');

    expect(written).toEqual([]);
  });

  it('bypasses the cache entirely without a tenant', async () => {
    // An anonymous request has no organization to key under, and the RPC
    // behind it resolves nothing anyway.
    const fetch = jest.fn((ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ userId: id, fullName: id }))),
    );

    const { loader, written } = build(
      { a: { userId: 'a', fullName: 'CACHED a' } },
      fetch,
      null,
    );

    expect(await loader.load('a')).toEqual({ userId: 'a', fullName: 'a' });
    expect(fetch).toHaveBeenCalledWith(['a']);
    expect(written).toEqual([]);
  });
});
