/**
 * @file The one failure of `startStack` that matters: the timeout path reaps.
 *
 * **This is `.spec.ts`, not `.system-spec.ts`, and the difference is where it
 * can run.** Every system spec executes with the fleet up and every port held —
 * a second `startStack` there fails on the port check, correctly. This test
 * needs the stack DOWN, spawns one fake service of its own, and runs under
 * `jest.unit.config.ts`, which has no `globalSetup`.
 *
 * **Why it exists at all**: `globalSetup` once guarded only what came after
 * `startStack()` — under a comment claiming "everything after the spawn" was
 * covered, which was inverted: `startStack` IS the spawn, and its readiness
 * timeout is the harness's single most likely failure. Measured twice before
 * any guard existed: seven services left running, every port held, and the
 * NEXT run failing on a port check with no indication of what had started
 * them.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';

// **Set before the import**, because `stack.ts` reads it at module load. The
// default PID file is deliberately at a fixed path so a killed run is findable
// by the next one — which is exactly what would let this test clobber a real
// harness run happening in another terminal.
const PID_FILE = join(tmpdir(), `synapsedesk-stack-spec-${process.pid}.json`);
process.env.SYNAPSEDESK_SYSTEM_PID_FILE = PID_FILE;

// The import COMES AFTER the env assignment above, and must: `stack.ts` reads
// the variable at module load. A formatter hoisting this to the top is the
// exact bug this placement prevents.
import { startStack } from './stack';

describe('startStack on the readiness-timeout path', () => {
  afterEach(() => rmSync(PID_FILE, { force: true }));

  it('**reaps what it spawned, and leaves no PID table**', async () => {
    // One fake service: spawns fine (`sleep`), never becomes ready. A
    // two-second deadline rather than the real 120 — injected, because a test
    // that waits two minutes is a test nobody keeps, and a test against a
    // copied `startStack` with a shorter constant guards the copy.
    await expect(
      startStack({
        services: [
          {
            pkg: 'fake-service',
            dir: '.',
            port: 59_871,
            probe: { kind: 'http', path: '/never' },
            command: ['sleep', ['30']],
          },
        ],
        readyTimeoutMs: 2_000,
      }),
    ).rejects.toThrow(/fake-service never answered on 59871/);

    // The property: the failure cleaned up after itself. An empty or absent
    // table means the `sleep` was killed and nothing is left for
    // `reapPreviousRun` to find — the run that caused the mess is the run
    // that cleared it.
    expect(existsSync(PID_FILE)).toBe(false);
  }, 30_000);

  it('**a service that cannot spawn fails NOW, by name** — not as a timeout', async () => {
    // `child.pid === undefined` means the spawn itself failed — no process
    // exists, so nothing leaks. What silently continuing cost instead: a hole
    // in the PID table and two minutes of polling a port nothing was ever
    // going to bind, reported as "never answered on 59872" with an empty
    // output tail — blaming a service that was never started.
    await expect(
      startStack({
        services: [
          {
            pkg: 'unspawnable-service',
            dir: '.',
            port: 59_872,
            probe: { kind: 'http', path: '/never' },
            command: ['definitely-not-a-binary-x91', []],
          },
        ],
        readyTimeoutMs: 2_000,
      }),
    ).rejects.toThrow(/unspawnable-service did not spawn at all/);
  }, 30_000);
});
