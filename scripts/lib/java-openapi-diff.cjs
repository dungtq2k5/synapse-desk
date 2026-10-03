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

/** Every schema name a node of a document points at, anywhere inside it. */
function refsIn(node, into) {
  if (Array.isArray(node)) {
    for (const item of node) refsIn(item, into);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        into.add(value.split('/').pop());
      } else {
        refsIn(value, into);
      }
    }
  }
}

/** The schemas reachable from `seeds`, through each schema's own references. */
function schemaClosure(schemas, seeds) {
  const seen = new Set();
  const pending = [...seeds];
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name) || !schemas[name]) continue;
    seen.add(name);
    const next = new Set();
    refsIn(schemas[name], next);
    pending.push(...next);
  }

  return seen;
}

/** Schemas reachable from a request body, and from a success response. */
function reachableSchemas(document) {
  const schemas = (document.components && document.components.schemas) || {};
  const fromRequests = new Set();
  const fromResponses = new Set();
  for (const methods of Object.values(document.paths || {})) {
    for (const operation of Object.values(methods)) {
      refsIn(operation.requestBody || {}, fromRequests);
      for (const [status, response] of Object.entries(
        operation.responses || {},
      )) {
        if (status.startsWith('2')) refsIn(response, fromResponses);
      }
    }
  }

  return {
    request: schemaClosure(schemas, fromRequests),
    response: schemaClosure(schemas, fromResponses),
  };
}

/** Whether a property schema accepts null, in either spelling (3.0 `nullable`, 3.1 type list or `oneOf` with null). */
function acceptsNull(property) {
  if (property.nullable === true) return true;
  if (Array.isArray(property.type) && property.type.includes('null')) {
    return true;
  }

  return [...(property.oneOf || []), ...(property.anyOf || [])].some(
    (branch) => branch && branch.type === 'null',
  );
}

/**
 * Compares, for every schema that ONLY responses reach and that both documents
 * have, which properties are required and which accept null: the two claims a
 * generated client acts on (may the key be absent, may the value be null).
 *
 * <p>The comparison is an EQUALITY with no exception list, and one named
 * divergence is held on its own: the envelope wrappers are Java-only schemas
 * (Node inlines its envelope in each response), so they are outside the
 * comparison, and `warning` is the one envelope property where the two documents
 * differ on purpose. Node publishes it optional and nullable; both gateways send
 * the key on every response (`null` when there is nothing to say), so Java
 * publishes it required and nullable. Held from BOTH sides: a Java wrapper that
 * stops publishing it that way fails, and so does a Node document that starts
 * calling it required, because then the divergence record is stale.
 */
function diffResponseSchemaShapes(nodeDocument, javaDocument) {
  const nodeSchemas = nodeDocument.components.schemas;
  const javaSchemas = javaDocument.components.schemas;
  const node = reachableSchemas(nodeDocument);
  const java = reachableSchemas(javaDocument);

  const shared = [...node.response]
    .filter((name) => javaSchemas[name] && !java.request.has(name))
    .sort();
  const mismatches = [];
  let properties = 0;

  for (const name of shared) {
    const nodeRequired = new Set(nodeSchemas[name].required || []);
    const javaRequired = new Set(javaSchemas[name].required || []);
    const nodeProperties = nodeSchemas[name].properties || {};
    const javaProperties = javaSchemas[name].properties || {};

    for (const key of new Set([
      ...Object.keys(nodeProperties),
      ...Object.keys(javaProperties),
    ])) {
      if (!(key in nodeProperties) || !(key in javaProperties)) {
        mismatches.push({ schema: name, property: key, kind: 'property set' });
        continue;
      }
      properties += 1;
      if (nodeRequired.has(key) !== javaRequired.has(key)) {
        mismatches.push({
          schema: name,
          property: key,
          kind: 'required',
          node: nodeRequired.has(key),
          java: javaRequired.has(key),
        });
      }
      if (
        acceptsNull(nodeProperties[key]) !== acceptsNull(javaProperties[key])
      ) {
        mismatches.push({
          schema: name,
          property: key,
          kind: 'nullable',
          node: acceptsNull(nodeProperties[key]),
          java: acceptsNull(javaProperties[key]),
        });
      }
    }
  }

  const wrappers = Object.keys(javaSchemas).filter(
    (name) =>
      name.startsWith('ApiResponse') &&
      Object.hasOwn(javaSchemas[name].properties || {}, 'warning'),
  );
  const wrappersNotRequiredAndNullable = wrappers.filter((name) => {
    const schema = javaSchemas[name];

    return !(
      (schema.required || []).includes('warning') &&
      acceptsNull(schema.properties.warning)
    );
  });

  let nodePublishesWarningOptional = false;
  for (const methods of Object.values(nodeDocument.paths || {})) {
    for (const operation of Object.values(methods)) {
      const ok = (operation.responses || {})['200'];
      const schema =
        ok && ok.content && ok.content['application/json']
          ? ok.content['application/json'].schema
          : undefined;
      if (schema && schema.properties && schema.properties.warning) {
        nodePublishesWarningOptional =
          !(schema.required || []).includes('warning') &&
          acceptsNull(schema.properties.warning);
        break;
      }
    }
    if (nodePublishesWarningOptional) break;
  }

  return {
    schemas: shared.length,
    properties,
    mismatches,
    envelope: {
      wrappers: wrappers.length,
      wrappersNotRequiredAndNullable,
      nodePublishesWarningOptional,
    },
  };
}

