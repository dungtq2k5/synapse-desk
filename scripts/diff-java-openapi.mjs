#!/usr/bin/env node
/**
 * Compares the Java gateway's live OpenAPI document against the committed
 * `docs/reference/openapi.json` on routing (path+method), success status
 * codes, and error status codes.
 *
 *   node scripts/diff-java-openapi.mjs                          # fetch from localhost:3000
 *   node scripts/diff-java-openapi.mjs --url http://host:port   # fetch from elsewhere
 *   node scripts/diff-java-openapi.mjs --file path/to/doc.json  # compare a saved document
 *
 * **The Java half of the dual-running OpenAPI check** — `npm run
 * openapi:check:java` produces the Java document inside the normal test
 * lifecycle and runs this against it. Node's own `openapi:check` (its export
 * against the committed file, byte for byte) keeps running beside it, so the
 * committed document is held from both implementations at once.
 *
 * **The explained delta is pinned, not filtered.** The 5 status divergences
 * between the two implementations are all deliberate and each is recorded with
 * its reason in `scripts/lib/openapi-known-divergences.json`. The script passes
 * only when the actual divergences EQUAL that list: a new one fails, and so
 * does a listed one that no longer occurs, so the list cannot rot into a place
 * to hide a real difference.
 *
 * **Not in CI yet.** CI has no Java job; wiring this belongs with the Java leg
 * of the `contract` matrix, which needs the same Docker and JDK.
 *
 * **Takes `--url` or `--file`.** `--file` is what `openapi:check:java` uses,
 * because a hand-booted gateway holds ports and collides with the test suite's
 * own — the reason the document is produced by a test, not a running process.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkKnownDivergences,
  diffOpenApiDocuments,
  diffResponseSchemaShapes,
  diffSecurity,
  diffDefaults,
  diffWholeDocument,
  diffOperationIds,
  diffParameterEnums,
  diffRequestSchemaShapes,
} from './lib/java-openapi-diff.cjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DOC_PATH = join(ROOT, 'docs/reference/openapi.json');
const KNOWN_DIVERGENCES_PATH = join(
  ROOT,
  'scripts/lib/openapi-known-divergences.json',
);

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const urlIndex = args.indexOf('--url');
const javaSource =
  fileIndex !== -1
    ? { kind: 'file', value: args[fileIndex + 1] }
    : {
        kind: 'url',
        value:
          urlIndex !== -1
            ? args[urlIndex + 1]
            : 'http://localhost:3000/v3/api-docs',
      };

async function loadJavaDocument() {
  if (javaSource.kind === 'file') {
    return JSON.parse(readFileSync(javaSource.value, 'utf8'));
  }
  const response = await fetch(javaSource.value);
  if (!response.ok) {
    throw new Error(`${javaSource.value} returned ${response.status}`);
  }
  return response.json();
}

try {
  const nodeDocument = JSON.parse(readFileSync(NODE_DOC_PATH, 'utf8'));
  const javaDocument = await loadJavaDocument();

  if (args.includes('--whole')) {
    // The flip's acceptance test, in report form until it is green: every difference
    // in the whole document is either named in the registry or listed here.
    const registry = JSON.parse(
      readFileSync(
        join(ROOT, 'scripts/lib/openapi-document-divergences.json'),
        'utf8',
      ),
    );
    const whole = diffWholeDocument(nodeDocument, javaDocument, registry);
    const groups = {};
    for (const row of whole.unexplained) {
      const signature = row.path
        .replace(/(query|path|header):[^/]+/g, 'PARAM')
        .replace(/properties\/[^/]+/g, 'properties/*')
        .replace(/^responses\/2\d\d/, 'responses/2xx');
      (groups[signature] ||= []).push(row);
    }
    console.log(
      `${whole.differences} differences: ${whole.differences - whole.unexplained.length} named, ${whole.unexplained.length} UNEXPLAINED, ${whole.stale.length} stale registry entr(ies)`,
    );
    for (const [id, count] of Object.entries(whole.explained)) {
      console.log(`  named ${String(count).padStart(4)}  ${id}`);
    }
    for (const id of whole.stale) console.log(`  STALE        ${id}`);
    for (const [signature, rows] of Object.entries(groups).sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      const e = rows[0];
      console.log(
        `  unexplained ${String(rows.length).padStart(4)}  ${signature}   e.g. ${e.where}: node=${JSON.stringify(e.node)?.slice(0, 50)} java=${JSON.stringify(e.java)?.slice(0, 50)}`,
      );
    }
    process.exit(whole.unexplained.length || whole.stale.length ? 1 : 0);
  }

  const {
    missingInJava,
    extraInJava,
    statusMismatches,
    errorMismatches,
    matched,
  } = diffOpenApiDocuments(nodeDocument, javaDocument);

  console.log(`${matched} routes match on path, method, and success status.`);

  let failed = false;

  if (missingInJava.length) {
    failed = true;
    console.error(
      `\n${missingInJava.length} route(s) in the committed document have no Java equivalent:`,
    );
    for (const route of missingInJava) console.error(`  ${route}`);
  }

  if (extraInJava.length) {
    failed = true;
    console.error(
      `\n${extraInJava.length} route(s) exist in Java but not in the committed document:`,
    );
    for (const route of extraInJava) console.error(`  ${route}`);
  }

  // The 5 explained divergences are pinned in `openapi-known-divergences.json`.
  // Held in BOTH directions: an unexplained one fails, and so does a listed one
  // that no longer occurs, so the list can only ever be a current record.
  const known = JSON.parse(readFileSync(KNOWN_DIVERGENCES_PATH, 'utf8'));
  const { unexpected, stale } = checkKnownDivergences(
    { statusMismatches, errorMismatches },
    known,
  );

  if (unexpected.length) {
    failed = true;
    console.error(
      `\n${unexpected.length} divergence(s) the known list does not explain:`,
    );
    for (const { kind, route, node, java } of unexpected) {
      console.error(
        `  [${kind}] ${route}: doc=${node.join(',')} java=${java.join(',')}`,
      );
    }
  }

  if (stale.length) {
    failed = true;
    console.error(
      `\n${stale.length} pinned divergence(s) no longer occur — remove them from ${KNOWN_DIVERGENCES_PATH}:`,
    );
    for (const { kind, route } of stale) console.error(`  [${kind}] ${route}`);
  }

  // Which response properties are required and which accept null: an EQUALITY over
  // every schema only responses reach and both documents have, no exception list.
  // The one envelope difference (`warning`) is named and held from both sides.
  const shapes = diffResponseSchemaShapes(nodeDocument, javaDocument);

  if (shapes.mismatches.length) {
    failed = true;
    console.error(
      `\n${shapes.mismatches.length} response schema property(ies) differ in required or nullable:`,
    );
    for (const row of shapes.mismatches.slice(0, 40)) {
      console.error(`  ${row.schema}.${row.property}: ${JSON.stringify(row)}`);
    }
  }
  if (shapes.envelope.wrappersNotRequiredAndNullable.length) {
    failed = true;
    console.error(
      `\n${shapes.envelope.wrappersNotRequiredAndNullable.length} envelope wrapper(s) do not publish warning as required and nullable:`,
    );
    for (const name of shapes.envelope.wrappersNotRequiredAndNullable) {
      console.error(`  ${name}`);
    }
  }
  if (!shapes.envelope.nodePublishesWarningOptional) {
    failed = true;
    console.error(
      '\nNode no longer publishes the envelope warning as optional, so the named divergence is stale: remove it from diffResponseSchemaShapes.',
    );
  }

  const security = diffSecurity(nodeDocument, javaDocument);

  if (security.mismatches.length) {
    failed = true;
    console.error(
      `\n${security.mismatches.length} operation(s) differ in the credential they publish:`,
    );
    for (const row of security.mismatches.slice(0, 40)) {
      console.error(`  ${row.route}: ${JSON.stringify(row)}`);
    }
  }

  const ids = diffOperationIds(nodeDocument, javaDocument);

  if (ids.mismatches.length) {
    failed = true;
    console.error(
      `\n${ids.mismatches.length} operation(s) publish a different operationId:`,
    );
    for (const row of ids.mismatches.slice(0, 40)) {
      console.error(`  ${row.route}: ${JSON.stringify(row)}`);
    }
  }

  const requests = diffRequestSchemaShapes(nodeDocument, javaDocument);

  if (requests.mismatches.length) {
    failed = true;
    console.error(
      `\n${requests.mismatches.length} request schema difference(s) in required, property set or null:`,
    );
    for (const row of requests.mismatches.slice(0, 40)) {
      console.error(
        `  ${row.schema}.${row.property ?? ''}: ${JSON.stringify(row)}`,
      );
    }
  }
  if (requests.nodeNullableStale) {
    failed = true;
    console.error(
      `\nNode's nullable request properties are no longer the six on record, so the named divergence is stale: ${JSON.stringify(requests.nodeNullable)}`,
    );
  }
  for (const side of ['node', 'java']) {
    if (requests.nullableParameters[side].length) {
      failed = true;
      console.error(
        `\n${requests.nullableParameters[side].length} parameter(s) in the ${side} document accept null, which a URL cannot carry:`,
      );
      for (const row of requests.nullableParameters[side].slice(0, 40)) {
        console.error(`  ${row}`);
      }
    }
  }

  const enums = diffParameterEnums(nodeDocument, javaDocument);

  if (enums.mismatches.length) {
    failed = true;
    console.error(
      `\n${enums.mismatches.length} parameter(s) publish a different enum:`,
    );
    for (const row of enums.mismatches.slice(0, 40)) {
      console.error(`  ${row.where}: ${JSON.stringify(row).slice(0, 300)}`);
    }
  }

  const defaults = diffDefaults(nodeDocument, javaDocument);

  if (defaults.mismatches.length) {
    failed = true;
    console.error(
      `\n${defaults.mismatches.length} property or parameter default(s) differ:`,
    );
    for (const row of defaults.mismatches.slice(0, 40)) {
      console.error(`  ${row.where}: ${JSON.stringify(row)}`);
    }
  }

  if (!failed) {
    console.log(`${ids.matched} operations publish the same operationId.`);
    console.log(
      `${enums.compared} parameters with an enum publish the same set in both documents.`,
    );
    console.log(
      `${defaults.compared} properties and parameters agree on their default, ${defaults.published} of them with one.`,
    );
    console.log(
      `${requests.properties} request properties in ${requests.schemas} schemas agree on required and property set, and every optional one is nullable in Java (Node: ${requests.nodeNullable.length} of them, the named divergence); no parameter accepts null in either document.`,
    );
    console.log(
      `${security.matched} operations publish the same security as the committed document; ${security.named} named divergences (Node omits it on three routes it guards; Java publishes logout as public).`,
    );
    console.log(
      `${known.length} known divergence(s) all accounted for, none unexplained.`,
    );
    console.log(
      `${shapes.properties} response properties in ${shapes.schemas} schemas agree with the committed document on required and nullable; ${shapes.envelope.wrappers} envelope wrappers publish warning as required and nullable (Node: optional), the one named divergence.`,
    );
  }

  process.exit(failed ? 1 : 0);
} catch (error) {
  console.error('The comparison failed to run:');
  console.error(error);
  process.exit(1);
}
