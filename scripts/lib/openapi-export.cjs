/**
 * The side-effect-free half of `scripts/export-openapi.mjs`: everything the
 * export decides without booting the gateway, so a spec can import it.
 *
 * **CommonJS, deliberately** — the shape `jest.swagger-transform.cjs` already
 * has. Jest requires a `.cjs` file as it is, while ts-jest treats a `.mjs` file
 * as an ES module and leaves it untransformed (measured: `Unexpected token
 * 'import'`); and Node's ESM script still imports these as named exports.
 *
 * Nothing here reads the repository, the environment or the network on
 * import. `export-openapi.mjs` does the I/O and calls these. The enum
 * canonicalization is not here: the gateway's e2e suite applies it too, so it
 * is `canonicalizeEnums` in `@synapsedesk/common`.
 */

'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parseEnv } = require('node:util');

/** Where the exported document is committed, relative to the repo root. */
const OPENAPI_OUTPUT = 'docs/reference/openapi.json';

/** The command that rebuilds everything the export reads, then writes the file. */
const EXPORT_COMMAND = 'npm run openapi:export';

/** The turbo target that builds the gateway AND the libraries it requires at runtime. */
const BUILD_COMMAND = 'turbo run build --filter=@synapsedesk/api-gateway...';

/** The env file the export boots from — tracked, and Joi-valid because e2e boots from it. */
const EXPORT_ENV_FILE = 'apps/api-gateway/.env.test';

/**
 * Every build output the export requires at runtime.
 *
 * Three, not one: the built gateway `require`s `@synapsedesk/common` and
 * `@synapsedesk/grpc-proto` through their packages' `main`, which is each
 * library's own `dist/` — not the copies `nest build` emits beside the gateway.
 */
const RUNTIME_OUTPUTS = [
  'apps/api-gateway/dist/apps/api-gateway/src/main.js',
  'libs/common/dist/main.js',
  'libs/grpc-proto/dist/index.js',
];

/**
 * The runtime outputs that do not exist under `root`.
 *
 * **Presence, not freshness.** Freshness by mtime is wrong in both directions
 * here: an incremental `tsc` re-emits only the files that changed, so a correct
 * build leaves `main.js` older than an edited sibling; and a `touch` with no
 * content change is a turbo cache hit that emits nothing, so a correct build
 * leaves every output older than its source forever. Freshness is what the
 * turbo build before the export guarantees — a cache hit restores `dist/` and
 * its build info together (`turbo.json`'s `build.outputs`) to the content the
 * current source hashes to.
 *
 * @example missingOutputs('/repo') // ['libs/grpc-proto/dist/index.js'] when that library was never built
 */
function missingOutputs(root, outputs = RUNTIME_OUTPUTS) {
  return outputs.filter((output) => !existsSync(join(root, output)));
}

/**
 * Assigns every value in an env file OVER `env`, and returns the keys assigned.
 *
 * **Assigned, not loaded.** `process.loadEnvFile` leaves a variable already in
 * the environment alone, so a value exported in a developer's shell or in CI
 * would win over the tracked file — measured, a shell `JWT_ACCESS_NAME` changed
 * the exported document. Assigning makes the file authoritative for every key
 * it contains, and `ConfigModule` never overrides a variable already set, so it
 * cannot reach past these to the root `.env` either.
 *
 * A key NOT in the file can still come from the root `.env`; no key the document
 * reads is in that position today.
 *
 * @example assignEnvFile('A = 1\nB = two', env) // the keys A and B (in parseEnv's order), and env.A === '1' even if it was set
 */
function assignEnvFile(text, env) {
  const values = parseEnv(text);

  for (const [key, value] of Object.entries(values)) {
    env[key] = value;
  }

  return Object.keys(values);
}

/** Reads and assigns an env file from disk; see {@link assignEnvFile}. */
function assignEnvFileAt(path, env) {
  return assignEnvFile(readFileSync(path, 'utf8'), env);
}

/**
 * The 1-based number of the first line where two texts differ, or `null` when
 * they are identical.
 *
 * @example firstDifferingLine('a\nb\n', 'a\nc\n') // 2
 */
function firstDifferingLine(expected, actual) {
  if (expected === actual) return null;

  const left = expected.split('\n');
  const right = actual.split('\n');
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index + 1;
  }

  return length;
}

/**
 * Every way the document is not a valid OpenAPI 3 document, as readable lines.
 *
 * **Separate from the drift check, and both are needed.** `--check` proves the
 * file MATCHES the gateway source; it cannot see that the source produces
 * something invalid. A document that matched the code and was invalid is
 * exactly what shipped: the swagger plugin wrote a boolean `required` inside
 * an `items`, every guard here stayed green, and the defect surfaced only when
 * a code generator refused the file.
 *
 * A real validator rather than rules written from the bug already had — it
 * knows the classes nobody here has thought of, which is the whole failure
 * this had. `openapi-schema-validator` bundles the meta-schemas, so this needs
 * no network, and it is CommonJS, so this file can require it and ts-jest can
 * test it.
 *
 * Returns [] for a valid document, so a caller reads it as a finding list.
 *
 * @example openapiViolations({ openapi: '3.0.0' }) // ["/: must have required property 'info'", …]
 */
function openapiViolations(document) {
  const Validator = require('openapi-schema-validator').default;
  const { errors } = new Validator({ version: 3 }).validate(document);

  return errors.map(
    (error) => `${error.instancePath || '/'}: ${error.message}`,
  );
}

module.exports = {
  OPENAPI_OUTPUT,
  EXPORT_COMMAND,
  BUILD_COMMAND,
  EXPORT_ENV_FILE,
  RUNTIME_OUTPUTS,
  missingOutputs,
  assignEnvFile,
  assignEnvFileAt,
  firstDifferingLine,
  openapiViolations,
};