/**
 * Compares what each document says a route needs in order to be called.
 *
 * <p>An EQUALITY over every operation both documents share (the three
 * `components.securitySchemes` included, key order aside), with one named
 * divergence: three routes Node guards but publishes no `security` for (they
 * carry no auth decorator in its document; its guard still refuses an anonymous
 * caller, which the anonymous-caller contract rows hold), where Java publishes
 * the session cookie. Held from BOTH sides: Java must publish exactly that, and a
 * Node document that starts publishing `security` for one of them makes the
 * record stale.
 */
const NODE_OMITS_SECURITY = [
  'get /api/v1/feedback',
  'get /api/v1/platform/audit-logs',
  'get /api/v1/platform/audit-logs/actions',
];

/**
 * The one route Node publishes as secured and Java publishes as public, on purpose:
 * `POST /auth/logout` answers 200 to a caller with no session (there is nothing to
 * revoke, and it clears the cookies regardless), so Node's `access-cookie` is the
 * stale side. Held from BOTH sides, like the omissions above.
 */
const JAVA_PUBLISHES_OPEN = ['post /api/v1/auth/logout'];

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function diffSecurity(nodeDocument, javaDocument) {
  const mismatches = [];
  let matched = 0;

  if (
    sortedJson(nodeDocument.components.securitySchemes) !==
    sortedJson(javaDocument.components.securitySchemes)
  ) {
    mismatches.push({ route: 'securitySchemes', kind: 'schemes' });
  }

  for (const [path, methods] of Object.entries(nodeDocument.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const java = ((javaDocument.paths || {})[path] || {})[method];
      if (!java) continue;
      const route = `${method} ${path}`;
      if (NODE_OMITS_SECURITY.includes(route)) {
        const javaCookie =
          sortedJson(java.security) === sortedJson([{ 'access-cookie': [] }]);
        if (operation.security !== undefined || !javaCookie) {
          mismatches.push({ route, kind: 'named divergence stale or broken' });
        }
        continue;
      }
      if (JAVA_PUBLISHES_OPEN.includes(route)) {
        const nodeSecured =
          sortedJson(operation.security) ===
          sortedJson([{ 'access-cookie': [] }]);
        if (!nodeSecured || sortedJson(java.security) !== sortedJson([])) {
          mismatches.push({ route, kind: 'named divergence stale or broken' });
        }
        continue;
      }
      if (sortedJson(operation.security) === sortedJson(java.security)) {
        matched += 1;
      } else {
        mismatches.push({
          route,
          kind: 'security',
          node: operation.security,
          java: java.security,
        });
      }
    }
  }

  return {
    matched,
    named: NODE_OMITS_SECURITY.length + JAVA_PUBLISHES_OPEN.length,
    mismatches,
  };
}

/**
 * Compares each shared operation's `operationId`: an EQUALITY, no exceptions. A
 * generated client names its methods from this id, so a different spelling is a
 * different published contract.
 */
function diffOperationIds(nodeDocument, javaDocument) {
  const mismatches = [];
  let matched = 0;

  for (const [path, methods] of Object.entries(nodeDocument.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const java = ((javaDocument.paths || {})[path] || {})[method];
      if (!java) continue;
      if (operation.operationId === java.operationId) {
        matched += 1;
      } else {
        mismatches.push({
          route: `${method} ${path}`,
          node: operation.operationId,
          java: java.operationId,
        });
      }
    }
  }

  return { matched, mismatches };
}

module.exports = {
  diffResponseSchemaShapes,
  diffSecurity,
  diffOperationIds,
  extractOperations,
  routeKey,
  diffOpenApiDocuments,
  checkKnownDivergences,
};
