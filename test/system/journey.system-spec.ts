/**
 * @file The journey — the only tests in this repository where two real services
 * talk to each other.
 *
 * Every step here crosses a boundary. A step that exercises one service is
 * already covered 3,242 times over, and repeating it here buys a slower copy
 * that fails for more reasons.
 *
 * **Step 6 first, and the reason constrains how it is written.**
 * `audit-consumer.e2e-spec` and `delete-consumer.e2e-spec` already cross a real
 * broker — with a HAND-ROLLED publisher: the suite constructs the message and
 * puts it on the subject. So the transport is covered and the producer is not.
 * If this file constructed the assignment event it would reproduce coverage
 * that exists. It assigns a ticket through the API and lets `ticket-service`
 * publish, and asserts the row `notification-service` writes at the far end.
 *
 * **Steps 4, 5 and 8 are not here.** They need a funded `GEMINI_API_KEY` and
 * network — see `ai.system-spec.ts`. Keeping them out is what makes a red run
 * mean "a boundary is broken" rather than "somebody's key expired".
 */

import { randomUUID } from 'node:crypto';
import { Session, expectOk } from './client';
import { DEMO_PASSWORD, seededActors, type Actor } from './seeded-actor';
import { notificationDb } from './db';

/** Distinguishes this run's rows from the seeded ones. */
const RUN = randomUUID().slice(0, 8);

/** A fresh registration, for step 1 only — see `seeded-actor.ts` for why. */
const NEWCOMER_EMAIL = `newcomer-${RUN}@system-test.local`;
const NEWCOMER_PASSWORD = 'SystemTest1!';

/** How long a cross-service effect has to appear before it is a failure. */
const CROSS_SERVICE_TIMEOUT_MS = 60_000;

type Identified = { id: string };

