/**
 * @file The stack, as one table.
 *
 * Every other file in this harness reads from here, so "which services exist"
 * and "which port each one answers on" are decided once. A second list is how a
 * readiness poll ends up waiting on a service nobody started.
 */

import { join } from 'node:path';

/** Where the repository root is, from this file. */
export const REPO_ROOT = join(__dirname, '../..');

/** How a service says it is ready. */
export type Probe =
  | { kind: 'http'; path: string }
  /**
   * `grpc.health.v1/Check`.
   *
   * **The only option for five of the six**, and not because they chose gRPC
   * over HTTP. Only `auth-service` uses `createMicroservice`; the rest are full
   * Nest applications that `connectMicroservice` twice — gRPC and NATS, which
   * `INestMicroservice` cannot do — and then call `init()` rather than
   * `listen()`. So an HTTP adapter exists and no port is bound to it. There is
   * nothing to GET.
   */
  | { kind: 'grpc' };

export type ServiceSpec = {
  /** The workspace name, for `npm run … -w`. */
  pkg: string;
  /** The directory to spawn in — also where its `.env` is read from. */
  dir: string;
  /** The port it binds. Reported by name when readiness times out. */
  port: number;
  probe: Probe;
  /** Said instead of a timeout when this one specifically fails to appear. */
  hint?: string;
  /**
   * How to launch it, when not `npm run start:prod`.
   *
   * Exists for `stack.spec.ts`, whose fake service is a bare `sleep` — a real
   * service never sets it, and the default staying in `stack.ts` keeps one
   * spelling of the launch line.
   */
  command?: [string, string[]];
};

/**
 * The seven processes, in start order.
 *
 * **Order is a convenience, not a dependency graph.** Every service retries its
 * own connections, so the stack converges whatever order it starts in — but
 * starting auth first means the gateway's first upstream call is less likely to
 * be its own cold start, which shortens the readiness window rather than
 * changing what it proves.
 */
export const SERVICES: readonly ServiceSpec[] = [
  {
    pkg: '@synapsedesk/auth-service',
    dir: 'apps/auth-service',
    port: 5001,
    probe: { kind: 'grpc' },
  },
  {
    pkg: '@synapsedesk/ticket-service',
    dir: 'apps/ticket-service',
    port: 5002,
    probe: { kind: 'grpc' },
  },
  {
    pkg: '@synapsedesk/ingestion-service',
    dir: 'apps/ingestion-service',
    port: 5004,
    probe: { kind: 'grpc' },
  },
  {
    pkg: '@synapsedesk/notification-service',
    dir: 'apps/notification-service',
    port: 5005,
    probe: { kind: 'grpc' },
  },
  {
    pkg: '@synapsedesk/storage-service',
    dir: 'apps/storage-service',
    port: 50253,
    probe: { kind: 'grpc' },
  },
  {
    pkg: '@synapsedesk/rag-service',
    dir: 'apps/rag-service',
    port: 50255,
    probe: { kind: 'grpc' },
    // **Named, because this is the one that will not come up.** It needs a
    // virtualenv that `npm run setup:py` creates, and a missing `.venv` makes
    // the spawn fail instantly rather than time out — so the message is worth
    // more than the poll.
    hint: 'rag-service needs its virtualenv — run `npm run setup:py`',
  },
  {
    pkg: '@synapsedesk/api-gateway',
    dir: 'apps/api-gateway',
    port: 3000,
    // **The one HTTP probe, and it proves less than it looks.** ADR 0010: the
    // gateway's readiness deliberately does NOT cascade, because a probe that
    // fails on a slow peer takes the whole fleet out of rotation. So this says
    // the gateway is up and nothing about its upstreams — which is why every
    // other service is polled on its own port rather than through this one.
    probe: { kind: 'http', path: '/health/ready' },
  },
];

/**
 * The gateway's base URL — the only HTTP surface in the stack.
 *
 * **An input, because the smoke suite's whole premise is "safe to point at a
 * real deployment".** Hard-coded, that premise was false of every test in the
 * file: not only the port check but the plain HTTP ones, which against a remote
 * target would time out on localhost and read as "the gateway is down" rather
 * than "this harness cannot address your deployment".
 */
export const GATEWAY_URL =
  process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

/** Whether the target is THIS machine — what gates the local-only checks. */
export function targetIsLocal(): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(
    new URL(GATEWAY_URL).hostname,
  );
}

/**
 * Path every REST route sits under: the gateway's `GLOBAL_PREFIX` (`api`) plus
 * the URI version it applies (`v1`).
 */
export const API = '/api/v1';
