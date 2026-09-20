/**
 * @file What `globalSetup` started, readable by every worker and by teardown.
 *
 * **Three module registries, one run.** `globalSetup`, each test worker and
 * `globalTeardown` do not share memory, so anything setup starts has to be
 * written down — the same reason `test/system/stack.ts` keeps a PID table.
 *
 * **A path per run, not a fixed one**, which is where this differs from that
 * table. Two invocations of this suite must be able to overlap (§9's row that
 * has to stay green), and a fixed file would make the second one adopt the
 * first one's containers and then remove them. The path travels in
 * `GATEWAY_CONTRACT_RUN`, set in `globalSetup` before any worker is forked.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Everything one run started, by the address a test needs to reach it. */
export type RunState = {
  /** Container ids, so teardown removes exactly what this run created. */
  containers: string[];
  redisUrl: string;
  natsUrl: string;
};

const ENV_KEY = 'GATEWAY_CONTRACT_RUN';

/** Creates this run's state file and publishes its path to the workers. */
export function createRunState(state: RunState): string {
  const path = join(
    mkdtempSync(join(tmpdir(), 'gateway-contract-')),
    'run.json',
  );

  writeFileSync(path, JSON.stringify(state));
  process.env[ENV_KEY] = path;

  return path;
}

/** This run's state, or a failure naming the variable that should carry it. */
export function readRunState(): RunState {
  const path = process.env[ENV_KEY];
  if (!path) {
    throw new Error(
      `${ENV_KEY} is unset — the harness reads it in globalSetup, so a spec ` +
        'run outside `npm run test:contract` has no infrastructure to reach.',
    );
  }

  return JSON.parse(readFileSync(path, 'utf8')) as RunState;
}

/** Writes an updated state — used as the run learns what it started. */
export function updateRunState(state: RunState): void {
  writeFileSync(process.env[ENV_KEY] as string, JSON.stringify(state));
}

export function removeRunState(): void {
  const path = process.env[ENV_KEY];
  if (path) rmSync(join(path, '..'), { recursive: true, force: true });
}