describe('The journey', () => {
  const owner = new Session();
  const notifications = notificationDb();

  let ticketId: string;
  let ownerId: string;
  /** Who step 6 assigns to — step 7 reads THEIR feed. */
  let assignee: Actor;

  afterAll(async () => {
    await notifications.$disconnect();
  });

  // ------------------------------------------------------------------ 1

  it('1. **register and log in** — gateway to auth, and the cookie', async () => {
    // A FRESH registration, driven to completion and then set aside. The cookie
    // is the point rather than the 201: it is `HttpOnly`, and a bearer token
    // would exercise the fallback path instead of the one a browser takes.
    //
    // **Nothing later acts as this user**, because registration is deliberately
    // limited — every write it attempts comes back
    // `403 Requires one of: ticket.create`, which is the product working as
    // designed and the wrong actor for a journey about what the product does.
    const newcomer = new Session();

    expectOk(
      await newcomer.post<{ user: Identified }>('/auth/register', {
        email: NEWCOMER_EMAIL,
        password: NEWCOMER_PASSWORD,
        fullName: `Newcomer ${RUN}`,
      }),
      'register',
    );

    const loggedIn = expectOk(
      await newcomer.post<{ user: Identified }>('/auth/login', {
        email: NEWCOMER_EMAIL,
        password: NEWCOMER_PASSWORD,
      }),
      'login',
    );

    expect(
      newcomer.lastSetCookie.some((cookie) => /httponly/i.test(cookie)),
    ).toBe(true);
    expect(loggedIn.user.id).toEqual(expect.any(String));
  });

  it('1a. **log in as the SEEDED admin** — the actor for everything after', async () => {
    // Read from `.demo-seed/manifest.json` rather than guessed: the seeder's
    // slugs are random, and a hard-coded address would be a fixture that
    // silently stops matching the dataset it is supposed to describe.
    const actors = await seededActors();
    assignee = actors.colleague;

    const loggedIn = expectOk(
      await owner.post<{ user: Identified }>('/auth/login', {
        email: actors.admin.email,
        password: DEMO_PASSWORD,
      }),
      `login as the seeded admin ${actors.admin.email}`,
    );

    ownerId = loggedIn.user.id;
    expect(ownerId).toBe(actors.admin.id);
  });

  it('2. the session is usable on a route that needs one', async () => {
    // Proves the cookie the gateway set is one the gateway accepts — two
    // directions through the same guard, which no single-service suite can
    // check because it mints its own context.
    // `/users/me` returns `{ user, permissionCodes }` — not a bare user. The
    // first draft read `data.id` and got `undefined` beside a 200, which is the
    // shape a response DTO change would take.
    const me = expectOk(
      await owner.get<{ user: Identified; permissionCodes: string[] }>(
        '/users/me',
      ),
      'GET /users/me',
    );

    expect(me.user.id).toBe(ownerId);
    expect(me.permissionCodes.length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------ 3

  it('3. **create a ticket** — gateway to ticket, and an audit publish', async () => {
    const created = await owner.post<Identified & { title: string }>(
      '/tickets',
      {
        title: `System test ${RUN}`,
        description:
          'Created by the system harness to cross a service boundary.',
      },
    );

    expect(created.status).toBe(201);
    ticketId = created.body.data.id;
    expect(ticketId).toEqual(expect.any(String));

    // Read it back through the same boundary. A create that returns an id and
    // a read that cannot find it is the shape a transaction boundary bug takes,
    // and it is invisible to a suite that mocks the far side.
    const read = await owner.get<Identified>(`/tickets/${ticketId}`);
    expect([read.status, read.body.data.id]).toEqual([200, ticketId]);
  });

  // ------------------------------------------------------------------ 6

  it('6. **assign it, and a delivery row appears in notification-service**', async () => {
    // **The step this file exists for.** `ticket-service` publishes, NATS
    // carries, `notification-service` consumes and writes — three processes,
    // none of them mocked, and the assertion is a row rather than a spy.
    //
    // **`departmentId` is required, not inferred**, and the DTO says why:
    // inferring it from the assignee's primary department would put the ticket
    // wherever that agent happens to sit.
    //
    // **Assigned to SOMEBODY ELSE, and that is load-bearing.** The consumer's
    // audience filter says *"Never notify the actor"*, so a self-assignment
    // publishes correctly, consumes correctly and writes no row. The first
    // version did exactly that and failed for thirty seconds against a system
    // that was working.
    //
    // **Retried on a FRESH ticket, and the reason is a finding.**
    // `ticket.assigned` is a CORE NATS subject — the JetStream streams carry
    // `audit.record` and `notification.>`, not ticket events — so it has no
    // persistence: an event published before the subscriber attaches is gone,
    // not queued. And `grpc.health.v1` reports SERVING as soon as the gRPC
    // server answers, which is earlier than the NATS subscription. Measured:
    // the same journey passed one run and timed out the next with no code
    // change between them.
    //
    // A retry is the honest fix at this layer. A `sleep` would be a guess, and
    // re-assigning the SAME ticket is refused with `ALREADY_EXISTS` — by
    // design, so a second identical assignment cannot fire an event about a
    // change that did not happen.
    const [department] = expectOk(
      await owner.get<{ items: Identified[] }>('/departments'),
      'GET /departments',
    ).items;

    expect(department?.id).toEqual(expect.any(String));

    const deadline = Date.now() + CROSS_SERVICE_TIMEOUT_MS;
    let attempts = 0;
    let delivered = false;

    while (!delivered && Date.now() < deadline) {
      attempts += 1;
      const before = await notifications.notificationDelivery.count();

      ticketId = expectOk(
        await owner.post<Identified>('/tickets', {
          title: `System test ${RUN} attempt ${attempts}`,
          description: 'Assigned to cross ticket -> NATS -> notification.',
        }),
        'POST /tickets',
      ).id;

      expectOk(
        await owner.post(`/tickets/${ticketId}/assign`, {
          assigneeId: assignee.id,
          departmentId: department.id,
        }),
        'POST /tickets/:id/assign',
      );

      const until = Math.min(Date.now() + 10_000, deadline);
      while (!delivered && Date.now() < until) {
        delivered = (await notifications.notificationDelivery.count()) > before;
        if (!delivered) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }

    if (!delivered) {
      throw new Error(
        `No notification_deliveries row appeared after ${attempts} assignment(s) in ` +
          `${CROSS_SERVICE_TIMEOUT_MS}ms. ticket-service published or it did not; ` +
          'notification-service consumed or it did not — check both logs.',
      );
    }

    expect(delivered).toBe(true);
  });

  // ------------------------------------------------------------------ 7

  it('7. **the ASSIGNEE reads it in their feed** — gateway to notification', async () => {
    // The far end of step 6, read back through the gateway by the person it was
    // written for. Step 6 proves the row exists; this proves it is reachable —
    // a different service and a different boundary.
    //
    // **As the assignee, not the actor.** Reading the owner's feed would assert
    // the absence the audience filter guarantees, which is a test that passes
    // for the wrong reason and fails the moment somebody "fixes" the filter.
    const assigneeSession = new Session();
    expectOk(
      await assigneeSession.post<{ user: Identified }>('/auth/login', {
        email: assignee.email,
        password: DEMO_PASSWORD,
      }),
      'login as the assignee',
    );

    const feed = await waitFor(
      async () => {
        const response = await assigneeSession.get<{ items: unknown[] }>(
          '/notifications',
        );

        return response.body.data?.items?.length ? response.body.data : null;
      },
      () => 'The assignee feed stayed empty after a delivery row was written',
    );

    expect(feed.items.length).toBeGreaterThan(0);

    const count = expectOk(
      await assigneeSession.get<{ count: number }>(
        '/notifications/unread-count',
      ),
      'GET /notifications/unread-count',
    );

    expect(count.count).toBeGreaterThan(0);
  });

  /**
   * Polls until `produce` returns something, then returns it.
   *
   * **A deadline, never a sleep.** A fixed wait is either too short on a busy
   * laptop running seven node processes or too slow every other time, and its
   * failure says nothing. This one reports what it was waiting for.
   */
  async function waitFor<T>(
    produce: () => Promise<T | null>,
    onTimeout: () => string,
  ): Promise<T> {
    const deadline = Date.now() + CROSS_SERVICE_TIMEOUT_MS;

    for (;;) {
      const value = await produce();
      if (value !== null) return value;
      if (Date.now() > deadline) throw new Error(onTimeout());

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
});
