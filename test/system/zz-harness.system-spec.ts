/**
 * @file Guarding the harness itself.
 *
 * **A system test that silently tests nothing is worse than none**, and this
 * repository has found that shape repeatedly — a scan matching zero files, a
 * spy restored before the assertion, a fixture at values where two formulas
 * agree. A harness that spawned no processes and asserted against something
 * in-process would look identical to a working one from the outside.
 *
 * **`zz-` so it sorts last**, and `sequencer.cjs` is what makes that true.
 * Check 1 stops a service on purpose, and every file after it would fail for a
 * reason that is not its own. Jest's DEFAULT sequencer sorts by file size, so
 * the prefix expressed the intent and enforced nothing — measured: this file
 * ran first and the smoke test then failed on a port this suite had freed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@synapsedesk/common/testing/strip-comments';
import { Session, expectOk } from './client';
import { DEMO_PASSWORD, seededActors } from './seeded-actor';
import { notificationDb } from './db';
import { REPO_ROOT, SERVICES } from './services';
import { probeReady, stopService } from './stack';

const NOTIFICATION_PKG = '@synapsedesk/notification-service';

describe('The harness', () => {
  it('1. **the journey goes red when notification-service is stopped**', async () => {
    // **The sabotage that matters.** If the journey stays green with the
    // consumer stopped, the harness is not exercising the boundary it was built
    // for — which is exactly how four defects survived a full green suite.
    //
    // Written as a test rather than left to a person because a sabotage nobody
    // re-runs is a claim, not a check.
    const session = new Session();
    const notifications = notificationDb();
    const run = Date.now().toString(36);

    try {
      // **The seeded admin, not a registration** — a fresh registrant has no
      // `ticket.create`, so this check would have failed on a 403 and looked
      // like the boundary was broken when nothing was.
      const actors = await seededActors();
      const login = expectOk(
        await session.post<{ user: { id: string } }>('/auth/login', {
          email: actors.admin.email,
          password: DEMO_PASSWORD,
        }),
        'login as the seeded admin',
      );
      expect(login.user.id).toBe(actors.admin.id);

      const ticket = expectOk(
        await session.post<{ id: string }>('/tickets', {
          title: `Harness check ${run}`,
          description: 'Assigned with the consumer stopped, on purpose.',
        }),
        'POST /tickets',
      );

      const before = await notifications.notificationDelivery.count();

      // **Stopped AFTER the ticket exists**, so the arrangement does not depend
      // on ticket-service noticing. What is being removed is the far end of one
      // boundary and nothing else.
      await stopService(NOTIFICATION_PKG);

      const [department] = expectOk(
        await session.get<{ items: { id: string }[] }>('/departments'),
        'GET /departments',
      ).items;

      // Somebody other than the actor, for the reason the journey's step 6
      // gives: the audience filter never notifies you of your own action, so a
      // self-assignment would produce no row whether or not the consumer was
      // running — and this check would pass with nothing stopped.
      expectOk(
        await session.post(`/tickets/${ticket.id}/assign`, {
          assigneeId: actors.colleague.id,
          departmentId: department.id,
        }),
        'POST /tickets/:id/assign',
      );

      // A generous window, then the assertion the journey makes — inverted.
      //
      // **The publish DOES succeed — into nothing.** `ticket.assigned` is core
      // NATS, not one of the four `DURABLE_SUBJECTS`, so with the consumer
      // stopped the message is discarded rather than queued: this check is
      // destructive to that notification, permanently. It also means an
      // unchanged count here is what a broken PRODUCER looks like too — so
      // this check means something only as HALF OF A PAIR with the journey's
      // step 6, which proves the row appears when everything runs. Neither
      // alone says much; together they are what §9 wanted.
      await new Promise((resolve) => setTimeout(resolve, 8_000));

      await expect(notifications.notificationDelivery.count()).resolves.toBe(
        before,
      );
    } finally {
      await notifications.$disconnect();
    }
  }, 120_000);

  it('2. **teardown is reachable, and it is the only thing that owns these PIDs**', () => {
    // Check 2's real assertion — no listening ports and no BullMQ repeat keys
    // after teardown — cannot run inside the suite it is about, because
    // `globalTeardown` has not happened yet. What this pins instead is the
    // property that makes teardown correct: every service is spawned by this
    // harness and reaped by PID, so nothing here ever reaches for a pattern.
    //
    // The pattern version is what the sabotage log has two entries about:
    // `pkill -f node` on a developer machine kills their editor's language
    // server.
    // **Comments stripped, and that is not tidiness.** The docblock at the top
    // of `stack.ts` says "Never `pkill -f node`" — so the first version of this
    // check matched its own file's prose and failed on a file that is correct.
    // Through the SHARED strip, because this file's own copy regressed the
    // character class within a week of `cors-contract` writing the safe one —
    // the measurement lives on `stripComments`.
    const stack = stripComments(readFileSync(`${__dirname}/stack.ts`, 'utf8'));

    expect(stack).not.toMatch(/pkill/);
    // The PROPERTY — a negated pid, the group-kill — not the parameter's name:
    // pinned as `\(-pid`, a rename would have turned this red for a correct
    // change, which is the `toBe(366)` shape one size down.
    expect(stack).toMatch(/process\.kill\(\s*-/);
    // The reapers cover the paths a `finally` does not: a `finally` is only a
    // guarantee while the harness's own process survives.
    expect(stack).toMatch(/SIGINT/);
    expect(stack).toMatch(/uncaughtException/);
  });

  it('3. **readiness is not vacuous** — it says NO for a dead port', async () => {
    // **Measured, not assumed.** The first real run reported the whole fleet
    // ready in 1.8 seconds, which is fast enough to be worth disproving: a
    // readiness check that answered `true` unconditionally would make
    // `startStack` return immediately and every later failure land somewhere
    // that has nothing to do with the cause.
    //
    // Both probe kinds, because they fail differently — the HTTP one on a
    // refused connection, the gRPC one on a deadline — and a control that only
    // covered one would leave the other free to lie.
    await expect(
      probeReady({
        pkg: 'nobody',
        dir: '.',
        port: 5099,
        probe: { kind: 'grpc' },
      }),
    ).resolves.toBe(false);

    await expect(
      probeReady({
        pkg: 'nobody',
        dir: '.',
        port: 5099,
        probe: { kind: 'http', path: '/health/ready' },
      }),
    ).resolves.toBe(false);
  }, 60_000);

  it('4. **the stack table is the only list of services**', () => {
    // A second list is how a readiness poll ends up waiting on a service nobody
    // started — or worse, not waiting on one that was. One table, distinct
    // ports, and a floor DERIVED rather than pinned.
    //
    // It was `toHaveLength(7)` — the same `toBe(366)` shape struck from
    // `finance.e2e-spec.ts`: an eighth service turns a literal red for a
    // correct change and the repair is to edit the number. A service is in the
    // stack iff it can be launched, and `start:prod` is the launch line — so
    // the scripts are the independent source, and a service added with one and
    // not the other fails here in whichever direction it was forgotten.
    const ports = SERVICES.map((service) => service.port);

    const launchable = readdirSync(join(REPO_ROOT, 'apps')).filter((app) => {
      try {
        const pkg = JSON.parse(
          readFileSync(join(REPO_ROOT, 'apps', app, 'package.json'), 'utf8'),
        ) as { scripts?: Record<string, string> };

        return Boolean(pkg.scripts?.['start:prod']);
      } catch {
        return false;
      }
    });

    expect(launchable.length).toBeGreaterThanOrEqual(7);
    expect(SERVICES).toHaveLength(launchable.length);
    expect(new Set(ports).size).toBe(ports.length);
    // Exactly one HTTP probe: the gateway is the only service that binds a
    // port an HTTP client can reach.
    expect(
      SERVICES.filter((service) => service.probe.kind === 'http'),
    ).toHaveLength(1);
  });
});
