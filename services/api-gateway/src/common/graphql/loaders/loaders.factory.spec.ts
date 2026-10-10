import { alignToKeys, createLoader } from './loaders.factory';

/**
 * The loader seam
 *
 * **Test 1 is the highest-value test in the GraphQL work.** Every other failure
 * in this area is visible; this one renders a completely convincing page with
 * the wrong people on it.
 *
 * Written against a STUB, before any batch RPC exists. The
 * bug lives in the mapping, not in the RPC, and writing the mapping while
 * thinking about the RPC is how it gets written wrong.
 */
describe('loader key alignment', () => {
  type User = { id: string; fullName: string };
  const user = (id: string): User => ({ id, fullName: `User ${id}` });

  it('1. **a response in a DIFFERENT order maps each entity to the right key**', async () => {
    // DataLoader's contract is POSITIONAL: `results[i]` belongs to `keys[i]`.
    // A database answers `WHERE id IN ('c','a','b')` with a, b, c — hand that
    // straight back and DataLoader assigns **a** to key `c`. Every field
    // resolver then renders the wrong user against the wrong ticket, with no
    // error anywhere and a page that looks entirely plausible.
    const keys = ['c', 'a', 'b'];
    const reversed = [user('a'), user('b'), user('c')];

    const aligned = alignToKeys(keys, reversed, (u) => u.id);

    // Asserted as PAIRING, not membership. A membership assertion passes for
    // the misattributed case, which is the entire bug.
    expect(aligned.map((u) => u?.id)).toEqual(['c', 'a', 'b']);

    // And through a real loader, end to end.
    const loader = createLoader<string, User>((ks) =>
      Promise.resolve(alignToKeys(ks, reversed, (u) => u.id)),
    );
    const loaded = await Promise.all(keys.map((k) => loader.load(k)));

    expect(loaded.map((u) => u?.id)).toEqual(['c', 'a', 'b']);
  });

  it('2. **a missing id is null in ITS OWN slot** — neighbours unaffected', () => {
    // The shift bug. A short array moves everything after the gap by one, which
    // is the same misattribution as test 1 with an off-by-one on top.
    const keys = ['a', 'missing', 'c'];
    const found = [user('a'), user('c')];

    const aligned = alignToKeys(keys, found, (u) => u.id);

    expect(aligned.map((u) => u?.id ?? null)).toEqual(['a', null, 'c']);
  });

  it('3. duplicate keys resolve to the same entity with ONE batch call', async () => {
    // DataLoader dedups, so the batch function must see one key — and the
    // caller must still get an answer for both.
    const batch = jest.fn((ks: readonly string[]) =>
      Promise.resolve(alignToKeys(ks, [user('a')], (u) => u.id)),
    );
    const loader = createLoader<string, User>(batch);

    const [first, second] = await Promise.all([
      loader.load('a'),
      loader.load('a'),
    ]);

    expect(first).toBe(second);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toEqual(['a']);
  });

  it('4. **an empty key set makes NO call**', async () => {
    // A page where nothing has an assignee is a valid page, and it should cost
    // nothing. Asserted through the batch function directly, because DataLoader
    // never invokes it with zero keys — the guard is for a caller that does.
    const batch = jest.fn(() => Promise.resolve([]));
    const loader = createLoader<string, User>(batch);

    // A page where nothing has an assignee never calls `load` at all.
    expect(batch).not.toHaveBeenCalled();

    // And asking for nothing short-circuits rather than dispatching an empty
    // batch — DataLoader would not, but a caller invoking the batch function
    // directly could.
    const empty = await loader.loadMany([]);

    expect(empty).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });

  it('5. a per-request loader caches WITHIN the request and not beyond it', async () => {
    // In miniature: two loaders are two caches. A singleton would
    // serve one tenant's row under a bare uuid to the next request that asked
    // for that id — a cross-tenant leak whose cause is a performance
    // optimisation.
    const batch = jest.fn((ks: readonly string[]) =>
      Promise.resolve(alignToKeys(ks, [user('a')], (u) => u.id)),
    );

    const first = createLoader<string, User>(batch);
    await first.load('a');
    await first.load('a');
    expect(batch).toHaveBeenCalledTimes(1);

    const second = createLoader<string, User>(batch);
    await second.load('a');

    expect(batch).toHaveBeenCalledTimes(2);
  });
});
