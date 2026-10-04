#!/usr/bin/env node
/**
 * Writes the gateway's OpenAPI document to `docs/reference/openapi.json`.
 *
 *   node scripts/export-openapi.mjs            # rewrite the file
 *   node scripts/export-openapi.mjs --check    # compare, write nothing, exit 1 on drift
 *
 * **Reads the document the gateway SERVES**, which `OpenApiDocumentExportIT` saves
 * to `apps/api-gateway-java/target/openapi-java.json`. Run it through `npm run
 * openapi:export` / `npm run openapi:check`, which delete that file and produce it
 * again in the same command: run bare, this refuses only a file that is absent,
 * because a stale one cannot be told apart by its age.
 *
 * **The output is canonical**: the served text, Prettier-formatted with the repo's
 * config. Nothing is reordered or rewritten; the served document has no value that
 * varies run to run (its `servers` list is empty), so the committed file is exactly
 * what a client fetching `/v3/api-docs` reads.
 *
 * **Validated before the write AND before the comparison** against OpenAPI 3.1, and
 * for a schema that both allows and refuses null (`openapiViolations`): such a
 * document must not reach the file, and must not pass CI if it is already in it.
 *
 * **`--check` never writes.** A check that repairs what it reports passes on its
 * second run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import {
  EXPORT_COMMAND,
  OPENAPI_OUTPUT,
  firstDifferingLine,
  openapiViolations,
} from './lib/openapi-export.cjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SERVED = join(ROOT, 'apps/api-gateway-java/target/openapi-java.json');
const OUTPUT = join(ROOT, OPENAPI_OUTPUT);

if (!existsSync(SERVED)) {
  console.error(
    `The export reads the served document, and ${SERVED} does not exist.\nProduce it: ${EXPORT_COMMAND}`,
  );
  process.exit(1);
}

const document = JSON.parse(readFileSync(SERVED, 'utf8'));
const options = await prettier.resolveConfig(OUTPUT);
const actual = await prettier.format(JSON.stringify(document, null, 2), {
  ...options,
  parser: 'json',
});

const violations = openapiViolations(document);
if (violations.length) {
  console.error(
    `${OPENAPI_OUTPUT} fails OpenAPI 3.1 validation (${violations.length} problems):\n` +
      `${violations.slice(0, 10).join('\n')}` +
      (violations.length > 10 ? `\n…and ${violations.length - 10} more` : ''),
  );
  process.exit(1);
}

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
    `${OPENAPI_OUTPUT} has drifted from what the gateway serves, first at line ${line}.\nRegenerate it: ${EXPORT_COMMAND}`,
  );
  process.exit(1);
}

console.log(`${OPENAPI_OUTPUT} is up to date`);
