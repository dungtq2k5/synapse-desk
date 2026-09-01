/**
 * @file Starting seven processes, and — the part that matters — reaping them.
 *
 * **Teardown is the design centre.** A harness that spawns a fleet and reaps it
 * unreliably poisons every later run on the machine, and the symptom appears
 * somewhere else entirely: known-gap #7 is seven sightings of leftover BullMQ
 * schedules failing an unrelated service's suite, and #14 is the same class
 * through JetStream durables, one of them left by a real service run rather
 * than by any suite.
 *
 * So the rules here are not style:
 *
 * - **Track PIDs.** Never `pkill -f node` — on a developer machine that kills
 *   their editor's language server, and the sabotage log already has two
 *   entries about a broad pattern killing the harness itself.
 * - **Kill the process GROUP.** `npm run` spawns a shell that spawns node;
 *   killing the parent orphans the child still holding the port.
 * - **Reap on failure, on interrupt and on timeout.** A `finally` only runs
 *   while this process survives, so the signal handlers below are the half that
 *   covers Ctrl-C and a killed runner.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentials, loadPackageDefinition, Metadata } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  HEALTH_PACKAGE_NAME,
  OPS_PROTO_PATHS,
  READINESS_SERVICE,
} from '@synapsedesk/grpc-proto';
import { REPO_ROOT, SERVICES, type ServiceSpec } from './services';

/** A started process, with what is needed to kill and to blame it. */
type Running = { spec: ServiceSpec; child: ChildProcess; output: string[] };

const running: Running[] = [];

/**
 * The PID table, on disk.
 *
 * **Required, not a convenience.** `globalSetup`, each test worker and
 * `globalTeardown` are three separate module registries — a module-level array
 * populated in setup is EMPTY in teardown. Without this the harness would spawn
 * seven processes, run green, and leak the entire fleet holding seven ports,
 * which is the exact class of mess §4 exists to prevent and would have been
 * invisible until the next run failed on a port check.
 *
 * A fixed path rather than a random one, so a run killed before teardown leaves
 * a table the NEXT run can find and reap.
 */
const PID_FILE =
  // Overridable so `stack.spec.ts` can exercise the reap path without touching
  // a concurrently running real harness's table — the file is deliberately at a
  // FIXED default path (a killed run must be findable by the next one), which
  // is exactly what makes two uncoordinated writers dangerous.
  process.env.SYNAPSEDESK_SYSTEM_PID_FILE ??
  join(tmpdir(), 'synapsedesk-system-pids.json');

type PidEntry = { pkg: string; pid: number };

function readPids(): PidEntry[] {
  if (!existsSync(PID_FILE)) return [];

  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8')) as PidEntry[];
  } catch {
    return [];
  }
}

function writePids(entries: PidEntry[]): void {
  writeFileSync(PID_FILE, JSON.stringify(entries));
}

/** Signals one recorded process group, tolerating one that is already gone. */
function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone. Tracking PIDs is precisely so this set is the only one
    // touched, and a dead member of it is nothing to report.
  }
}

/** How long the whole stack has to come up. */
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

/** The last lines a service printed, quoted when it fails to appear. */
const OUTPUT_TAIL = 15;

// ---------------------------------------------------------------- Ports

