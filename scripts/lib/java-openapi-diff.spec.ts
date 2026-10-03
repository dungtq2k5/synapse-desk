import {
  checkKnownDivergences,
  diffOpenApiDocuments,
  diffResponseSchemaShapes,
  diffSecurity,
  extractOperations,
} from './java-openapi-diff.cjs';

/**
 * The Java/Node OpenAPI comparison's decisions, without booting anything.
 *
 * **This suite exists because the previous version of this comparison
 * (an ad hoc `jq paths(.tags?)` one-liner, never committed) returned `[]`
 * for BOTH documents on every route, so `diff [] []` reported a match for
 * an entire session's worth of migration batches without ever comparing a
 * single operation.** The fix was verified once, by hand, against three
 * known mismatches — the right check, but not a repeatable one. A
 * comparison that reports "matched" is itself a guard, and this project's
 * rule for guards is that they must be shown to go red: every test below
 * that asserts a real document pair matches is paired with one asserting a
 * broken pair does NOT.
 */
describe('diffOpenApiDocuments', () => {
  const op = (
    overrides: Partial<{
      operationId: string;
      responses: Record<string, unknown>;
    }> = {},
  ) => ({
    operationId: 'op',
    responses: { '200': {} },
    ...overrides,
  });

  it('reports every route matched when both documents agree on path, method, and success status', () => {
    const nodeDocument = {
      paths: {
        '/api/v1/widgets': {
          get: op({ operationId: 'WidgetsController_list_v1' }),
        },
      },
    };
    const javaDocument = {
      paths: {
        '/api/v1/widgets': {
          get: op({ operationId: 'widgetsControllerListV1' }),
        },
      },
    };

    const result = diffOpenApiDocuments(nodeDocument, javaDocument);

    expect(result).toEqual({
      missingInJava: [],
      extraInJava: [],
      statusMismatches: [],
      errorMismatches: [],
      matched: 1,
    });
  });

  it('**catches a route the committed document has and Java does not** — the exact shape `paths(.tags?)` silently missed', () => {
    const nodeDocument = {
      paths: {
        '/api/v1/widgets': { get: op() },
        '/api/v1/widgets/{id}': { delete: op() },
      },
    };
    const javaDocument = {
      paths: {
        '/api/v1/widgets': { get: op() },
        // `/api/v1/widgets/{id}` DELETE never migrated — a real regression.
      },
    };

    const result = diffOpenApiDocuments(nodeDocument, javaDocument);

    expect(result.missingInJava).toEqual(['DELETE /api/v1/widgets/{id}']);
    expect(result.matched).toBe(1);
  });

  it('catches a route Java serves that the committed document does not (an undocumented addition)', () => {
    const nodeDocument = { paths: { '/api/v1/widgets': { get: op() } } };
    const javaDocument = {
      paths: {
        '/api/v1/widgets': { get: op() },
        '/api/v1/widgets/draft': { post: op() },
      },
    };

    const result = diffOpenApiDocuments(nodeDocument, javaDocument);

    expect(result.extraInJava).toEqual(['POST /api/v1/widgets/draft']);
  });

  it('**catches a success-status mismatch** — the actual bug this comparison found in `webhook-endpoints`', () => {
    const nodeDocument = {
      paths: { '/api/v1/widgets': { post: op({ responses: { '200': {} } }) } },
    };
    const javaDocument = {
      paths: { '/api/v1/widgets': { post: op({ responses: { '201': {} } }) } },
    };

    const result = diffOpenApiDocuments(nodeDocument, javaDocument);

    expect(result.statusMismatches).toEqual([
      { route: 'POST /api/v1/widgets', node: ['200'], java: ['201'] },
    ]);
    expect(result.matched).toBe(0);
  });

  it('ignores `operationId` differences — Node and springdoc use unrelated naming conventions', () => {
    const nodeDocument = {
      paths: {
        '/api/v1/widgets': {
          get: op({ operationId: 'WidgetsController_list_v1' }),
        },
      },
    };
    const javaDocument = {
      paths: {
        '/api/v1/widgets': {
          get: op({ operationId: 'widgetsControllerListV1' }),
        },
      },
    };

    const result = diffOpenApiDocuments(nodeDocument, javaDocument);

    expect(result.missingInJava).toEqual([]);
    expect(result.statusMismatches).toEqual([]);
  });

  it('reports every route matched (including errors) when both documents agree on error status codes too', () => {
    const nodeDocument = {
      paths: {
        '/api/v1/widgets': {
          get: op({ responses: { '200': {}, '401': {}, '500': {} } }),
        },
      },
    };
    const javaDocument = {
      paths: {
        '/api/v1/widgets': {
          get: op({ responses: { '200': {}, '401': {}, '500': {} } }),
        },
      },
    };

    const result = diffOpenApiDocuments(nodeDocument, javaDocument);

    expect(result.errorMismatches).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it('**catches an error-status-code mismatch**, now that the error-envelope customizer makes Java emit 4xx/5xx', () => {
    const nodeDocument = {
      paths: {
        '/api/v1/widgets': {
          get: op({ responses: { '200': {}, '401': {}, '500': {} } }),
        },
      },
    };
    const javaDocument = {
      paths: {
        '/api/v1/widgets': { get: op({ responses: { '200': {}, '500': {} } }) },
      },
    };

    const result = diffOpenApiDocuments(nodeDocument, javaDocument);

    expect(result.errorMismatches).toEqual([
      { route: 'GET /api/v1/widgets', node: ['401', '500'], java: ['500'] },
    ]);
  });
});

describe('extractOperations', () => {
  it('reads only the five routable HTTP methods, skipping non-operation keys like `parameters`', () => {
    const document = {
      paths: {
        '/api/v1/widgets/{id}': {
          parameters: [{ name: 'id', in: 'path' }],
          get: { operationId: 'get', responses: { '200': {} } },
          delete: { operationId: 'remove', responses: { '204': {} } },
        },
      },
    };

    const rows = extractOperations(document);

    expect(rows.map((row) => row.method)).toEqual(['delete', 'get']);
  });
});

describe('checkKnownDivergences', () => {
  const entry = (overrides = {}) => ({
    route: 'POST /api/v1/widgets',
    kind: 'success',
    node: ['200'],
    java: ['201'],
    reason: 'test',
    ...overrides,
  });
  const diffWith = (
    statusMismatches: unknown[],
    errorMismatches: unknown[] = [],
  ) => ({
    missingInJava: [],
    extraInJava: [],
    statusMismatches,
    errorMismatches,
    matched: 1,
  });
  const mismatch = (overrides = {}) => ({
    route: 'POST /api/v1/widgets',
    node: ['200'],
    java: ['201'],
    ...overrides,
  });

  it('passes when the actual divergences are exactly the pinned ones', () => {
    const result = checkKnownDivergences(diffWith([mismatch()]), [entry()]);

    expect(result).toEqual({ unexpected: [], stale: [] });
  });

  it('**catches a divergence the list does not explain** — a new one is the whole point of the check', () => {
    const result = checkKnownDivergences(
      diffWith([
        mismatch(),
        mismatch({ route: 'DELETE /api/v1/widgets/{id}' }),
      ]),
      [entry()],
    );

    expect(result.unexpected.map((m: { route: string }) => m.route)).toEqual([
      'DELETE /api/v1/widgets/{id}',
    ]);
    expect(result.stale).toEqual([]);
  });

  it('**catches a pinned divergence that no longer occurs** — a fixed one must leave the list', () => {
    const result = checkKnownDivergences(diffWith([]), [entry()]);

    expect(result.stale).toEqual([entry()]);
    expect(result.unexpected).toEqual([]);
  });

  it('treats a divergence that changed shape as unexpected AND stale, not as still explained', () => {
    const result = checkKnownDivergences(
      diffWith([mismatch({ java: ['202'] })]),
      [entry()],
    );

    expect(result.unexpected).toHaveLength(1);
    expect(result.stale).toHaveLength(1);
  });

  it('keeps success and error divergences on the same route apart', () => {
    const result = checkKnownDivergences(
      diffWith([], [mismatch({ node: ['500'], java: ['429', '500'] })]),
      [entry()],
    );

    expect(result.unexpected).toHaveLength(1);
    expect(result.stale).toHaveLength(1);
  });
});

describe('diffResponseSchemaShapes', () => {
  const operation = (request: string | null, response: string) => ({
    ...(request
      ? {
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${request}` },
              },
            },
          },
        }
      : {}),
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${response}` },
          },
        },
      },
    },
  });

  /** A document whose one route answers with `Out`. */
  const document = (
    out: Record<string, unknown>,
    extra: Record<string, unknown> = {},
    request: string | null = null,
  ) => ({
    paths: { '/x': { post: operation(request, 'Out') } },
    components: { schemas: { Out: out, ...extra } },
  });

  const shape = (required: string[], properties: Record<string, unknown>) => ({
    type: 'object',
    required,
    properties,
  });

  const NULLABLE_STRING = { type: ['string', 'null'] };

  it('matches when required and nullable agree, whichever way null is spelled', () => {
    const node = document(
      shape(['a', 'b'], {
        a: { type: 'string' },
        b: { type: 'string', nullable: true },
      }),
    );
    const java = document(
      shape(['a', 'b'], { a: { type: 'string' }, b: NULLABLE_STRING }),
    );

    const result = diffResponseSchemaShapes(node, java);

    expect(result.mismatches).toEqual([]);
    expect(result.schemas).toBe(1);
    expect(result.properties).toBe(2);
  });

  it('reads a oneOf with null as nullable, the 3.1 spelling of a nullable reference', () => {
    const node = document(shape(['a'], { a: { $ref: '#/x', nullable: true } }));
    const java = document(
      shape(['a'], { a: { oneOf: [{ $ref: '#/x' }, { type: 'null' }] } }),
    );

    expect(diffResponseSchemaShapes(node, java).mismatches).toEqual([]);
  });

  it('FAILS when Java leaves a property optional that Node requires', () => {
    const node = document(shape(['a'], { a: { type: 'string' } }));
    const java = document(shape([], { a: { type: 'string' } }));

    expect(diffResponseSchemaShapes(node, java).mismatches).toEqual([
      {
        schema: 'Out',
        property: 'a',
        kind: 'required',
        node: true,
        java: false,
      },
    ]);
  });

  it('FAILS when the two disagree on whether null is allowed', () => {
    const node = document(shape(['a'], { a: NULLABLE_STRING }));
    const java = document(shape(['a'], { a: { type: 'string' } }));

    expect(diffResponseSchemaShapes(node, java).mismatches).toEqual([
      {
        schema: 'Out',
        property: 'a',
        kind: 'nullable',
        node: true,
        java: false,
      },
    ]);
  });

  it('FAILS on a property one document has and the other lacks', () => {
    const node = document(shape(['a'], { a: { type: 'string' } }));
    const java = document(
      shape(['a', 'b'], { a: { type: 'string' }, b: { type: 'string' } }),
    );

    expect(diffResponseSchemaShapes(node, java).mismatches).toEqual([
      { schema: 'Out', property: 'b', kind: 'property set' },
    ]);
  });

  it('leaves a schema a request also reaches out of the comparison', () => {
    const node = document(shape([], { a: { type: 'string' } }), {}, 'Out');
    const java = document(shape(['a'], { a: NULLABLE_STRING }), {}, 'Out');

    const result = diffResponseSchemaShapes(node, java);

    expect(result.schemas).toBe(0);
    expect(result.mismatches).toEqual([]);
  });

  describe('the named envelope divergence', () => {
    const javaWith = (wrapper: Record<string, unknown>) => ({
      ...document(shape(['a'], { a: { type: 'string' } })),
      components: {
        schemas: {
          Out: shape(['a'], { a: { type: 'string' } }),
          ApiResponseOut: wrapper,
        },
      },
    });
    const nodeWith = (required: string[]) => ({
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      required,
                      properties: {
                        warning: { type: 'string', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Out: shape(['a'], { a: { type: 'string' } }) } },
    });
    const conforming = shape(['warning'], { warning: NULLABLE_STRING });

    it('holds when Java wrappers publish warning required and nullable and Node calls it optional', () => {
      const result = diffResponseSchemaShapes(
        nodeWith([]),
        javaWith(conforming),
      );

      expect(result.envelope).toEqual({
        wrappers: 1,
        wrappersNotRequiredAndNullable: [],
        nodePublishesWarningOptional: true,
      });
    });

    it('FAILS when a Java wrapper stops publishing warning as required', () => {
      const result = diffResponseSchemaShapes(
        nodeWith([]),
        javaWith(shape([], { warning: NULLABLE_STRING })),
      );

      expect(result.envelope.wrappersNotRequiredAndNullable).toEqual([
        'ApiResponseOut',
      ]);
    });

    it('FAILS when a Java wrapper stops publishing warning as nullable', () => {
      const result = diffResponseSchemaShapes(
        nodeWith([]),
        javaWith(shape(['warning'], { warning: { type: 'string' } })),
      );

      expect(result.envelope.wrappersNotRequiredAndNullable).toEqual([
        'ApiResponseOut',
      ]);
    });

    it('goes stale when Node starts calling warning required, so the divergence no longer exists', () => {
      const result = diffResponseSchemaShapes(
        nodeWith(['warning']),
        javaWith(conforming),
      );

      expect(result.envelope.nodePublishesWarningOptional).toBe(false);
    });
  });
});

