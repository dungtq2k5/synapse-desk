#!/usr/bin/env node
/**
 * `.env.example` → one ConfigMap and one Secret skeleton per service.
 *
 *     node scripts/generate-k8s-config.mjs            # rewrite k8s/generated/
 *     node scripts/generate-k8s-config.mjs --check    # verify, writing nothing
 *
 * **`.env.example`, and NOT `.env` — the input is the whole decision.**
 * `scripts/generate-docker-env.mjs` reads each service's untracked `.env` and
 * says why that is safe there: *"the output may hold real credentials — one
 * more reason it must never be tracked."* A ConfigMap is tracked, so it cannot
 * share that input. What transfers from that script is its SUBSTITUTION TABLE —
 * host addresses rewritten to cluster service names — not its source.
 *
 * **Commented lines count.** `envDocumentedKeys` in
 * `libs/common/src/testing/env-file.ts` is the settled rule, and it
 * reads `# KEY = value` as documentation of an optional variable, because that
 * is how this repository documents a default without setting it. Reading only
 * active lines would drop exactly the variables a cluster overrides —
 * `METRICS_HOST`, every `REDIS_DB`, rag-service's `GRPC_PORT` — since in
 * development the default is right and only in a pod is it wrong. The regex
 * below is that rule; `manifest-contract.spec.ts` compares this output against
 * the TypeScript parser, so a divergence goes red rather than quiet.
 *
 * **Values are not the contract; keys are.** Anything site-specific is written
 * as `REPLACE_ME` and anything secret goes to a separate `*.secret.example.yaml`
 * with an empty value. The checks compare KEY SETS — measured, asking Joi
 * which fields are `required()` is not available (`extract()` throws
 * `Invalid reference exceeds the schema root` on any field carrying a
 * `when()`), so "is it present" is the question that can be answered and
 * "must it be" is not.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'k8s/generated');
const check = process.argv.includes('--check');

/** Services, from git rather than a literal — a new app appears by existing. */
const services = () =>
  execFileSync(
    'git', // NOSONAR
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'apps/*/.env.example',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .map((file) => file.split('/')[1])
    .sort();

/**
 * `# KEY = value` and `KEY = value` alike — the `envDocumentedKeys` rule, with
 * the value kept. Later lines win, so an active line overrides a commented one
 * (ingestion and ticket document `NODE_ENV` both ways).
 */
const documented = (content) => {
  const entries = new Map();

  for (const raw of content.split('\n')) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(raw.trim());
    if (match) entries.set(match[1], match[2].trim());
  }

  return entries;
};

/**
 * Injected by the image build (Dockerfile ARGs), never by config.
 * The same set `env-contract.spec.ts` carries.
 */
const BUILD_INJECTED = new Set(['APP_VERSION', 'BUILD_SHA', 'BUILD_TIME']);

/** Carries a credential. Goes to a Secret, with the value blanked. */
const SECRET = new Set([
  'DATABASE_URL',
  'INGESTION_DATABASE_URL',
  'REDIS_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TWO_FACTOR_MASTER_KEY',
  'GEMINI_API_KEY',
  'INBOUND_EMAIL_SECRET',
  'SUPER_ADMIN_PASSWORD',
  'RESEND_API_KEY',
  'RESEND_GATEWAY_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'TWILIO_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_AUTH_PHONE',
]);

/** Real per-deployment values. Present in the ConfigMap, value not decidable here. */
const SITE_SPECIFIC = new Set([
  'CORS',
  'APP_WEB_URL',
  'INBOUND_EMAIL_DOMAIN',
  'EMAIL_SENDER',
  'SUPPORT_EMAIL',
  'FIREBASE_STORAGE_BUCKET',
  'SUPER_ADMIN_EMAIL',
]);

/**
 * Documented, and deliberately ABSENT from the cluster.
 *
 * An exclusion needs a reason next to it, because an absent variable and a
 * forgotten one are the same diff.
 */
const EXCLUDED = new Map([
  [
    'FIREBASE_STORAGE_EMULATOR_HOST',
    'production uses real Firebase Storage; setting this points the SDK at an emulator that is not there',
  ],
]);

/** Host address → in-cluster address. Lifted from `generate-docker-env.mjs`. */
const SUBSTITUTIONS = [
  ['localhost:4222', 'nats:4222'],
  ['localhost:8222', 'nats:8222'],
  ['localhost:6333', 'qdrant:6333'],
  ['localhost:5001', 'auth-service:5001'],
  ['localhost:5002', 'ticket-service:5002'],
  ['localhost:5004', 'ingestion-service:5004'],
  ['localhost:5005', 'notification-service:5005'],
  ['localhost:50253', 'storage-service:50253'],
  ['localhost:50255', 'rag-service:50255'],
];

/**
 * What a pod needs that a developer's machine does not.
 *
 * Most entries here are on a COMMENTED line in its `.env.example`. The two
 * that are not — `NODE_ENV` and auth's `FIREBASE_SERVICE_ACCOUNT_PATH` — are
 * the same shape from the other side: the development value is RIGHT and is
 * therefore set, and the cluster is the one place it is wrong. Either way the
 * variable must be documented in that file, which the check below enforces.
 */