/** Whoever holds a port, if this machine can say. */
function holderOf(port: number): string {
  try {
    // Resolved through PATH, and that is fine HERE: an attacker who can write a
    // developer's PATH already runs code as that developer, so this harness is
    // not the boundary — and an absolute path would be wrong per machine.
    const pids = execFileSync('lsof', ['-ti', `tcp:${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);

    return pids.length > 0 ? ` (held by PID ${pids.join(', ')})` : '';
  } catch {
    // `lsof` is not installed, or nothing holds it. Neither is worth failing
    // over — the port number alone is already the actionable half.
    return '';
  }
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Every port free before anything starts.
 *
 * **Checked rather than discovered.** A service that loses its bind does not
 * exit — it logs and keeps running — so without this the harness starts a
 * process, polls a port answered by somebody else's process, and reports a
 * timeout about the wrong thing.
 */
export async function assertPortsFree(): Promise<void> {
  const held: string[] = [];

  for (const spec of SERVICES) {
    if (!(await portIsFree(spec.port))) {
      held.push(`port ${spec.port}${holderOf(spec.port)} — ${spec.pkg}`);
    }
  }

  if (held.length > 0) {
    throw new Error(
      `The system harness needs these ports and something else has them:\n  ${held.join('\n  ')}`,
    );
  }
}

// ---------------------------------------------------------------- Readiness

const healthDefinition = loadPackageDefinition(
  loadSync([...OPS_PROTO_PATHS], {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }),
);

/**
 * The generated `Health` client constructor.
 *
 * **`loadPackageDefinition` NESTS by dot**, so `definition['grpc.health.v1']` is
 * `undefined` and the flat lookup an earlier version used threw *"Cannot read
 * properties of undefined"* on the first readiness poll — with the whole fleet
 * already spawned. Walking the segments is what makes `HEALTH_PACKAGE_NAME`
 * usable as the single source of the name.
 */
const HealthClient = HEALTH_PACKAGE_NAME.split('.').reduce<
  Record<string, unknown>
>(
  (node, segment) => node[segment] as Record<string, unknown>,
  healthDefinition as unknown as Record<string, unknown>,
).Health as new (
  address: string,
  creds: ReturnType<typeof credentials.createInsecure>,
) => {
  check: (
    request: { service: string },
    metadata: Metadata,
    callback: (error: unknown, response?: { status?: string }) => void,
  ) => void;
  close: () => void;
};

/**
 * `grpc.health.v1/Check`, asking the READINESS sub-service.
 *
 * `''` is the standard's "the server as a whole" and answers liveness; the
 * named sub-service is the one that says it can actually serve. Asking the
 * wrong one would make a service that is up but not connected look ready.
 */
function grpcReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new HealthClient(
      `127.0.0.1:${port}`,
      credentials.createInsecure(),
    );

    client.check(
      { service: READINESS_SERVICE },
      new Metadata(),
      (error: unknown, response?: { status?: string }) => {
        client.close();
        resolve(!error && response?.status === 'SERVING');
      },
    );
  });
}

async function httpReady(port: number, path: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(2_000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * One readiness poll, exposed so a test can aim it at a port nothing listens
 * on.
 *
 * **The control the harness needs on itself.** A readiness check that answered
 * `true` unconditionally would make `startStack` return in milliseconds and
 * every later step fail somewhere confusing — and the first real run DID come
 * back in 1.8 seconds, which is fast enough to be worth disproving rather than
 * believing.
 */
export function probeReady(spec: ServiceSpec): Promise<boolean> {
  return isReady(spec);
}

function isReady(spec: ServiceSpec): Promise<boolean> {
  return spec.probe.kind === 'http'
    ? httpReady(spec.port, spec.probe.path)
    : grpcReady(spec.port);
}

// ---------------------------------------------------------------- Lifecycle

function start(spec: ServiceSpec): Running {
  // `npm` through PATH on purpose: its location varies by installation method,
  // nvm version and platform, so an absolute path is wrong on every machine but
  // the author's. The PATH-injection concern the analyser raises does not apply
  // — whoever writes a developer's PATH already runs code as that developer.
  const child = spawn(...(spec.command ?? ['npm', ['run', 'start:prod']]), {
    cwd: `${REPO_ROOT}/${spec.dir}`,
    // **Its own process group**, which is what makes `kill(-pid)` reach the
    // node process `npm run` spawns underneath itself. Killing the npm shell
    // alone leaves the service holding its port.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const output: string[] = [];
  const capture = (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.length > OUTPUT_TAIL * 4) output.splice(0, output.length / 2);
  };

  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  // **Without this, a spawn failure crashes the HARNESS**: `spawn` reports
  // ENOENT as an async `error` event, and an unhandled one throws at the
  // process level — found by the unspawnable-service test taking down its own
  // jest worker instead of failing with a name. Captured into the tail, where
  // the readiness report already quotes it.
  child.once('error', (error) => {
    output.push(`spawn failed: ${String(error)}\n`);
  });

  const entry: Running = { spec, child, output };
  running.push(entry);

  if (child.pid === undefined) {
    // **No pid means no process** — the spawn itself failed and an `error`
    // event follows, so there is nothing alive to leak. What silently
    // continuing DID cost: a hole in the PID table, 120 seconds of polling a
    // port nothing was ever going to bind, and a timeout blaming a service
    // that was never started — with an empty output tail, because there was
    // nothing to print.
    throw new Error(
      `${spec.pkg} did not spawn at all — is its launch command runnable in ${spec.dir}?` +
        (spec.hint ? `\n  ${spec.hint}` : ''),
    );
  }

  writePids([...readPids(), { pkg: spec.pkg, pid: child.pid }]);

  return entry;
}

/** The tail of what a service said, for a readiness failure to quote. */
function tailOf(entry: Running): string {
  return entry.output
    .join('')
    .split('\n')
    .filter(Boolean)
    .slice(-OUTPUT_TAIL)
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * Kills one service's whole process group.
 *
 * `SIGTERM` first so `enableShutdownHooks` runs — the services close their
 * Prisma pools, their Redis clients and their NATS connections on it, and a
 * `SIGKILL` here would leave exactly the connections this file exists to avoid
 * leaving.
 */
/**
 * Stops one named service — the arrangement check 1 uses.
 *
 * Reads the PID table rather than the in-memory list, because this runs in a
 * TEST WORKER and nothing in that registry ever started anything.
 */
export async function stopService(pkg: string): Promise<void> {
  const spec = SERVICES.find((candidate) => candidate.pkg === pkg);
  const entry = readPids().find((candidate) => candidate.pkg === pkg);

  if (!spec || !entry) {
    throw new Error(`${pkg} is not in the PID table — was the stack started?`);
  }

  signalPid(entry.pid, 'SIGTERM');

  await waitFor(
    async () => !(await isReady(spec)),
    20_000,
    () => `${pkg} is still answering on ${spec.port} after SIGTERM`,
  );
}

/** Polls until `condition` holds, or throws what `onTimeout` says. */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  onTimeout: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(onTimeout());

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Starts every service and waits for all of them.
 *
 * **Reports WHICH service never came up**, with what it printed. "Timed out
 * waiting for the stack" costs an investigation; "ticket-service never answered
 * on 5002" costs nothing, and the tail of its output usually costs less than
 * that.
 */
export async function startStack(
  options: {
    /** A different stack — `stack.spec.ts` feeds one fake service. */
    services?: readonly ServiceSpec[];
    /** A different deadline, because the real one is two minutes and a test
     * that waits two minutes is a test nobody keeps — while a test against a
     * copied `startStack` with a shorter number guards the copy. */
    readyTimeoutMs?: number;
  } = {},
): Promise<void> {
  const services = options.services ?? SERVICES;
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;

  for (const spec of services) start(spec);

  const deadline = Date.now() + readyTimeoutMs;
  const pending = new Map(running.map((entry) => [entry.spec.pkg, entry]));

  while (pending.size > 0) {
    for (const [pkg, entry] of pending) {
      if (await isReady(entry.spec)) pending.delete(pkg);
    }

    if (pending.size === 0) break;

    if (Date.now() > deadline) {
      const detail = [...pending.values()]
        .map(
          (entry) =>
            `  ${entry.spec.pkg} never answered on ${entry.spec.port}` +
            (entry.spec.hint ? `\n    ${entry.spec.hint}` : '') +
            (tailOf(entry) ? `\n${tailOf(entry)}` : ''),
        )
        .join('\n');

      // **Reaped HERE, not left for a caller's `try`.** A readiness timeout
      // is this harness's single most likely failure, and it happens with the
      // whole fleet already spawned.
      await stopStack();

      throw new Error(`The stack did not come up:\n${detail}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Reaps everything this harness started, and nothing else.
 *
 * Idempotent: `globalTeardown` calls it, and so do the signal handlers, and a
 * Ctrl-C during teardown must not leave half a fleet behind.
 */
export async function stopStack(): Promise<void> {
  const entries = readPids();

  for (const entry of entries) signalPid(entry.pid, 'SIGTERM');

  // A grace window for `SIGTERM` to be honoured, then insist. Bounded rather
  // than awaited per process: a service wedged in shutdown must not stop the
  // others being reaped.
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  for (const entry of entries) signalPid(entry.pid, 'SIGKILL');

  running.length = 0;
  rmSync(PID_FILE, { force: true });
}

/**
 * Reaps a fleet an earlier run left behind.
 *
 * A run killed with `SIGKILL` — a timeout, a closed terminal — never reaches
 * teardown, and the table it left is the only record of what it started. Called
 * before the port check so the common case reports nothing rather than
 * "port 3000 is held".
 */
export async function reapPreviousRun(): Promise<void> {
  if (readPids().length === 0) return;

  await stopStack();
}

/**
 * Teardown on the paths a `finally` does not cover.
 *
 * Registered once, at import. The lesson is one this repository has already
 * paid for: *a `finally` is only a guarantee while the harness's own process
 * survives*.
 */
let handlersInstalled = false;

export function installReapers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stopStack().finally(() => process.exit(1));
    });
  }

  process.once('uncaughtException', (error) => {
    void stopStack().finally(() => {
      console.error(error);
      process.exit(1);
    });
  });
}

/**
 * Which of this harness's ports are still HELD.
 *
 * **Named for what it returns.** It was `portsAreFree` and returned the
 * opposite, which read correctly at the teardown call site — *"held is empty"* —
 * and inverted the smoke check that asked whether every service was up. One
 * function, two readings, and the wrong one passed review.
 */
export async function portsStillHeld(): Promise<string[]> {
  const held: number[] = [];

  for (const spec of SERVICES) {
    if (!(await portIsFree(spec.port))) held.push(spec.port);
  }

  return held.map(String);
}
