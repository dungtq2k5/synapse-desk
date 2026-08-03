import { of } from 'rxjs';
import {
  bootstrapE2eTest,
  E2eFixture,
  flushTestRedis,
} from './utils/bootstrap';
import { anonymousAgent, API, authenticatedAgent } from './utils/auth';
import { wireUser } from './fixtures/wire';

/**
 * Proves the e2e fixture itself, before any suite depends on it.
 *
 * Each assertion below is a precondition that, when broken, produces a
 * misleading failure elsewhere: a 401 everywhere (wrong keypair), a 404
 * everywhere (missing global prefix), or an unwrapped body (interceptors not
 * mirrored from main.ts).
 */
describe('e2e bootstrap', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  afterAll(() => fx.close());

  it('verifies a token signed by the TEST keypair', async () => {
    // The stub stands in for auth-service; what is under test is the guard
    // chain in front of it, not the RPC.
    fx.stubs.user.getCurrentUser.mockReturnValue(
      of({ user: wireUser(), permissionCodes: [], departmentIds: [] }),
    );

    const res = await authenticatedAgent(fx.app).get(`${API}/users/me`);

    // Anything but 401 proves the signature verified. The route's own
    // behaviour is §4.1's business.
    expect(res.status).not.toBe(401);
  });

  it('rejects a request with no cookie', async () => {
    const res = await anonymousAgent(fx.app).get(`${API}/users/me`);
    expect(res.status).toBe(401);
  });

  it('wraps failures in the error envelope', async () => {
    const res = await anonymousAgent(fx.app).get(`${API}/users/me`);

    expect(res.body).toMatchObject({
      success: false,
      statusCode: 401,
      path: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('mounts routes under the configured global prefix', async () => {
    const unprefixed = await anonymousAgent(fx.app).get('/users/me');
    expect(unprefixed.status).toBe(404);
  });

  it('never dials a real auth-service', () => {
    // AUTH_SERVICE_URL in .env.test points at a closed port on purpose: if the
    // override ever stops applying, the symptom must be an immediate connection
    // failure, not a silent success against somebody's dev instance.
    expect(process.env.AUTH_SERVICE_URL).toContain('59999');
  });
});
