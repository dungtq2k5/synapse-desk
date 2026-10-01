#!/usr/bin/env node
/**
 * Holds the Java gateway's OWN served OpenAPI document to a committed snapshot,
 * schema by schema.
 *
 *   node scripts/check-java-openapi-snapshot.mjs [--file doc.json]   # check
 *   node scripts/check-java-openapi-snapshot.mjs --update            # rewrite the snapshot
 *
 * **Why this exists beside `diff-java-openapi.mjs`.** That script compares
 * routing and status codes against the committed `openapi.json` and nothing
 * else: no schema, constraint, nullability or enum is compared anywhere. A DTO
 * edit that drops a validation annotation, or a model moved from generated to
 * hand-written code that loses one, changes the published document and passes
 * every other check. This one sees it.
 *
 * **What it compares: the document Java serves today, against itself.** Not
 * against Node's committed document, which differs from Java's in half the
 * shared schemas (nullability, `required`, length bounds, defaults) and in 154
 * `ApiResponse*` wrappers. That delta belongs to the ownership flip; this gate
 * exists so a change made BEFORE the flip moves the document only on purpose.
 * An intended change updates the snapshot in the same commit, so the diff of
 * the snapshot IS the statement of what changed.
 *
 * Byte-stable once the one random value is masked: the served document carries
 * the test server's port in `servers[0].url`. Everything else, key order
 * included, is identical run to run, so key order is compared too.
 *
 * Delete this script and `docs/reference/openapi-java.snapshot.json` when the
 * flip makes the committed document the Java gateway's own output: from then on
 * `openapi:check` is this check.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'docs/reference/openapi-java.snapshot.json');
const PRODUCED = join(ROOT, 'apps/api-gateway-java/target/openapi-java.json');
const MAX_LISTED = 40;

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const source = fileIndex === -1 ? PRODUCED : args[fileIndex + 1];

const load = (path) =>
  JSON.parse(
    readFileSync(path, 'utf8').replace(
      /http:\/\/127\.0\.0\.1:\d+/gu,
      'http://HOST',
    ),
  );

/** Every JSON path at which the two documents differ, in document order. */
function differences(expected, actual, path = '#', found = []) {
  if (found.length > MAX_LISTED) return found;
  if (
    expected === null ||
    actual === null ||
    typeof expected !== 'object' ||
    typeof actual !== 'object' ||
    Array.isArray(expected) !== Array.isArray(actual)
  ) {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      found.push(
        `${path}: ${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`,
      );
    }

    return found;
  }

  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    if (!(key in actual)) found.push(`${path}/${key}: removed`);
    else if (!(key in expected)) found.push(`${path}/${key}: added`);
    else differences(expected[key], actual[key], `${path}/${key}`, found);
  }

  if (
    found.length === 0 &&
    JSON.stringify(Object.keys(expected)) !==
      JSON.stringify(Object.keys(actual))
  ) {
    found.push(`${path}: same members, different order`);
  }

  return found;
}

if (args.includes('--update')) {
  writeFileSync(SNAPSHOT, JSON.stringify(load(source), null, 2) + '\n');
  console.log(`wrote ${SNAPSHOT}`);
  process.exit(0);
}

const expected = load(SNAPSHOT);
const actual = load(source);
const found = differences(expected, actual);

if (found.length === 0) {
  console.log('The Java document matches its snapshot.');
  process.exit(0);
}

console.error(
  `The Java document differs from docs/reference/openapi-java.snapshot.json (${found.length > MAX_LISTED ? `first ${MAX_LISTED}` : found.length}):`,
);
for (const line of found.slice(0, MAX_LISTED)) console.error(`  ${line}`);
console.error(
  'If the change is intended, run with --update and commit the snapshot with it.',
);
process.exit(1);
