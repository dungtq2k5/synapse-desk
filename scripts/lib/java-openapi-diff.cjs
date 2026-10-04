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

/**
 * The request properties Node's document publishes as nullable, all of them: the date of
 * birth and phone number on a user update, and the three settings overrides, which Node's
 * handlers read `null` as an instruction for ("clear this"). Every other optional request
 * property accepts `null` too (measured on both gateways), and Node's document does not
 * say so. Held from BOTH sides: the set of Node's nullable request properties must be
 * exactly this, so a Node document that starts saying more makes the record stale.
 */
const NODE_NULLABLE_REQUEST_PROPERTIES = [
  'UpdateOrganizationSettingsDto.maxAttachmentBytesOverride',
  'UpdateOrganizationSettingsDto.maxAttachmentsPerMessageOverride',
  'UpdateOrganizationSettingsDto.maxDocumentBytesOverride',
  'UpdateOwnProfileDto.dob',
  'UpdateUserDto.dob',
  'UpdateUserDto.phoneNumber',
];

/** Every parameter, in a document, whose schema accepts null: `[METHOD path name]`. */
function nullableParameters(document) {
  const found = [];
  for (const [path, methods] of Object.entries(document.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const parameter of operation.parameters || []) {
        if (parameter.schema && acceptsNull(parameter.schema)) {
          found.push(`${method} ${path} ${parameter.name}`);
        }
      }
    }
  }

  return found.sort();
}

/**
 * Compares, for every schema that ONLY requests reach and that both documents have, the
 * `required` set, the property set, and what each property says about null; and what
 * either document says about null for a URL parameter.
 *
 * <p>The two documents agree on required and on the property set, with no exception: a
 * request field that is required in one and optional in the other changes what a client
 * must send. On null the rule is Java's, because it is the measured one: an optional
 * property accepts null (so it is nullable), a required one does not, and no parameter
 * does (a query string cannot carry one). Node's document says "not nullable" for all but
 * six, which is the named divergence held above, from both sides.
 */
function diffRequestSchemaShapes(nodeDocument, javaDocument) {
  const nodeSchemas = nodeDocument.components.schemas;
  const javaSchemas = javaDocument.components.schemas;
  const node = reachableSchemas(nodeDocument);
  const java = reachableSchemas(javaDocument);

  const shared = [...node.request]
    .filter(
      (name) =>
        javaSchemas[name] && java.request.has(name) && !java.response.has(name),
    )
    .filter((name) => !node.response.has(name))
    .sort();
  const mismatches = [];
  const nodeNullable = [];
  let properties = 0;

  for (const name of shared) {
    const nodeRequired = new Set(nodeSchemas[name].required || []);
    const javaRequired = new Set(javaSchemas[name].required || []);
    const nodeProperties = nodeSchemas[name].properties || {};
    const javaProperties = javaSchemas[name].properties || {};

    if ([...nodeRequired].sort().join() !== [...javaRequired].sort().join()) {
      mismatches.push({ schema: name, kind: 'required set' });
    }
    if (
      Object.keys(nodeProperties).sort().join() !==
      Object.keys(javaProperties).sort().join()
    ) {
      mismatches.push({ schema: name, kind: 'property set' });
      continue;
    }

    for (const key of Object.keys(javaProperties)) {
      properties += 1;
      const javaNull = acceptsNull(javaProperties[key]);
      if (acceptsNull(nodeProperties[key])) nodeNullable.push(`${name}.${key}`);
      if (javaRequired.has(key) && javaNull) {
        mismatches.push({
          schema: name,
          property: key,
          kind: 'required but nullable',
        });
      }
      if (!javaRequired.has(key) && !javaNull) {
        mismatches.push({
          schema: name,
          property: key,
          kind: 'optional but not nullable',
        });
      }
    }
  }

  nodeNullable.sort();

  return {
    schemas: shared.length,
    properties,
    mismatches,
    nodeNullable,
    nodeNullableStale:
      nodeNullable.join() !== NODE_NULLABLE_REQUEST_PROPERTIES.join(),
    nullableParameters: {
      node: nullableParameters(nodeDocument),
      java: nullableParameters(javaDocument),
    },
  };
}

/**
 * Compares the `default` of every property in a schema both documents have, and of every
 * parameter they share: an EQUALITY, with no exception, in BOTH directions. A default the
 * committed document gives and Java does not leaves a client believing that leaving a
 * field out and sending the default differ; a default Java invents is a claim nothing
 * holds. The behaviour behind each published default is held by the request-defaults
 * contract rows (the field absent and the field sent as its default are the same request).
 */
