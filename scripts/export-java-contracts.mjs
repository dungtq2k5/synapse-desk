/**
 * Writes `libs/common`'s shared vocabulary into Java constants.
 *
 *   node scripts/export-java-contracts.mjs          # write
 *   node scripts/export-java-contracts.mjs --check  # compare, write nothing, exit 1 on drift
 *
 * It reads the BUILT library (`libs/common/dist`), the same artifact the
 * services load, so what it publishes is what runs rather than what the
 * sources say. Run it through `npm run java:contracts` / `java:contracts:check`,
 * which build first — the shape `openapi:export` already has.
 *
 * **`--check` never writes.** A check that repairs what it reports passes on
 * its second run and tells CI nothing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAll, unexportedPatterns } from './lib/java-contracts.cjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const OUTPUT_DIR = join(
  ROOT,
  'apps/api-gateway-java/src/main/java/com/synapsedesk/gateway/contracts',
);
const RELATIVE =
  'apps/api-gateway-java/src/main/java/com/synapsedesk/gateway/contracts';
const COMMAND = 'npm run java:contracts';

const require = createRequire(import.meta.url);
const BUILT = join(ROOT, 'libs/common/dist/main.js');

if (!existsSync(BUILT)) {
  console.error(
    `libs/common is not built (${BUILT} is absent).\nBuild it: npm run build:libs`,
  );
  process.exit(1);
}

const common = require(BUILT);

// **Before anything is written.** A new subject family that no group
// publishes is the drift this exists to prevent, and it is invisible in the
// output — the files would simply not mention it.
const missing = unexportedPatterns(common);
if (missing.length) {
  console.error(
    `These \`*_PATTERNS\` exports reach no Java class: ${missing.join(', ')}.\n` +
      'Add them to a group in `scripts/lib/java-contracts.cjs`, or name them in ' +
      '`PATTERNS_NOT_EXPORTED` with a reason.',
  );
  process.exit(1);
}

const files = renderAll(common);

if (!CHECK) {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(OUTPUT_DIR, name), source);
  }

  console.log(`Wrote ${Object.keys(files).length} files to ${RELATIVE}`);
  process.exit(0);
}

const drifted = [];

for (const [name, source] of Object.entries(files)) {
  let committed = '';
  try {
    committed = readFileSync(join(OUTPUT_DIR, name), 'utf8');
  } catch {
    // Absent is drift.
  }

  if (committed !== source) {
    drifted.push(name);
  }
}

if (drifted.length) {
  console.error(
    `${RELATIVE} has drifted from libs/common: ${drifted.join(', ')}.\n` +
      `Regenerate it: ${COMMAND}`,
  );
  process.exit(1);
}

console.log(`${RELATIVE} is up to date`);
