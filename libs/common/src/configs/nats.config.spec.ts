import { assertDurableStore } from './nats.config';

/**
 * The check that keeps `-sd /data` from silently regressing.
 *
 * Worth unit-testing rather than trusting to a boot that "works on my machine":
 * the failure it guards is invisible until a container is recreated, which is
 * the one moment nobody is watching the logs.
 */
describe('assertDurableStore', () => {
  const varz = (body: unknown, ok = true) =>
    jest.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 503,
      json: () => Promise.resolve(body),
    });

  afterEach(() => {
    // @ts-expect-error — restoring the global we replaced per test.
    delete global.fetch;
  });

  it('1. accepts a store on a mounted volume', async () => {
    global.fetch = varz({
      jetstream: { config: { store_dir: '/data/jetstream' } },
    });

    await expect(
      assertDurableStore('http://nats:8222'),
    ).resolves.toBeUndefined();
  });

  it('2. **REFUSES a /tmp store, naming the flag that fixes it**', async () => {
    // The default, and the whole reason this function exists. An operator
    // reading this message should not have to find the doc.
    global.fetch = varz({
      jetstream: { config: { store_dir: '/tmp/nats/jetstream' } },
    });

    await expect(assertDurableStore('http://nats:8222')).rejects.toThrow(
      /-sd \/data/,
    );
  });

  it('3. **refuses a broker with no JetStream at all**', async () => {
    // `-js` missing entirely. Every publish falls back to core silently, which
    // is indistinguishable from success at the publisher.
    global.fetch = varz({ server_id: 'NABC' });

    await expect(assertDurableStore('http://nats:8222')).rejects.toThrow(
      /not running with -js/,
    );
  });

  it('4. refuses when the monitoring port cannot be read', async () => {
    // Not "assume it is fine": an unreadable broker is an unverified one, and
    // the whole point is to not start against an unverified store.
    global.fetch = varz({}, false);

    await expect(assertDurableStore('http://nats:8222')).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it('5. tolerates a trailing slash on the URL', async () => {
    const fetchMock = varz({
      jetstream: { config: { store_dir: '/data/jetstream' } },
    });
    global.fetch = fetchMock;

    await assertDurableStore('http://nats:8222/');

    expect(fetchMock).toHaveBeenCalledWith('http://nats:8222/varz');
  });
});