function diffDefaults(nodeDocument, javaDocument) {
  const mismatches = [];
  let compared = 0;
  let published = 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const [name, nodeSchema] of Object.entries(
    nodeDocument.components.schemas,
  )) {
    const javaSchema = javaDocument.components.schemas[name];
    if (!javaSchema) continue;
    const nodeProperties = nodeSchema.properties || {};
    const javaProperties = javaSchema.properties || {};

    for (const key of Object.keys(nodeProperties)) {
      if (!(key in javaProperties)) continue;
      compared += 1;
      const node = nodeProperties[key].default;
      const java = javaProperties[key].default;
      if (node !== undefined) published += 1;
      if (!same(node, java)) {
        mismatches.push({ where: `${name}.${key}`, node, java });
      }
    }
  }

  for (const [path, methods] of Object.entries(nodeDocument.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const javaOperation = ((javaDocument.paths || {})[path] || {})[method];
      if (!javaOperation) continue;
      for (const parameter of operation.parameters || []) {
        const match = (javaOperation.parameters || []).find(
          (candidate) =>
            candidate.name === parameter.name && candidate.in === parameter.in,
        );
        if (!match) continue;
        compared += 1;
        const node = (parameter.schema || {}).default;
        const java = (match.schema || {}).default;
        if (node !== undefined) published += 1;
        if (!same(node, java)) {
          mismatches.push({
            where: `${method} ${path} ${parameter.name}`,
            node,
            java,
          });
        }
      }
    }
  }

  return { compared, published, mismatches };
}

/**
 * Compares the `enum` of every parameter both documents share: an EQUALITY, with no
 * exception, ignoring order. A parameter the committed document restricts and Java
 * publishes as a bare string tells a generated client any value will do; the refusal
 * behind each enum is held by the query-enum contract rows.
 */
function diffParameterEnums(nodeDocument, javaDocument) {
  const mismatches = [];
  let compared = 0;
  const sorted = (values) => JSON.stringify(values ? [...values].sort() : null);

  for (const [path, methods] of Object.entries(nodeDocument.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const javaOperation = ((javaDocument.paths || {})[path] || {})[method];
      if (!javaOperation) continue;
      for (const parameter of operation.parameters || []) {
        const match = (javaOperation.parameters || []).find(
          (candidate) =>
            candidate.name === parameter.name && candidate.in === parameter.in,
        );
        if (!match) continue;
        const node = (parameter.schema || {}).enum;
        const java = (match.schema || {}).enum;
        if (!node && !java) continue;
        compared += 1;
        if (sorted(node) !== sorted(java)) {
          mismatches.push({
            where: `${method} ${path} ${parameter.name}`,
            node: node ?? null,
            java: java ?? null,
          });
        }
      }
    }
  }

  return { compared, mismatches };
}

/**
 * The WHOLE document, compared semantically, against a registry of named divergences.
 *
 * Every operation's request and responses are fully dereferenced, so Java's named
 * envelope wrappers compare against Node's inline ones; nullability is compared by
 * meaning (3.0 `nullable` against 3.1 `type: [..., "null"]` or `oneOf` with null); key
 * order is ignored; and four spellings that say the same thing are made equal before
 * comparing (an empty `parameters` list against none, `additionalProperties: true`
 * against `{}`, an empty `contact`, an empty `tags`). Every other difference is either
 * named in the registry or UNEXPLAINED.
 *
 * The registry is held from both sides: an entry pins the Node and Java values where
 * they are constant (so a change on either side stops matching), and an entry that
 * matches nothing is STALE. When this reports nothing unexplained and nothing stale,
 * the delta between the two documents is enumerated by a check rather than by a person.
 */
function derefSchema(document, schema, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema))
    return schema.map((item) => derefSchema(document, item, seen));
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    if (seen.has(name)) return { $cycle: name };
    const merged = {
      ...derefSchema(
        document,
        document.components.schemas[name],
        new Set([...seen, name]),
      ),
    };
    for (const [key, value] of Object.entries(schema)) {
      if (key !== '$ref') merged[key] = derefSchema(document, value, seen);
    }

    return merged;
  }
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = derefSchema(document, value, seen);
  }

  return out;
}

function normaliseSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normaliseSchema);
  let x = { ...schema };
  let nullable = false;
  if (x.nullable === true) {
    nullable = true;
    delete x.nullable;
  }
  if (x.type === 'null') {
    nullable = true;
    delete x.type;
  }
  if (Array.isArray(x.type)) {
    if (x.type.includes('null')) nullable = true;
    const rest = x.type.filter((type) => type !== 'null');
    x.type = rest.length === 1 ? rest[0] : rest.sort();
  }
  const isNull = (branch) =>
    branch && branch.type === 'null' && Object.keys(branch).length === 1;
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(x[key]) && x[key].some(isNull)) {
      nullable = true;
      const rest = x[key].filter((branch) => !isNull(branch));
      delete x[key];
      if (rest.length === 1) x = { ...rest[0], ...x };
      else x[key] = rest;
    }
  }
  if (Array.isArray(x.allOf) && x.allOf.length === 1) {
    const inner = x.allOf[0];
    delete x.allOf;
    x = { ...inner, ...x };
  }
  if (x.additionalProperties === true) x.additionalProperties = {};
  if (Array.isArray(x.enum)) x.enum = x.enum.filter((value) => value !== null);
  const out = {};
  for (const key of Object.keys(x).sort()) out[key] = normaliseSchema(x[key]);
  if (nullable) out.$nullable = true;
  if (Array.isArray(out.required)) out.required = [...out.required].sort();

  return out;
}

