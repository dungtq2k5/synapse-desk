#!/usr/bin/env node
/**
 * Writes the gateway's OpenAPI document to `docs/reference/openapi.json`.
 *
 *   node scripts/export-openapi.mjs            # rewrite the file
 *   node scripts/export-openapi.mjs --check    # compare, write nothing, exit 1 on drift
 *
 * **Reads the BUILT gateway**, as `generate-job-alerts.mjs` reads the built lib,
 * and the built gateway `require`s each library's own `dist/`. So run it through
 * `npm run openapi:export` / `npm run openapi:check`, which build the gateway
 * with its dependencies first; run bare, it refuses only an output that is
 * absent, because a stale one cannot be told apart by mtime.
 *
 * **Creates the application, never starts it.** No `listen`, no microservice
 * transport, no stack: `NestFactory.create`, the same `applyApiRouting` every
 * other composition root calls, the same `buildOpenApiDocument` the served page
 * uses, then `close`.
 *
 * **`apps/api-gateway/.env.test` is authoritative.** Its values are ASSIGNED
 * over `process.env`, so a cookie name exported in a shell or in CI cannot reach
 * the published file. A key the document reads that is NOT in that file would
 * still come from the root `.env`; every key it reads today is Joi-required, so
 * it is in the file.
 *
 * **The output is canonical**: `info.version` is the gateway package's version,
 * primitive `enum` arrays are sorted by `canonicalizeEnums` (an `enum` is a set,
 * and the compiler orders a union's members differently in `nest build` and in
 * ts-jest), and the text is Prettier-formatted with the repo's config. Object
 * keys are never reordered.
 *
 * **`--check` never writes.** A check that repairs what it reports passes on its
 * second run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import {
  BUILD_COMMAND,
  EXPORT_COMMAND,
  EXPORT_ENV_FILE,
  OPENAPI_OUTPUT,
  assignEnvFileAt,
  firstDifferingLine,
  missingOutputs,
} from './lib/openapi-export.cjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const GATEWAY_DIST = join(ROOT, 'apps/api-gateway/dist/apps/api-gateway/src');
const OUTPUT = join(ROOT, OPENAPI_OUTPUT);

const missing = missingOutputs(ROOT);
if (missing.length > 0) {
  console.error(
    `The export reads build outputs that do not exist:\n${missing.map((output) => `  ${output}`).join('\n')}\nBuild them: ${BUILD_COMMAND}`,
  );
  process.exit(1);
}

// Before anything under the gateway's dist is required: config is read at boot.
assignEnvFileAt(join(ROOT, EXPORT_ENV_FILE), process.env);

// Resolved from the gateway's dist, so the script uses the gateway's own Nest.
const gatewayRequire = createRequire(join(GATEWAY_DIST, 'main.js'));
const { NestFactory } = gatewayRequire('@nestjs/core');
const { ConfigService } = gatewayRequire('@nestjs/config');
const { AppModule } = gatewayRequire('./app.module');
const { buildOpenApiDocument } = gatewayRequire(
  './common/config/swagger.config',
);
const { applyApiRouting, resolveGlobalPrefix } = gatewayRequire(
  './modules/health/ops-routes',
);
// The built lib the gateway itself requires, so both apply one canonicalization.
const { canonicalizeEnums } = gatewayRequire('@synapsedesk/common');

/** The canonical document text, exactly as it is committed. */
async function exportDocument() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });

  try {
    const configService = app.get(ConfigService);
    applyApiRouting(
      app,
      resolveGlobalPrefix(configService.getOrThrow('GLOBAL_PREFIX')),
    );

    const document = buildOpenApiDocument(app, configService);
    document.info.version = JSON.parse(
      readFileSync(join(ROOT, 'apps/api-gateway/package.json'), 'utf8'),
    ).version;
    canonicalizeEnums(document);

    const options = await prettier.resolveConfig(OUTPUT);
    return await prettier.format(JSON.stringify(document, null, 2), {
      ...options,
      parser: 'json',
    });
  } finally {
    await app.close();
  }
}

try {
  const actual = await exportDocument();

  if (!CHECK) {
    writeFileSync(OUTPUT, actual);
    console.log(`Wrote ${OPENAPI_OUTPUT}`);
    process.exit(0);
  }

  let committed = '';
  try {
    committed = readFileSync(OUTPUT, 'utf8');
  } catch {
    // Absent is drift at line 1.
  }

  const line = firstDifferingLine(committed, actual);
  if (line !== null) {
    console.error(
      `${OPENAPI_OUTPUT} has drifted from the gateway source, first at line ${line}.\nRegenerate it: ${EXPORT_COMMAND}`,
    );
    process.exit(1);
  }

  console.log(`${OPENAPI_OUTPUT} is up to date`);
  process.exit(0);
} catch (error) {
  console.error('The OpenAPI export failed to boot the gateway:');
  console.error(error);
  process.exit(1);
}
