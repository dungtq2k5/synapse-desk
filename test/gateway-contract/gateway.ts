/**
 * @file The gateway under test, as a PROCESS.
 *
 * It runs the built gateway exactly as `start:prod` does. Nothing here may reach
 * inside the process — that is the whole point of this harness.
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
import { createWriteStream, readFileSync } from 'node:fs';
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
const LAUNCH_ATTEMPTS = 3;

/** What the gateway prints when a port it was given is already taken. */
const PORT_TAKEN = /EADDRINUSE/u;

/** A launch that failed only because a port was taken in the window `freePort` leaves. */
class PortTaken extends Error {
  constructor(
    message: string,
    /** Everything the failed launch printed, kept so a retry does not lose the evidence. */
    readonly output: string,
  ) {
    super(message);
  }
}
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 2_000;

/**
 * Where a SHARD's ports come from: its own block of 1000, below the OS's ephemeral range
 * (32768 and up on Linux), so two shards running at once can never be handed the same
 * port and neither can an outgoing connection. Without it, two shards each asked the OS
 * for a free port, released it, and could both be given it: one gateway bound it, and the
 * other shard's harness then polled it and could take the OTHER shard's gateway for its
 * own. Set by `scripts/run-contract-suite.mjs` for each shard (`CONTRACT_SHARD=k`).
 */
const SHARD = Number(process.env.CONTRACT_SHARD ?? 0);
const SHARD_PORT_BASE = 20_000 + (SHARD - 1) * 1_000;
// A random start, so consecutive runs do not hand out the ports the last one just
// closed: a port still in TIME_WAIT passes the free-port probe (which binds with
// address reuse) and then fails a listener that binds without it.
let shardPortCursor = Math.floor(Math.random() * 1_000);

/** Whether nothing is listening on `port` now. */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * A port nothing is listening on, from the OS.
 *
 * Asked for and released, so there is a window before the gateway binds it.
 * The alternative — letting the gateway bind port 0 and reading the port back
 * — would mean parsing its log line, which is a contract this harness must not
 * depend on.
 */
async function freePort(): Promise<number> {
  if (SHARD > 0) {
    // Never the same port twice in one invocation, and the next free one in the block.
    for (let tried = 0; tried < 1_000; tried += 1) {
      const port = SHARD_PORT_BASE + (shardPortCursor++ % 1_000);
      if (await isFree(port)) return port;
    }
    throw new Error(
      `No free port in shard ${SHARD}'s block from ${SHARD_PORT_BASE}`,
    );
  }

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
 * `gateway.env`, the harness's own file, as the base, and the per-launch values
 * ASSIGNED over it.
 *
 * Assigned rather than loaded: `loadEnvFile` leaves a variable
 * already in the environment alone, so a developer's exported `REDIS_URL`
 * would otherwise point the gateway under test at their own Redis.
 */
export const GATEWAY_ENV = parseEnv(
  readFileSync(join(REPO_ROOT, 'test/gateway-contract/gateway.env'), 'utf8'),
) as Record<string, string>;

function environmentFor(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...GATEWAY_ENV, ...overrides };
}

/** The built gateway, started exactly as `start:prod` starts it. */
const COMMAND = {
  command: process.execPath,
  args: [
    join(
      REPO_ROOT,
      'services/api-gateway/dist/services/api-gateway/src/main.js',
    ),
  ],
};

/** Refuses to start against a build that does not exist. */
function assertBuilt(): void {
  // Staleness is not checked — `run-contract-suite.mjs` builds first, which is
  // the only answer that works (absence is detectable, staleness is not).
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
 * @param overrides environment on top of `gateway.env` — the peer URLs, and
 * anything a row needs to change about the gateway under test.
 */
export async function startGateway(
  overrides: Record<string, string> = {},
): Promise<Gateway> {
  assertBuilt();

  // A port is asked for and released, so another process can take it before the
  // gateway binds it (see `freePort`). Rare when one suite runs alone, routine when
  // several run at once, and the gateway then never becomes ready. So a launch that
  // fails to BIND is retried with fresh ports; any other failure is not.
  for (let attempt = 1; ; attempt += 1) {
    const port = await freePort();
    const metricsPort = await freePort();
    const child = spawn(COMMAND.command, COMMAND.args, {
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
    // Every launch's whole output, to a file, when the runner names a directory: a
    // gateway that started "fine" and then misbehaved (a listener that never bound)
    // otherwise leaves nothing to read, since its output is printed only on failure.
    const log = process.env.CONTRACT_LOG_DIR
      ? createWriteStream(
          join(process.env.CONTRACT_LOG_DIR, `gateway-${port}.log`),
        )
      : undefined;
    const keep = (chunk: Buffer) => {
      output.push(chunk.toString());
      log?.write(chunk);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.once('exit', () => log?.end());

    const baseUrl = `http://127.0.0.1:${port}`;
    const gateway: Gateway = {
      baseUrl,
      metricsUrl: `http://127.0.0.1:${metricsPort}`,
      stop: () => stop(child),
    };

    try {
      await waitUntilReady(baseUrl, child, output);

      return gateway;
    } catch (failure) {
      if (failure instanceof PortTaken && attempt < LAUNCH_ATTEMPTS) {
        // Said out loud, so a run's log shows how often the window bites, instead of
        // the retry absorbing it unseen.
        process.stderr.write(
          `gateway launch ${attempt}/${LAUNCH_ATTEMPTS}: a port was taken before the gateway bound it (ports ${port}, ${metricsPort}; the gateway said: ${failure.message}); retrying with fresh ports\n` +
            // The whole launch, indented: rare, and the only record of what collided.
            failure.output.replace(/^/gmu, '    | ') +
            '\n',
        );
        continue;
      }
      throw failure;
    }
  }
}

async function waitUntilReady(
  baseUrl: string,
  child: ChildProcess,
  output: string[],
): Promise<void> {
  const path = '/health/ready';
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (PORT_TAKEN.test(output.join(''))) {
      await stop(child);
      const said =
        output
          .join('')
          .split('\n')
          .find((line) => PORT_TAKEN.test(line)) ?? '';
      throw new PortTaken(said.trim(), output.join(''));
    }
    if (child.exitCode !== null) {
      throw new Error(
        `The gateway exited with ${child.exitCode} before answering:\n${output.join('')}`,
      );
    }

    try {
      // Bounded, or a port held by something that accepts and never answers hangs the
      // poll past its own deadline (measured: the launch was then never retried).
      const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  await stop(child);
  throw new Error(
    `The gateway did not answer ${path} within ${READY_TIMEOUT_MS} ms:\n${output.join('')}`,
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
