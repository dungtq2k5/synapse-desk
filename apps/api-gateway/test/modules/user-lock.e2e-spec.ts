import { of } from 'rxjs';
import { faker } from '@faker-js/faker';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';

/**
 * `POST /users/:id/lock` with an expiry — 21-doc §2, tests 7 and 1.
 *
 * The service-side behaviour has its own suite against a real database. What is
 * under test here is what only exists at this layer: **the DTO validation**,
 * which is where §2.4's "a future date is required" is supposed to be enforced,
 * and the pass-through that turns an ISO string into a proto timestamp.
 */
describe('§2 Locking with an expiry, at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const targetId = faker.string.uuid();

  const admin = () =>
    authenticatedAgent(fx.app, { permissionCodes: ['user.lock'] });

  const inHours = (hours: number) =>
    new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fx.stubs.user.lockUser.mockReturnValue(of({ revokedSessionCount: 2 }));
  });

  afterAll(() => fx.close());

  it('1. **a lock with no expiry still works** — the existing product', async () => {
    // The regression guard. An indefinite lock is what an admin gets by not
    // choosing, and it must not have become harder to express.
    await admin()
      .post(`${API}/users/${targetId}/lock`)
      .send({ reason: 'Suspected compromise' })
      .expect(200);

    expect(fx.stubs.user.lockUser).toHaveBeenCalledWith(
      expect.objectContaining({ lockedUntil: undefined }),
      expect.anything(),
    );
  });

  it('2. a future expiry reaches the service as a timestamp', async () => {
    await admin()
      .post(`${API}/users/${targetId}/lock`)
      .send({ reason: 'Cooling off', lockedUntil: inHours(48) })
      .expect(200);

    const [request] = fx.stubs.user.lockUser.mock.calls[0];
    expect(request.lockedUntil?.seconds).toBeGreaterThan(Date.now() / 1000);
  });

  it('3. **a PAST expiry is rejected here, before any service is called**', async () => {
    // It would lock and unlock in the same instant — accepted by the database,
    // and incomprehensible to the admin who set it and the user who was
    // emailed about it.
    await admin()
      .post(`${API}/users/${targetId}/lock`)
      .send({ reason: 'x', lockedUntil: '2020-01-01T00:00:00.000Z' })
      .expect(400);

    expect(fx.stubs.user.lockUser).not.toHaveBeenCalled();
  });

  it('4. a malformed expiry is a 400, not a silent indefinite lock', async () => {
    // The dangerous failure: coercing an unparseable value to `undefined` would
    // turn "lock until Friday" into "lock forever" with a 200 and no warning.
    await admin()
      .post(`${API}/users/${targetId}/lock`)
      .send({ reason: 'x', lockedUntil: 'next friday' })
      .expect(400);

    expect(fx.stubs.user.lockUser).not.toHaveBeenCalled();
  });

  it('5. the reason is still required alongside an expiry', async () => {
    await admin()
      .post(`${API}/users/${targetId}/lock`)
      .send({ lockedUntil: inHours(4) })
      .expect(400);
  });

  it('6. locking still needs `user.lock`', async () => {
    const reader = authenticatedAgent(fx.app, {
      permissionCodes: ['user.read'],
    });

    await reader
      .post(`${API}/users/${targetId}/lock`)
      .send({ reason: 'x', lockedUntil: inHours(4) })
      .expect(403);
  });
});
