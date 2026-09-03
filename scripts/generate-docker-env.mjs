#!/usr/bin/env node
/**
 * `.env` → `.env.docker`, per service: the same values with the HOST half of
 * every address swapped for its compose service name, so a locally built
 * image can run against the compose infrastructure
 * (`docker run --network synapse-desk_default …`).
 *
 * GENERATED and gitignored, never tracked — deliberately, and
 * `image-contract.spec.ts` pins it. A tracked `.env.docker` would be a third
 * hand-maintained value-set: it would enter the env-contract guard's
 * archive-reference corpus (which reads every tracked env file under apps) but
 * not its completeness checks (which read `.env.example` by name), so it
 * could drift from the schema with no test going red — the exact class doc
 * 70 closed for the first two files. Generation closes the class instead of
 * adding a rule to it: this file cannot drift from `.env` because it is a
 * function of it.
 *
 * The inputs are the developer's own `.env` files (real local values, also
 * untracked), so the output may hold real credentials — one more reason it
 * must never be tracked.
 *
 * Peer `*_SERVICE_URL`s are rewritten to the service names the application
 * containers will use on the compose network. Until compose actually runs
 * the application services, a single container whose peers run on the HOST
 * needs those swapped for `host.docker.internal` by hand — that is a
 * temporary state, not a reason to encode it here.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');

const SERVICES = [
  'api-gateway',
  'auth-service',
  'ticket-service',
  'ingestion-service',
  'notification-service',
  'storage-service',
  'rag-service',
];

/**
 * Host address → compose-network address. ORDER matters: the postgres ports
 * are distinct on the host (one daemon per database, 5432–5435) and identical
 * inside the network (every container's own 5432).
 */
const SUBSTITUTIONS = [
  ['localhost:5432', 'postgres-auth:5432'],
  ['localhost:5433', 'postgres-ticket:5432'],
  ['localhost:5434', 'postgres-ingestion:5432'],
  ['localhost:5435', 'postgres-notification:5432'],
  ['localhost:6379', 'redis:6379'],
  ['localhost:4222', 'nats:4222'],
  ['localhost:8222', 'nats:8222'],
  ['localhost:6333', 'qdrant:6333'],
  ['localhost:9199', 'firebase-storage:9199'],
  // The application peers, by their eventual compose service names.
  ['localhost:5001', 'auth-service:5001'],
  ['localhost:5002', 'ticket-service:5002'],
  ['localhost:5004', 'ingestion-service:5004'],
  ['localhost:5005', 'notification-service:5005'],
  ['localhost:50253', 'storage-service:50253'],
  ['localhost:50255', 'rag-service:50255'],
];

let generated = 0;

for (const service of SERVICES) {
  const source = join(REPO_ROOT, 'apps', service, '.env');

  if (!existsSync(source)) {
    console.warn(`skip ${service}: no .env to generate from`);
    continue;
  }

  let content = readFileSync(source, 'utf8');
  for (const [host, container] of SUBSTITUTIONS) {
    content = content.replaceAll(host, container);
  }

  const banner =
    '# GENERATED from .env by scripts/generate-docker-env.mjs — do not edit,\n' +
    '# do not track. Host addresses are rewritten to compose service names.\n\n';

  writeFileSync(join(REPO_ROOT, 'apps', service, '.env.docker'), banner + content);
  generated += 1;
  console.log(`apps/${service}/.env.docker`);
}

if (generated === 0) {
  console.error('nothing generated — no service has a .env');
  process.exit(1);
}