function normaliseOperation(document, operation) {
  const copy = JSON.parse(JSON.stringify(operation));
  if (copy.parameters && copy.parameters.length === 0) delete copy.parameters;
  if (copy.parameters) {
    copy.parameters = Object.fromEntries(
      copy.parameters.map((parameter) => [
        `${parameter.in}:${parameter.name}`,
        normaliseSchema(derefSchema(document, parameter)),
      ]),
    );
  }
  if (copy.requestBody)
    copy.requestBody = normaliseSchema(derefSchema(document, copy.requestBody));
  if (copy.responses) {
    copy.responses = Object.fromEntries(
      Object.entries(copy.responses).map(([status, response]) => [
        status,
        normaliseSchema(derefSchema(document, response)),
      ]),
    );
  }

  return copy;
}

function walkDifferences(a, b, path, where, into) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const objects =
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b);
  if (objects) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walkDifferences(a[key], b[key], [...path, key], where, into);
    }

    return;
  }
  into.push({ where, path: path.join('/'), node: a ?? null, java: b ?? null });
}

const EMPTY = (value) =>
  value == null ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0);

function wholeDocumentDifferences(nodeDocument, javaDocument) {
  const found = [];
  for (const key of new Set([
    ...Object.keys(nodeDocument),
    ...Object.keys(javaDocument),
  ])) {
    if (key === 'paths' || key === 'components') continue;
    if (key === 'tags' && EMPTY(nodeDocument.tags) && EMPTY(javaDocument.tags))
      continue;
    const node = key === 'info' ? { ...nodeDocument.info } : nodeDocument[key];
    const java = key === 'info' ? { ...javaDocument.info } : javaDocument[key];
    if (key === 'info') {
      if (EMPTY(node.contact)) delete node.contact;
      if (EMPTY(java.contact)) delete java.contact;
    }
    walkDifferences(node, java, [key], 'document', found);
  }
  for (const key of new Set([
    ...Object.keys(nodeDocument.components),
    ...Object.keys(javaDocument.components),
  ])) {
    if (key === 'schemas') continue;
    walkDifferences(
      nodeDocument.components[key],
      javaDocument.components[key],
      ['components', key],
      'document',
      found,
    );
  }
  for (const [path, methods] of Object.entries(nodeDocument.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const route = `${method} ${path}`;
      const java = ((javaDocument.paths || {})[path] || {})[method];
      if (!java) {
        found.push({ where: route, path: '', node: 'operation', java: null });
        continue;
      }
      walkDifferences(
        normaliseOperation(nodeDocument, operation),
        normaliseOperation(javaDocument, java),
        [],
        route,
        found,
      );
    }
  }
  for (const [path, methods] of Object.entries(javaDocument.paths || {})) {
    for (const method of Object.keys(methods)) {
      if (!(nodeDocument.paths[path] || {})[method]) {
        found.push({
          where: `${method} ${path}`,
          path: '',
          node: null,
          java: 'operation',
        });
      }
    }
  }

  return found;
}

/** Whether a registry entry names this difference: its route, its path, and its values. */
function entryMatches(entry, difference) {
  if (entry.where && !new RegExp(entry.where, 'u').test(difference.where))
    return false;
  if (!new RegExp(entry.path, 'u').test(difference.path)) return false;
  for (const side of ['node', 'java']) {
    if (!(side in entry) || entry[side] === '*') continue;
    if (JSON.stringify(entry[side]) !== JSON.stringify(difference[side]))
      return false;
  }

  return true;
}

function diffWholeDocument(nodeDocument, javaDocument, registry) {
  const differences = wholeDocumentDifferences(nodeDocument, javaDocument);
  const explained = Object.fromEntries(registry.map((entry) => [entry.id, 0]));
  const unexplained = [];
  for (const difference of differences) {
    const entry = registry.find((candidate) =>
      entryMatches(candidate, difference),
    );
    if (entry) explained[entry.id] += 1;
    else unexplained.push(difference);
  }

  return {
    differences: differences.length,
    explained,
    unexplained,
    stale: registry
      .filter((entry) => explained[entry.id] === 0)
      .map((entry) => entry.id),
  };
}

module.exports = {
  diffResponseSchemaShapes,
  diffSecurity,
  diffDefaults,
  diffWholeDocument,
  diffParameterEnums,
  diffRequestSchemaShapes,
  diffOperationIds,
  extractOperations,
  routeKey,
  diffOpenApiDocuments,
  checkKnownDivergences,
};
