/**
 * @file Smoke — is it up and answering?
 *
 * **Broad and shallow, and safe to point at a real deployment.** That last part
 * is the constraint that shapes everything here: no writes, no authentication,
 * no assumption that this process owns the data. A smoke test that creates a
 * user is one nobody dares run against production, and a smoke test nobody runs
 * is worth less than none.
 *
 * It shares a harness with the system journey and asserts nothing the journey
 * asserts. Merging the two would produce a suite too dangerous to point at
 * anything real and too slow to run often.
 */

import { readFileSync } from 'node:fs';
import { ops } from './client';
import { REPO_ROOT, SERVICES, targetIsLocal } from './services';
import { portsStillHeld } from './stack';
import { compareAlphabetically } from '@synapsedesk/common';

/**
 * Local-only checks skip — with the reason in the name — when `SMOKE_BASE_URL`
 * points somewhere else. A red port-probe against a remote deployment is a
 * false report that the fleet is down; a skip that says why is information.
 */
const itLocal = targetIsLocal() ? it : it.skip;

describe('Smoke', () => {
  itLocal(
    '1. **every service holds its port** (local target only)',
    async () => {
      // The cheapest possible statement of "the fleet is up", and the one that
      // does not depend on any service's own opinion of itself. A process that
      // booted, lost its bind and kept running fails here and passes a health
      // check aimed at whoever won the port.
      //
      // Spread-then-sort rather than `toSorted`: this file is now in the ROOT
      // typecheck program too, whose lib is ES2022 — where `toSorted` does not
      // exist. The spread keeps the input unmutated, which was the point.
      const held = await portsStillHeld();

      expect([...held].sort(compareAlphabetically)).toEqual(
        SERVICES.map((service) => String(service.port)).sort(
          compareAlphabetically,
        ),
      );
    },
  );

  it('2. the gateway answers liveness and readiness', async () => {
    // Both, because they are different questions and the repo treats them as
    // such: liveness gets a container restarted, readiness takes it out of
    // rotation. A check that only ever asked one would report healthy for a
    // process that is running and cannot serve.
    const live = await ops('/health');
    const ready = await ops('/health/ready');

    expect([live.status, ready.status]).toEqual([200, 200]);
  });

  it('3. **readiness does not cascade, and that is deliberate**', () => {
    // ADR 0010. A readiness probe that reported on upstreams would take the
    // whole fleet out of rotation for one slow peer, and nothing else in the
    // repository would go red if that changed.
    //
    // **Asserted against the decision record rather than the response body.**
    // The first version read `info` and required it to be non-empty, which was
    // a guess about Terminus's shape — it came back `{}` and failed a gateway
    // that was working. Stopping a service to prove non-cascading is the
    // harness checks' job; they own the right to break the stack.
    const adr = readFileSync(
      `${REPO_ROOT}/docs/decisions/0010-readiness-probes-do-not-cascade.md`,
      'utf8',
    );

    expect(adr).toMatch(/readiness/i);
    // The one HTTP probe in the table is the gateway's, which is the shape of
    // the decision: every other service answers for itself on its own port.
    expect(
      SERVICES.filter((service) => service.probe.kind === 'http').map(
        (service) => service.port,
      ),
    ).toEqual([3000]);
  });

  it('4. `/version` answers outside the API prefix', async () => {
    // `OPS_ROUTES` is excluded from `setGlobalPrefix`, so these three live at
    // the root. Getting that wrong produces a smoke test that reports the
    // deployment down when it is up — which is the one failure mode a smoke
    // test must not have.
    const version = await ops('/version');

    expect(version.status).toBe(200);
  });
});