const CLUSTER = {
  '*': { NODE_ENV: 'production' },
  'api-gateway': {
    // `.env.example`: "defaults to loopback; a Kubernetes pod sets 0.0.0.0 for
    // the scraper".
    METRICS_HOST: '0.0.0.0',
    SWAGGER_ENABLED: 'false',
  },
  'rag-service': {
    GRPC_HOST: '0.0.0.0',
    GRPC_PORT: '50255',
  },
  'auth-service': {
    // **The one path whose local and cluster answers genuinely differ.** The
    // key is a mounted Secret at `/app/apps/auth-service/secrets`, while
    // `npm run keys:service-account` writes it to the package root — so
    // `.env.example` names the package root (it is the file a developer
    // copies) and the cluster answer lives here.
    //
    // Not a tidy-up: the two used to be reconciled by `.env.example` carrying
    // the CLUSTER value, which made `cp .env.example .env` produce an
    // auth-service that could not boot. `manifest-contract.spec.ts` test 6
    // derives the mount from this value, so getting it wrong here is red
    // rather than a `readFileSync` at boot.
    FIREBASE_SERVICE_ACCOUNT_PATH: './secrets/serviceAccountKey.json',
  },
  'notification-service': {
    // notification-service's Joi schema refuses `true` outside development
    // (`webhook-private-targets.spec.ts` pins it). Setting it explicitly is
    // what makes the refusal visible in the manifest rather than implied by an
    // absence.
    WEBHOOK_ALLOW_PRIVATE_TARGETS: 'false',
  },
  // **No `REDIS_DB` override, deliberately.** ADR 0043 puts every service on
  // one Memorystore instance and one logical database, which is what
  // `# REDIS_DB = 0` in each `.env.example` already documents — so the derived
  // value is already right and an override here would only restate it. The
  // 3/4/5 split lives in `.env.test`, where it keeps suites off each other's
  // keys; production does not inherit a split it never had.
};

const substitute = (value) => {
  let out = value;
  for (const [host, cluster] of SUBSTITUTIONS)
    out = out.replaceAll(host, cluster);
  return out;
};

/** YAML scalar, always quoted: a ConfigMap value is a string and `5001` is not. */
const scalar = (value) => `'${String(value).replaceAll("'", "''")}'`;

const banner = (service, kind) =>
  `# GENERATED by scripts/generate-k8s-config.mjs — do not edit.\n` +
  `#\n` +
  `# Source: apps/${service}/.env.example (active AND commented lines — see the\n` +
  `# script header for why the commented ones are the cluster-relevant half).\n` +
  `# Regenerate with:\n` +
  `#\n` +
  `#     node scripts/generate-k8s-config.mjs\n` +
  `#\n` +
  `# ${kind}\n`;

const render = (service) => {
  const source = readFileSync(
    join(ROOT, 'apps', service, '.env.example'),
    'utf8',
  );
  const entries = documented(source);
  // `'*'` applies WHERE THE KEY EXISTS; a per-service override must exist.
  // rag-service is the case that separates them: it is Python and documents no
  // `NODE_ENV`, so a global override that insisted would fail on a service it
  // does not apply to.
  const shared = Object.fromEntries(
    Object.entries(CLUSTER['*']).filter(([key]) => entries.has(key)),
  );
  // No `?? {}`: spreading `undefined` copies nothing, so the fallback read as
  // a guard for the four services with no CLUSTER entry and guarded nothing.
  const overrides = { ...shared, ...CLUSTER[service] };

  const config = [];
  const secrets = [];
  const skipped = [];

  for (const [key, raw] of [...entries].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (BUILD_INJECTED.has(key)) continue;

    if (EXCLUDED.has(key)) {
      skipped.push([key, EXCLUDED.get(key)]);
      continue;
    }

    if (SECRET.has(key)) {
      secrets.push(key);
      continue;
    }

    if (SITE_SPECIFIC.has(key)) {
      config.push([key, 'REPLACE_ME']);
      continue;
    }

    config.push([key, substitute(overrides[key] ?? raw)]);
  }

  // An override for a variable the service does not document is a typo that
  // would otherwise ship as a silently absent setting.
  for (const key of Object.keys(overrides)) {
    if (!entries.has(key)) {
      throw new Error(
        `${service}: CLUSTER override "${key}" is not documented in its .env.example`,
      );
    }
  }

  const configMap =
    banner(service, 'ConfigMap: the non-secret half of the env contract.') +
    (skipped.length
      ? `#\n# Documented and deliberately absent:\n` +
        skipped.map(([key, why]) => `#   ${key} — ${why}\n`).join('')
      : '') +
    `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${service}-config\n` +
    `  labels:\n    app.kubernetes.io/name: ${service}\ndata:\n` +
    config.map(([key, value]) => `  ${key}: ${scalar(value)}\n`).join('');

  const secret =
    banner(
      service,
      'Secret SKELETON: key names only. Values are supplied out of band —\n' +
        '# never commit one. `kubectl create secret generic` or a sealed-secret\n' +
        '# controller fills these in.',
    ) +
    `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${service}-secret\n` +
    `  labels:\n    app.kubernetes.io/name: ${service}\ntype: Opaque\nstringData:\n` +
    (secrets.length
      ? secrets.map((key) => `  ${key}: ''\n`).join('')
      : '  {}\n');

  return { configMap, secret };
};

let drifted = 0;
mkdirSync(OUT, { recursive: true });

for (const service of services()) {
  const { configMap, secret } = render(service);

  for (const [suffix, body] of [
    ['configmap', configMap],
    ['secret.example', secret],
  ]) {
    const target = join(OUT, `${service}.${suffix}.yaml`);

    if (check) {
      const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
      if (current !== body) {
        console.error(`DRIFT: k8s/generated/${service}.${suffix}.yaml`);
        drifted += 1;
      }
      continue;
    }

    writeFileSync(target, body);
    console.log(`k8s/generated/${service}.${suffix}.yaml`);
  }
}

if (check && drifted > 0) {
  console.error(
    `\n${drifted} generated file(s) differ from apps/*/.env.example.\n` +
      'Run: node scripts/generate-k8s-config.mjs',
  );
  process.exit(1);
}