describe('diffSecurity', () => {
  const COOKIE = { type: 'apiKey', in: 'cookie', name: 'access_token' };
  const document = (
    operations: Record<string, unknown>,
    schemes: Record<string, unknown> = { 'access-cookie': COOKIE },
  ) => ({
    paths: { '/x': operations, '/api/v1/feedback': { get: {} } },
    components: { securitySchemes: schemes },
  });
  const secured = [{ 'access-cookie': [] }];
  const withFeedback = (
    ops: Record<string, unknown>,
    feedback: unknown,
    schemes?: Record<string, unknown>,
  ) => {
    const doc = document(ops, schemes);
    doc.paths['/api/v1/feedback'] = { get: { security: feedback } } as never;

    return doc;
  };

  it('matches equal requirements, scheme key order aside', () => {
    const node = withFeedback({ get: { security: secured } }, undefined, {
      a: { type: 'apiKey', in: 'cookie' },
    });
    const java = withFeedback({ get: { security: secured } }, secured, {
      a: { in: 'cookie', type: 'apiKey' },
    });

    expect(diffSecurity(node, java).mismatches).toEqual([]);
  });

  it('tells public ([]) from secured, and from missing', () => {
    const open = withFeedback({ get: { security: [] } }, undefined);
    const secure = withFeedback({ get: { security: secured } }, secured);
    const nodeSecure = withFeedback({ get: { security: secured } }, undefined);
    const missing = withFeedback({ get: {} }, secured);

    expect(diffSecurity(open, secure).mismatches).toMatchObject([
      { route: 'get /x', kind: 'security' },
    ]);
    expect(diffSecurity(nodeSecure, missing).mismatches).toMatchObject([
      { route: 'get /x', kind: 'security' },
    ]);
  });

  it('fails when the schemes differ', () => {
    const node = withFeedback({}, undefined);
    const java = withFeedback({}, secured, {});

    expect(diffSecurity(node, java).mismatches).toEqual([
      { route: 'securitySchemes', kind: 'schemes' },
    ]);
  });

  it('holds the named omission from both sides', () => {
    const java = withFeedback({}, secured);

    expect(diffSecurity(withFeedback({}, undefined), java).mismatches).toEqual(
      [],
    );
    // Node starts publishing it: the record is stale.
    expect(
      diffSecurity(withFeedback({}, secured), java).mismatches,
    ).toHaveLength(1);
    // Java stops securing it.
    expect(
      diffSecurity(withFeedback({}, undefined), withFeedback({}, []))
        .mismatches,
    ).toHaveLength(1);
  });
});
