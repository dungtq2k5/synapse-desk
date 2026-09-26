/**
 * @file The implementation under test, as a PROCESS.
 *
 * `GATEWAY_IMPL` picks it: `node` runs the built gateway exactly as
 * `start:prod` does, `java` will run the jar. Nothing here may reach inside
 * the process — that is the whole point of this harness, and the reason the
 * existing 965 in-process tests cannot serve the Java implementation.
 *
 * Three things this file exists to get right:
 *
 * - **Ephemeral ports**, so two runs of the suite can overlap and neither
 *   collides with a developer's gateway on 3000.
 * - **Readiness by polling `/health/ready`**, never a sleep. It gates on
 *   Redis and the drain flag, so it answers with the fake peers absent.
 * - **Teardown by process GROUP.** `spawn` with `detached: true` and
 *   `kill(-pid)`, the lesson `test/system/stack.ts` records: kill the parent
 *   of a shell and the child keeps the port.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import {
  BUILD_COMMAND,
  missingOutputs,
} from '../../scripts/lib/openapi-export.cjs';

export const REPO_ROOT = join(__dirname, '../..');

/** What a started gateway answers on. */
export type Gateway = {
  /** `http://127.0.0.1:<port>` — no prefix; `client.ts` adds `/api/v1`. */
  baseUrl: string;
  metricsUrl: string;
  stop: () => Promise<void>;
};

const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 200;

/**
 * A port nothing is listening on, from the OS.
 *
 * Asked for and released, so there is a window before the gateway binds it.
 * The alternative — letting the gateway bind port 0 and reading the port back
 * — would mean parsing its log line, which is a contract this harness must not
 * depend on and which the Java implementation would not share.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * `.env.test` as the base, the harness's own values ASSIGNED over it.
 *
 * Assigned rather than loaded: `loadEnvFile` leaves a variable
 * already in the environment alone, so a developer's exported `REDIS_URL`
 * would otherwise point the gateway under test at their own Redis.
 */
export const GATEWAY_ENV = parseEnv(
  readFileSync(join(REPO_ROOT, 'apps/api-gateway/.env.test'), 'utf8'),
) as Record<string, string>;

function environmentFor(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...GATEWAY_ENV, ...overrides };
}

/** The command for the implementation under test, and what builds it. */
function commandFor(impl: string): { command: string; args: string[] } {
  if (impl === 'node') {
    return {
      command: process.execPath,
      args: [
        join(REPO_ROOT, 'apps/api-gateway/dist/apps/api-gateway/src/main.js'),
      ],
    };
  }

  if (impl === 'java') {
    return { command: 'java', args: ['-jar', javaJar()] };
  }

  throw new Error(
    `GATEWAY_IMPL=${impl} is unknown. 'node' and 'java' are the two there ` +
      'will ever be — see `GATEWAY_IMPLEMENTATIONS`.',
  );
}

/**
 * The built jar, found by glob rather than named.
 *
 * The version is in `pom.xml`; repeating it here would be a second place to
 * change it, and the failure of forgetting is a harness that cannot find a
 * jar that exists. Exactly one match is required — two jars means a stale one
 * is lying around, and picking either is a coin toss about which code runs.
 */
function javaJar(): string {
  const target = join(REPO_ROOT, 'apps/api-gateway-java/target');
  const jars = existsSync(target)
    ? readdirSync(target).filter(
        (name) => name.endsWith('.jar') && !name.endsWith('-sources.jar'),
      )
    : [];

  if (jars.length !== 1) {
    throw new Error(
      `Expected exactly one jar in apps/api-gateway-java/target, found ${jars.length}` +
        `${jars.length ? `: ${jars.join(', ')}` : ''}.\n` +
        'Build it: npm run test:contract (which builds the selected implementation).',
    );
  }

  return join(target, jars[0]);
}

/** Refuses to start against a build that does not exist. */
function assertBuilt(impl: string): void {
  // The jar's absence is checked by `javaJar()` when the command is built,
  // with the same message shape. Staleness is not checked for either
  // implementation — `run-contract-suite.mjs` builds first, which is the only
  // answer that works (absence is detectable, staleness is not).
  if (impl !== 'node') return;

  const missing = missingOutputs(REPO_ROOT);
  if (missing.length > 0) {
    throw new Error(
      `The gateway is not built:\n${missing.map((output: string) => `  ${output}`).join('\n')}\n` +
        `Build it: ${BUILD_COMMAND}`,
    );
  }
}

/**
 * Starts one gateway and waits until it reports ready.
 *
 * @param overrides environment on top of `.env.test` — the peer URLs, and
 * anything a row needs to change about the implementation under test.
 */
export async function startGateway(
  overrides: Record<string, string> = {},
): Promise<Gateway> {
  const impl = process.env.GATEWAY_IMPL ?? 'node';
  assertBuilt(impl);

  const port = await freePort();
  const metricsPort = await freePort();
  const { command, args } = commandFor(impl);

  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    // Its own process group, so `kill(-pid)` reaches whatever it spawned.
    detached: true,
    env: environmentFor({
      ...overrides,
      PORT: String(port),
      METRICS_PORT: String(metricsPort),
      METRICS_HOST: '127.0.0.1',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const gateway: Gateway = {
    baseUrl,
    metricsUrl: `http://127.0.0.1:${metricsPort}`,
    stop: () => stop(child),
  };

  await waitUntilReady(baseUrl, child, output);

  return gateway;
}

async function waitUntilReady(
  baseUrl: string,
  child: ChildProcess,
  output: string[],
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `The gateway exited with ${child.exitCode} before answering:\n${output.join('')}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  await stop(child);
  throw new Error(
    `The gateway was not ready within ${READY_TIMEOUT_MS} ms:\n${output.join('')}`,
  );
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid === undefined) {
      resolve();

      return;
    }

    child.once('exit', () => resolve());
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      resolve();
    }
  });
}
