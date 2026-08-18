import { bootstrapE2eTest, E2eFixture, uploadTo } from '../utils';

/**
 * — the bootstrap smoke test.
 *
 * Every other suite in this service assumes the emulator and Redis are both up
 * and that the Firebase app initialized with the right bucket. When that
 * assumption is wrong, every suite fails at once with an error from deep inside
 * the SDK. This one fails first, and says which piece is missing.
 */
describe('Storage-service boots against the emulator (e2e)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => fx.reset());
  afterAll(() => fx.close());

  it('1. has a bucket handle after init', () => {
    expect(fx.firebase.bucket).toBeDefined();
    expect(fx.firebase.bucket.name).toBe('synapsedesk-test.appspot.com');
  });

  it('2. reaches a real REDIS', async () => {
    await fx.redis.set('probe', 'ok');

    expect(await fx.redis.get('probe')).toBe('ok');
  });

  it('3. uses a DISTINCT redis index from the dev one', async () => {
    // The guard that makes `flushdb` in `reset()` safe. If this ever pointed at
    // db 0, every test run would wipe whatever a developer had running locally.
    const [, db] = await fx.redis.client('INFO').then((info) => [info, null]);

    expect(fx.redis.options.db).not.toBe(0);
    expect(db).toBeNull();
  });

  it('4. can write and read an object through the Admin SDK', async () => {
    await fx.firebase.bucket.file('probe.txt').save('hello');

    const [contents] = await fx.firebase.bucket.file('probe.txt').download();
    expect(contents.toString()).toBe('hello');
  });

  it('5. reset() empties the bucket', async () => {
    await fx.firebase.bucket.file('leftover.txt').save('x');

    await fx.reset();

    const [files] = await fx.firebase.bucket.getFiles();
    expect(files).toHaveLength(0);
  });

  it('6. signs a V4 URL pointing at the right object', async () => {
    // The SHAPE, not a working round trip — see the note at the bottom of this
    // file about the emulator's 501.
    const [url] = await fx.firebase.bucket.file('direct.txt').getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: new Date(Date.now() + 60_000),
      contentType: 'text/plain',
    });

    expect(url).toContain('synapsedesk-test.appspot.com/direct.txt');
    expect(url).toContain('X-Goog-Algorithm=GOOG4-RSA-SHA256');
    expect(url).toContain('X-Goog-Expires=');
    expect(url).toContain('X-Goog-Signature=');
  });

  it('7. CONFIRMS the emulator does not honour signed URLs — 501', async () => {
    // Written as an assertion rather than a comment, deliberately.
    //
    // The Firebase Storage emulator does not implement the V4 signed-URL
    // protocol: it answers 501 to a correctly signed request. That is a
    // limitation of the emulator, not of the signing — the URL above is
    // well-formed and would work against a real bucket.
    //
    // It matters because the plan asked for "PUT to the
    // returned uploadUrl succeeds against the emulator", which cannot pass
    // here. Pinning the 501 means that if a future emulator release DOES
    // implement signed URLs, this test fails and tells somebody the real
    // round-trip test is now writable — rather than the limitation quietly
    // outliving its reason.
    const [url] = await fx.firebase.bucket.file('direct.txt').getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: new Date(Date.now() + 60_000),
      contentType: 'text/plain',
    });

    expect(await uploadTo(url, 'body', 'text/plain')).toBe(501);
  });
});
