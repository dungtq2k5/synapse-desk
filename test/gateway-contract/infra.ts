/**
 * @file Redis and NATS, this run's own, on ports the OS chooses.
 *
 * **Not the project's stack.** The rows publish NATS events and assert what
 * reaches a client; a dev notification-service consuming `notification.*`, or a
 * dev gateway relaying `ticket.*`, would make a row's result depend on what
 * else happens to be running.
 *
 * **Not fixed "spare" ports either.** `14222`, `16379` and `1543x` were spare
 * on this machine in September and belong to another project now. `-p
 * 127.0.0.1:0:<port>` asks the OS for a free one and `docker port` reads back
 * what it chose, so two runs of this suite cannot collide.
 *
 * **Bound to the loopback deliberately**: `-p 0:6379` publishes on every
 * interface, which puts an unauthenticated Redis on the local network for the
 * length of a test run.
 */

import { execFileSync } from 'node:child_process';

/** The images the project's own compose file pins, so the harness matches it. */
const IMAGES = {
  redis: 'redis:8.8.0-alpine',
  nats: 'nats:2.10-alpine',
} as const;

const docker = (...args: string[]): string =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    // `inspect` on a container `--rm` already removed writes "no such object"
    // to stderr, which is the ordinary teardown path rather than a fault.
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/** The host port docker published for a container port, e.g. `49153`. */
function publishedPort(container: string, containerPort: number): number {
  // `127.0.0.1:49153`, or several lines when a port is published more than
  // once; the first is this run's.
  const [mapping] = docker('port', container, `${containerPort}/tcp`).split(
    '\n',
  );
  const port = Number(mapping.split(':').at(-1));

  if (!Number.isInteger(port)) {
    throw new Error(
      `docker port ${container} ${containerPort} returned '${mapping}'`,
    );
  }

  return port;
}

export type Infra = { containers: string[]; redisUrl: string; natsUrl: string };

/**
 * Starts both containers and waits for each to answer.
 *
 * `--rm` so a killed run leaves nothing behind even if teardown never runs;
 * ids are returned so teardown removes exactly these.
 */
export function startInfra(): Infra {
  const redis = docker(
    'run',
    '-d',
    '--rm',
    '-p',
    '127.0.0.1:0:6379',
    IMAGES.redis,
  );
  const nats = docker(
    'run',
    '-d',
    '--rm',
    '-p',
    '127.0.0.1:0:4222',
    IMAGES.nats,
  );

  const redisPort = publishedPort(redis, 6379);
  const natsPort = publishedPort(nats, 4222);

  waitFor(() => docker('exec', redis, 'redis-cli', 'ping') === 'PONG', 'redis');
  // NATS has no CLI in the alpine image; the published port answering a TCP
  // connect is what the gateway's client needs anyway.
  waitFor(() => tcpAnswers(natsPort), 'nats');

  return {
    containers: [redis, nats],
    // Database 15, as `.env.test` uses: the suites that share a developer's
    // Redis keep their keys out of database 0, and matching it keeps the
    // gateway's configuration identical apart from the port.
    redisUrl: `redis://127.0.0.1:${redisPort}/15`,
    natsUrl: `nats://127.0.0.1:${natsPort}`,
  };
}

/** Removes the containers this run started, tolerating one already gone. */
export function stopInfra(containers: string[]): void {
  for (const container of containers) {
    try {
      docker('stop', '-t', '2', container);
    } catch {
      // Already gone — `--rm` and a killed run get here, and there is nothing
      // to report about a container that is no longer running.
    }
  }
}

/** Which of this run's containers are still running — teardown asserts none. */
export function stillRunning(containers: string[]): string[] {
  return containers.filter((container) => {
    try {
      return (
        docker('inspect', '-f', '{{.State.Running}}', container) === 'true'
      );
    } catch {
      return false;
    }
  });
}

function tcpAnswers(port: number): boolean {
  try {
    execFileSync('bash', ['-c', `</dev/tcp/127.0.0.1/${port}`], {
      stdio: 'ignore',
    });

    return true;
  } catch {
    return false;
  }
}

function waitFor(ready: () => boolean, what: string, timeoutMs = 30_000): void {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (ready()) return;
    } catch {
      // Not up yet.
    }
    execFileSync('sleep', ['0.2']);
  }

  throw new Error(`${what} did not answer within ${timeoutMs} ms`);
}
