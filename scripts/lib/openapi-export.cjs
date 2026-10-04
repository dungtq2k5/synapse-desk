/**
 * The side-effect-free half of `scripts/export-openapi.mjs`: everything the
 * export decides without producing the document, so a spec can import it.
 *
 * **CommonJS, deliberately** — the shape `jest.swagger-transform.cjs` already
 * has. Jest requires a `.cjs` file as it is, while ts-jest treats a `.mjs` file
 * as an ES module and leaves it untransformed (measured: `Unexpected token
 * 'import'`); and Node's ESM script still imports these as named exports.
 *
 * Nothing here reads the repository, the environment or the network on
 * import. `export-openapi.mjs` does the I/O and calls these.
 *
 * `BUILD_COMMAND`, `RUNTIME_OUTPUTS` and `missingOutputs` are not the export's:
 * the contract harness reads them to refuse a Node gateway it has not built.
 */

'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/** Where the exported document is committed, relative to the repo root. */
const OPENAPI_OUTPUT = 'docs/reference/openapi.json';

/** The command that rebuilds everything the export reads, then writes the file. */
const EXPORT_COMMAND = 'npm run openapi:export';

/** The turbo target that builds the gateway AND the libraries it requires at runtime. */
const BUILD_COMMAND = 'turbo run build --filter=@synapsedesk/api-gateway...';

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

/** The OpenAPI 3.1 schema, `https://spec.openapis.org/oas/3.1/schema/2022-10-07`, vendored. */
const OAS_SCHEMA = join(__dirname, 'oas-3.1-schema.json');

/**
 * Every way the document is not a valid OpenAPI 3.1 document, as readable lines.
 *
 * **Separate from the drift check, and both are needed.** `--check` proves the
 * file MATCHES what the gateway serves; it cannot see that what it serves is
 * invalid. A document that matched the code and was invalid has shipped before:
 * a boolean `required` inside an `items`, every guard green, found only when a
 * code generator refused the file.
 *
 * **Two passes, because of what ajv can resolve.** The OAS schema reaches each
 * Schema Object through `$dynamicRef: "#meta"`, and ajv resolves that reference to
 * the wrong schema (measured: it checked a parameter's `schema` as a Parameter, and
 * failed a valid document 9143 times). So the reference is read as what the
 * unextended schema defines it to be, an object or a boolean, and every Schema
 * Object is then checked on its own against JSON Schema 2020-12, which is the
 * dialect OAS 3.1 uses.
 *
 * And one rule no schema can state: a schema whose `type` allows null must list null
 * in its `enum` ({@link nullContradictions}).
 *
 * Returns [] for a valid document, so a caller reads it as a finding list.
 *
 * @example openapiViolations({ openapi: '3.1.0' }) // ["/: must have required property 'info'"]
 */
function openapiViolations(document) {
  const Ajv2020 = require('ajv/dist/2020').default;
  const addFormats = require('ajv-formats').default;
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
  addFormats(ajv);
  // An OAS format ajv does not know; the media ranges here are Spring's own.
  ajv.addFormat('media-range', true);

  const schema = JSON.parse(
    readFileSync(OAS_SCHEMA, 'utf8').replaceAll(
      '"$dynamicRef": "#meta"',
      '"$ref": "#/$defs/schema"',
    ),
  );
  schema.$defs.schema = { type: ['object', 'boolean'] };
  const validate = ajv.compile(schema);

  const found = [];
  if (!validate(document)) {
    found.push(...validate.errors.map(readable('')));
  }
  for (const [pointer, value] of schemaObjects(document)) {
    if (!ajv.validateSchema(value)) {
      found.push(...ajv.errors.map(readable(pointer)));
    }
    found.push(...nullContradictions(value, pointer));
  }

  return found;
}

/**
 * Every schema, at any depth under `schema`, whose `type` allows `null` and whose
 * `enum` does not list it. Valid JSON Schema, and a contradiction: a value must match
 * BOTH, so null is permitted by one keyword and refused by the other, and client
 * generators resolve that differently.
 */
function nullContradictions(schema, pointer) {
  if (!schema || typeof schema !== 'object') return [];
  const found = [];
  if (
    Array.isArray(schema.type) &&
    schema.type.includes('null') &&
    Array.isArray(schema.enum) &&
    !schema.enum.includes(null)
  ) {
    found.push(
      `${pointer}: its type allows null and its enum does not list it`,
    );
  }
  for (const [key, value] of Object.entries(schema)) {
    found.push(...nullContradictions(value, `${pointer}/${segment(key)}`));
  }

  return found;
}

/** An ajv error as `pointer: message`, under `prefix`. */
const readable = (prefix) => (error) =>
  `${prefix + error.instancePath || '/'}: ${error.message}`;

/** A JSON Pointer segment, escaped. */
const segment = (key) =>
  String(key).replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * Every Schema Object in the document with its JSON Pointer: each named
 * component, and each value of a `schema` key (a parameter's, a media type's).
 * The ones nested inside them are checked as part of them.
 */
function schemaObjects(document) {
  const found = [];
  const named = document?.components?.schemas ?? {};
  for (const [name, value] of Object.entries(named)) {
    found.push([`/components/schemas/${segment(name)}`, value]);
  }

  const walk = (node, pointer) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const here = `${pointer}/${segment(key)}`;
      if (key === 'schema' && value && typeof value === 'object') {
        found.push([here, value]);
      } else {
        walk(value, here);
      }
    }
  };
  walk(document?.paths, '/paths');

  return found;
}

module.exports = {
  OPENAPI_OUTPUT,
  EXPORT_COMMAND,
  BUILD_COMMAND,
  RUNTIME_OUTPUTS,
  missingOutputs,
  firstDifferingLine,
  openapiViolations,
};
