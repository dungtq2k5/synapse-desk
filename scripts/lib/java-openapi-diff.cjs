/**
 * The side-effect-free half of `scripts/diff-java-openapi.mjs`: comparing two
 * already-parsed OpenAPI documents, so a spec can import it without booting
 * anything.
 *
 * **`operationId` is deliberately excluded from the comparison.** Node's
 * swagger decorator names operations `ControllerName_method_v1`; springdoc's
 * default naming reads the Java method name verbatim (`controllerMethodV1`).
 * Neither side sets `operationId` by hand, so the two conventions will never
 * converge — comparing it would report a permanent, meaningless diff on
 * every operation. Path and HTTP method are the routing contract;
 * `operationId` is not.
 *
 * **Fixes a real bug, not a style preference.** An earlier ad hoc version of
 * this comparison used `jq`'s `paths(.tags?)` to find operation objects by
 * walking the whole document for any node with a `.tags` key. That silently
 * matched nothing on both the Node and the Java document (verified: it
 * returned `[]` for both), so every comparison built on it was `diff [] []`
 * — a vacuous pass reported as a match. This walks `.paths` directly instead.
 *
 * **Error status codes (4xx/5xx) are compared too**, now that the
 * `ErrorEnvelopeOperationCustomizer` makes Java emit them. Two known,
 * deliberate mismatches will surface here and are not bugs: the 3
 * webhook-endpoints routes documenting a real 201 against Node's stale 200
 * (see the `webhook-endpoints-httpcode-gap` note), and the 2 webhook-intake
 * routes carrying 429 in Java but not in Node, since Java has no throttle
 * exemption to match Node's `@SkipThrottle()` (see
 * `java-throttle-exemption-gap`).
 */

'use strict';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Every {path, method, operationId, statusCodes} row in an OpenAPI document, sorted. */
function extractOperations(document) {
  const rows = [];
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      rows.push({
        path,
        method,
        operationId: operation.operationId ?? null,
        statusCodes: Object.keys(operation.responses ?? {}).sort(),
        successCodes: Object.keys(operation.responses ?? {})
          .filter((code) => code.startsWith('2'))
          .sort(),
        errorCodes: Object.keys(operation.responses ?? {})
          .filter((code) => /^[45]/.test(code))
          .sort(),
      });
    }
  }
  return rows.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

/** path+method as a stable map key. */
function routeKey(row) {
  return `${row.method.toUpperCase()} ${row.path}`;
}

/**
 * Compares two documents on routing (path+method) and success status codes.
 * Error-response status codes (4xx/5xx) are NOT compared here — springdoc
 * does not yet emit them (the error-envelope customizer is separate,
 * pending work), so every route would show a diff there until it lands.
 *
 * Returns `{ missingInJava, extraInJava, statusMismatches, matched }`, all
 * arrays except `matched` (a count). Empty missing/extra/mismatches with a
 * nonzero `matched` is a real pass — the failure mode this replaces produced
 * empty arrays AND a zero `matched` count, which this makes impossible to
 * miss.
 */
function diffOpenApiDocuments(nodeDocument, javaDocument) {
  const nodeRows = extractOperations(nodeDocument);
  const javaRows = extractOperations(javaDocument);

  const nodeByKey = new Map(nodeRows.map((row) => [routeKey(row), row]));
  const javaByKey = new Map(javaRows.map((row) => [routeKey(row), row]));

  const missingInJava = nodeRows
    .filter((row) => !javaByKey.has(routeKey(row)))
    .map(routeKey);
  const extraInJava = javaRows
    .filter((row) => !nodeByKey.has(routeKey(row)))
    .map(routeKey);

  const statusMismatches = [];
  const errorMismatches = [];
  for (const [key, nodeRow] of nodeByKey) {
    const javaRow = javaByKey.get(key);
    if (!javaRow) continue;
    const nodeSuccess = nodeRow.successCodes.join(',');
    const javaSuccess = javaRow.successCodes.join(',');
    if (nodeSuccess !== javaSuccess) {
      statusMismatches.push({
        route: key,
        node: nodeRow.successCodes,
        java: javaRow.successCodes,
      });
    }
    const nodeError = nodeRow.errorCodes.join(',');
    const javaError = javaRow.errorCodes.join(',');
    if (nodeError !== javaError) {
      errorMismatches.push({
        route: key,
        node: nodeRow.errorCodes,
        java: javaRow.errorCodes,
      });
    }
  }

  const matched =
    nodeRows.length - missingInJava.length - statusMismatches.length;

  return {
    missingInJava,
    extraInJava,
    statusMismatches,
    errorMismatches,
    matched,
  };
}

function divergenceKey(kind, route, node, java) {
  return `${kind}|${route}|${node.join(',')}|${java.join(',')}`;
}

/**
 * Holds the status divergences to a pinned list, in BOTH directions.
 *
 * `unexpected` is a divergence the list does not explain — a new one, which
 * is what the check exists to catch. `stale` is a listed divergence that no
 * longer occurs — a fixed one whose entry would otherwise rot, and a rotted
 * entry is how an allowlist stops being a record and becomes a hiding place.
 * An entry matches only on route, kind AND both value sets, so a divergence
 * that changed shape (Java now answers 202) is unexpected AND stale.
 */
function checkKnownDivergences(diff, known) {
  const actual = new Map();
  for (const m of diff.statusMismatches) {
    actual.set(divergenceKey('success', m.route, m.node, m.java), {
      kind: 'success',
      ...m,
    });
  }
  for (const m of diff.errorMismatches) {
    actual.set(divergenceKey('error', m.route, m.node, m.java), {
      kind: 'error',
      ...m,
    });
  }

  const expected = new Map(
    known.map((entry) => [
      divergenceKey(entry.kind, entry.route, entry.node, entry.java),
      entry,
    ]),
  );

  return {
    unexpected: [...actual].filter(([k]) => !expected.has(k)).map(([, v]) => v),
    stale: [...expected].filter(([k]) => !actual.has(k)).map(([, v]) => v),
  };
}

module.exports = {
  extractOperations,
  routeKey,
  diffOpenApiDocuments,
  checkKnownDivergences,
};
