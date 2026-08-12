import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { of } from 'rxjs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { faker } from '@faker-js/faker';
import { ConfigService } from '@nestjs/config';
import type {
  OpenAPIObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { timestamp } from '../fixtures/wire';
import { envValidationSchema } from '../../src/common/config/env.validation';
import { buildOpenApiDocument } from '../../src/common/config/swagger.config';
import { compareAlphabetically } from '@synapsedesk/common';
import { INBOUND_SIGNATURE_HEADER } from '../../src/common/guards/inbound-signature.guard';

describe('§1/§5 the OpenAPI document', () => {
  let fx: E2eFixture;
  let doc: OpenAPIObject;

  /**
   * The OpenAPI spec, asserted as a whole — 24-doc §1, §5.
   *
   * **These tests only mean anything because the swagger CLI plugin runs under
   * jest.** It is a TypeScript transformer that emits `@ApiProperty` from existing
   * types and class-validator decorators; `nest build` runs it because
   * `nest-cli.json` says so, and jest runs it because
   * `jest.swagger-transform.cjs` wires it into ts-jest. Without that file every
   * assertion below is vacuously true of a spec with no schemas in it — which is
   * exactly the confusing hour 24-doc §1 describes.
   *
   * `document.spec.ts` guards that: it asserts the transform is present, so
   * removing it fails loudly rather than turning this suite green and empty.
   */
  const TICKET_ID = faker.string.uuid();

  /** A ticket exactly as the stubbed peer puts it on the wire. */
  const wireTicket = () => ({
    id: TICKET_ID,
    ticketNumber: 4211,
    organizationId: faker.string.uuid(),
    authorId: faker.string.uuid(),
    source: 1,
    status: 2,
    priority: 2,
    title: 'Printer is on fire',
    description: 'It really is',
    currentDepartmentId: faker.string.uuid(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  });

  /** Every operation in the spec, flattened, with its path and method. */
  const operations = () =>
    Object.entries(doc.paths).flatMap(([path, item]) =>
      (['get', 'post', 'put', 'patch', 'delete'] as const)
        .filter((method) => item[method])
        .map((method) => ({ path, method, operation: item[method]! })),
    );

  const schema = (name: string) =>
    doc.components?.schemas?.[name] as SchemaObject | undefined;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    // The SAME builder `main.ts` calls. A test that assembled its own document
    // would assert on a spec no client ever receives — the precise failure a
    // documentation test exists to prevent.
    doc = buildOpenApiDocument(fx.app, fx.app.get(ConfigService));
  }, 60_000);

  afterAll(() => fx.close());

  // ------------------------------------------------------------------ §1

  describe('§1 the CLI plugin', () => {
    it('1. **every DTO schema has non-empty `properties`**', () => {
      // Catches a `dtoFileNameSuffix` miss across the whole codebase at once
      // rather than one DTO at a time. A class the plugin did not process still
      // appears in `components.schemas` — referenced by a handler's return type
      // — but with no properties at all, and Swagger UI renders it as an empty
      // object without complaint.
      const schemas = doc.components?.schemas ?? {};

      expect(Object.keys(schemas).length).toBeGreaterThan(20);

      const empty = Object.entries(schemas)
        .filter(([, value]) => {
          const s = value as SchemaObject;
          // Enums and composed schemas legitimately have no `properties`.
          if (s.enum || s.allOf || s.oneOf || s.anyOf) return false;
          if (s.type && s.type !== 'object') return false;

          return Object.keys(s.properties ?? {}).length === 0;
        })
        .map(([name]) => name);

      expect(empty).toEqual([]);
    });

    it('2. **fields reached through `PickType` appear on the derived DTO**', () => {
      // 24-doc §1, restated for the layout that exists now.
      //
      // This used to guard the `.base.ts` trap: the plugin's default
      // `dtoFileNameSuffix` is `['.dto.ts', '.entity.ts']`, `user.base.ts`
      // matched neither, and leaving it out stripped the inherited half of every
      // user response — silently and only partially, which is what let it
      // survive review. That trap is gone: there are no `.base.ts` files left,
      // and `dtoFileNameSuffix` no longer names the suffix.
      //
      // The mechanism it really tested — the plugin resolving properties through
      // a class the DTO does not declare itself — survives in `PickType`, which
      // is how the write DTOs derive from `UserResponseDto`. A plugin that stops
      // following it produces a request body with no properties, so a generated
      // client sends `{}` and every create fails validation.
      // `UpdateUserDto`, not `CreateUserDto`: there are TWO classes named
      // `CreateUserDto` — one in `create-user.dto.ts`, one in
      // `user-admin.dto.ts` — and a schema name is global, so whichever the
      // plugin visits last wins. Asserting on a colliding name tests whichever
      // class happened to be registered rather than the one named.
      // `UpdateUserDto` is declared once and is the DTO the admin route
      // actually binds.
      const picked = schema('UpdateUserDto');

      expect(picked).toBeDefined();
      // Declared on `UserResponseDto`, reached through `PickType`.
      expect(Object.keys(picked?.properties ?? {})).toEqual(
        expect.arrayContaining(['fullName', 'phoneNumber', 'gender']),
      );

      // And the response DTO still carries its own, which is the half that
      // would break if the plugin stopped reading this file at all.
      const response = schema('UserResponseDto');

      expect(Object.keys(response?.properties ?? {})).toEqual(
        expect.arrayContaining(['id', 'organizationId', 'fullName', 'email']),
      );
    });

    it('3. **an optional query parameter is not documented as required**', () => {
      // 24-doc §1 frames this as "proves `classValidatorShim` is engaged", and
      // running it revealed that it does not: **the plugin derives `required`
      // from TYPESCRIPT optionality, not from `@IsOptional()`.** A field
      // declared `page: number = 1` is non-optional to the compiler even though
      // the validator lets a caller omit it, so nineteen fields across nine DTOs
      // documented as required — and a generated client would refuse to send a
      // request without them.
      //
      // Fixed with an explicit `@ApiPropertyOptional()` on each, which is why
      // this asserts on the OUTCOME rather than on the shim being configured.
      const parameters = doc.paths['/api/v1/tickets']?.get?.parameters ?? [];
      const named = (name: string) =>
        parameters.find(
          (parameter) => (parameter as { name?: string }).name === name,
        ) as { required?: boolean } | undefined;

      expect(named('page')).toBeDefined();
      expect(named('page')?.required).toBe(false);
      expect(named('limit')?.required).toBe(false);
      // And a genuinely optional-by-type field is still optional, so the fix
      // did not simply mark everything optional.
      expect(named('searchTerm')?.required).toBe(false);
    });

    it('and `classValidatorShim` IS engaged — bounds reach the schema', () => {
      // What the shim actually contributes here: `@Min(1)` / `@Max(100)` become
      // `minimum` / `maximum`. Asserted separately from `required` above,
      // because conflating the two is what made the doc's framing wrong.
      const parameters = doc.paths['/api/v1/tickets']?.get?.parameters ?? [];
      const limit = parameters.find(
        (parameter) => (parameter as { name?: string }).name === 'limit',
      ) as { schema?: { minimum?: number; maximum?: number } } | undefined;

      expect(limit?.schema?.minimum).toBe(1);
      expect(limit?.schema?.maximum).toBe(100);
    });

    it('4. JSDoc on a DTO field becomes its `description`', () => {
      // `introspectComments`. This codebase's convention is that comments
      // explain WHY, so this is documentation that already exists and already
      // passed review — the reason to prefer the plugin over hand annotation
      // even ignoring the 50-file volume.
      const user = schema('UserResponseDto');
      const organizationId = user?.properties?.organizationId as
        SchemaObject | undefined;

      expect(organizationId?.description).toContain('Super Admin');
    });
  });

  // ------------------------------------------------------------------ §2

  describe('§2 the response envelope', () => {
    /** A representative documented success response. */
    const success = (path: string, method: 'get' | 'post' = 'get') =>
      doc.paths[path]?.[method]?.responses as
        | Record<
            string,
            { content?: Record<string, { schema?: SchemaObject }> }
          >
        | undefined;

    const schemaOf = (
      responses: ReturnType<typeof success>,
      status: string,
    ): SchemaObject | undefined =>
      responses?.[status]?.content?.['application/json']?.schema;

    it('1. **`data` is nested inside the envelope, not at the root**', () => {
      // The bug this whole section prevents. A handler returns
      // `TicketResponseDto`; `TransformInterceptor` wraps it, so the wire
      // carries `{ success, statusCode, message, warning, data }`. Swagger sees
      // only the return type — so without the decorator every documented
      // response in the API describes the payload while the client receives the
      // envelope, and a generated client fails on every single call.
      const body = schemaOf(success('/api/v1/tickets/{id}'), '200');

      expect(
        Object.keys(body?.properties ?? {}).sort(compareAlphabetically),
      ).toEqual(['data', 'message', 'statusCode', 'success', 'warning']);
      expect(body?.properties?.data).toHaveProperty('$ref');
    });

    it('2. **a `@Post` that returns 201 documents 201, not 200**', () => {
      // 24-doc §2, fix 2. The obvious implementation hardcodes `ApiOkResponse`,
      // so every create documents a 200 while returning a 201 — and a
      // silently-wrong status is worse than an absent one, because a client
      // generator emits it and the client then treats every successful create
      // as an error.
      //
      // Most POSTs here carry an explicit `@HttpCode(HttpStatus.OK)`; the
      // thirteen that do not genuinely return 201, and this is one of them.
      const responses = success('/api/v1/tickets', 'post');

      expect(responses).toHaveProperty('201');
      expect(responses).not.toHaveProperty('200');
    });

    it('and a `@Post` with `@HttpCode(OK)` documents 200', () => {
      // The other half, so test 2 cannot pass by documenting 201 everywhere.
      const responses = success('/api/v1/auth/login', 'post');

      expect(responses).toHaveProperty('200');
      expect(responses).not.toHaveProperty('201');
    });

    it('3. **`ApiFilterErrors([403])` actually produces a 403**', () => {
      // The silent no-op — 24-doc §2, fix 1. The reference implementation's
      // union accepted `'403'` and its body ignored it, so the annotation
      // type-checked, read as documentation, and produced nothing. This system
      // needs 403 more than the reference did: permission-guarded routes are
      // most of the API.
      const responses = success('/api/v1/tickets/{id}/assign', 'post');

      expect(responses).toHaveProperty('403');
      expect(schemaOf(responses, '403')?.properties).toHaveProperty('error');
    });

    it('4. **every route documents 429 and 500**', () => {
      // The global throttler and the global exception filter apply to every
      // route in the gateway, so a document that omits them describes a
      // different API than the one running.
      const missing = operations()
        .filter(
          ({ operation }) =>
            !operation.responses?.['429'] || !operation.responses?.['500'],
        )
        .map(({ method, path }) => `${method.toUpperCase()} ${path}`);

      expect(missing).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ §3

  describe('§3 auth schemes', () => {
    it('1. an authenticated route carries a security requirement', () => {
      const operation = doc.paths['/api/v1/tickets']?.get;

      expect(operation?.security ?? []).toEqual([
        expect.objectContaining({ 'access-cookie': [] }),
      ]);
    });

    it('2. `/auth/login` carries NONE', () => {
      // Genuinely unauthenticated, and `security: []` is OpenAPI's way of
      // saying so — overriding the controller-level requirement rather than
      // inheriting it.
      expect(doc.paths['/api/v1/auth/login']?.post?.security).toEqual([]);
    });

    it('3. **no scheme is defined for the tenant-selection cookie**', () => {
      // It carries a half-finished multi-tenant login between its two legs. It
      // is not a credential, and documenting it as a security scheme invites a
      // client to treat it as one and send it where an access token belongs.
      const schemes = doc.components?.securitySchemes ?? {};

      expect(Object.keys(schemes).sort(compareAlphabetically)).toEqual([
        'access-cookie',
        'mfa-cookie',
        'refresh-cookie',
      ]);
      expect(JSON.stringify(schemes)).not.toContain(
        process.env.TENANT_SELECTION_NAME,
      );
    });

    it('and every scheme is a COOKIE, not a bearer token', () => {
      // This API has four cookies and no bearer token anywhere. A scheme typed
      // `http`/`bearer` would send "Try it out" users hunting for a header the
      // gateway never reads.
      for (const scheme of Object.values(
        doc.components?.securitySchemes ?? {},
      )) {
        expect(scheme).toMatchObject({ type: 'apiKey', in: 'cookie' });
      }
    });
  });

  // ------------------------------------------------------------------ §5

  describe('§5 structural assertions over all 184 routes', () => {
    it('1. **every route has a non-empty `summary`**', () => {
      // The one thing the plugin cannot generate, so the one that gets skipped.
      // This is the test that fails when somebody adds route 185 and forgets —
      // the actual long-run failure mode, which is not a wrong description but
      // an undocumented endpoint nobody notices because the page still renders.
      const missing = operations()
        .filter(({ operation }) => !operation.summary?.trim())
        .map(({ method, path }) => `${method.toUpperCase()} ${path}`);

      expect(missing).toEqual([]);
    });

    it('2. **every route documents at least one success response**', () => {
      // Catches a missing `@ApiWrappedResponse` on a new handler. Without it the
      // route appears in the docs with error responses only, which reads as an
      // endpoint that cannot succeed.
      const missing = operations()
        .filter(
          ({ operation }) =>
            !Object.keys(operation.responses ?? {}).some((status) =>
              status.startsWith('2'),
            ),
        )
        .map(({ method, path }) => `${method.toUpperCase()} ${path}`);

      expect(missing).toEqual([]);
    });

    it('3. **every `$ref` resolves — no dangling schema references**', () => {
      // The classic symptom of a DTO used in a union without `extraModels`.
      // Swagger UI renders a dangling ref as an empty box rather than an error,
      // and a generated client emits a type that does not exist.
      const defined = new Set(Object.keys(doc.components?.schemas ?? {}));
      const referenced = new Set<string>();

      for (const match of JSON.stringify(doc).matchAll(
        /"\$ref":"#\/components\/schemas\/([^"]+)"/g,
      )) {
        referenced.add(match[1]);
      }

      expect(referenced.size).toBeGreaterThan(20);
      expect([...referenced].filter((name) => !defined.has(name))).toEqual([]);
    });

    it('and the route count matches the controllers', () => {
      // Guards the three tests above: they iterate over `operations()`, so a
      // document that somehow contained two routes would make all of them pass
      // and prove nothing.
      expect(operations().length).toBeGreaterThanOrEqual(175);
    });
  });

  // ---------------------------------------------------- §5 tests 4 and 5

  /**
   * **The test that makes this stay true** — 24-doc §5.
   *
   * Documentation drifts silently: nothing about a wrong schema fails, the page
   * still renders, and the first person to notice is a consumer whose generated
   * client does not work. So a handful of routes are actually CALLED and their
   * real bodies validated against their own documented schema.
   *
   * Not every route — a representative one per response shape, which is where
   * the failures live: the envelope documented at the wrong nesting, a status
   * code that is not what the route returns, a DTO that gained a field the
   * schema did not.
   */
  describe('§30 §4 the caching contract is PUBLISHED', () => {
    it('**the description carries the staleness contract**', () => {
      // 30-doc §5 step 3, and the order is the point: written before any
      // response cache exists, so it is a stated limit rather than one a client
      // discovers. Rendered at `/docs`, where the people it affects will read
      // it — not in a design document only this team opens.
      const description = doc.info.description ?? '';

      expect(description).toContain('## Caching and staleness');
      expect(description).toContain('varyBy');
      // The GraphQL half: the reason there is no response cache there.
      expect(description).toContain('no response cache');
      // And the client's half of the contract, which the server cannot enforce.
      expect(description).toContain('refetch or update your own store');
    });

    it('**every cached route declares `x-cache`, and no other route does**', () => {
      // The decorator publishes the SAME object the interceptor reads, so the
      // document cannot drift from the behaviour. A hand-maintained list of
      // cached routes is a list that is wrong the first time a TTL changes.
      const declared = operations()
        .filter(({ operation }) => 'x-cache' in operation)
        .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
        .sort(compareAlphabetically);

      expect(declared).toEqual([
        'GET /api/v1/departments',
        'GET /api/v1/documents',
        'GET /api/v1/organizations/current',
        'GET /api/v1/permissions',
        'GET /api/v1/roles',
      ]);
    });

    it('and each one publishes a scope, a TTL and its visibility', () => {
      const cached = operations().filter(
        ({ operation }) => 'x-cache' in operation,
      );

      expect(cached.length).toBeGreaterThan(0);

      for (const { method, path, operation } of cached) {
        const extension = (operation as unknown as Record<string, unknown>)[
          'x-cache'
        ];

        // Named in the assertion so a failure says WHICH route is malformed.
        expect([`${method.toUpperCase()} ${path}`, extension]).toEqual([
          `${method.toUpperCase()} ${path}`,
          {
            scope: expect.any(String),
            ttlSeconds: expect.any(Number),
            varyBy: expect.stringMatching(/^(tenant|caller)$/),
          },
        ]);
      }
    });

    it('**and `GET /documents` publishes `caller`, not `tenant`**', () => {
      // The one that would be a cross-department leak if it were wrong, and
      // the one a client most needs to know is not shared tenant-wide.
      const documents = operations().find(
        ({ method, path }) => method === 'get' && path === '/api/v1/documents',
      );

      const extension = (
        documents?.operation as unknown as Record<
          string,
          { varyBy?: string } | undefined
        >
      )['x-cache'];

      expect(extension?.varyBy).toBe('caller');
    });
  });

  describe('§32 §3.1 the inbound-email webhook documents itself', () => {
    const inbound = () =>
      operations().find(
        ({ method, path }) =>
          method === 'post' && path === '/api/v1/webhooks/email/inbound',
      );

    it('1. **appears in the document with a summary and a 200**', () => {
      // Named here because the tempting way to satisfy 24-doc §5's structural
      // sweep is `@ApiExcludeEndpoint()`, which would delete the route from the
      // spec — and the spec is the one document describing how the Worker must
      // call it.
      const operation = inbound()?.operation;

      expect(operation?.summary).toBe('Inbound email intake');
      expect(operation?.responses?.['200']).toBeDefined();
    });

    it('2. **carries NO security requirement, and says why**', () => {
      // The pairing is the point. `security: []` alone reads as "public", and
      // somebody eventually takes that at face value; the description alone is
      // prose nothing enforces.
      const operation = inbound()?.operation;

      expect(operation?.security).toEqual([]);
      expect(operation?.description).toContain('Not a public endpoint');
      expect(operation?.description).toContain('x-inbound-signature');
    });

    it('and documents 401 rather than Stripe’s 400', () => {
      const responses = inbound()?.operation.responses ?? {};

      expect(responses['401']).toBeDefined();
      expect(responses['400']).toBeUndefined();
    });

    it('3. **`x-webhook` names the header the code actually reads**', () => {
      // A documented header the handler ignores is worse than none: it is a
      // contract the Worker would be written against and the endpoint would
      // reject. The constant is imported from the guard, so the two cannot
      // drift.
      const extension = (
        inbound()?.operation as unknown as Record<
          string,
          Record<string, string> | undefined
        >
      )['x-webhook'];

      expect(extension).toEqual({
        signatureHeader: INBOUND_SIGNATURE_HEADER,
        idempotencyKey: 'messageId',
        caller: 'cloudflare-email-worker',
      });
    });
  });

  describe('§5 a real response validates against its documented schema', () => {
    let validate: (
      path: string,
      method: string,
      status: number,
      body: unknown,
    ) => string[];

    beforeAll(() => {
      // Ajv 8 in `strict: false`: an OpenAPI schema is not quite JSON Schema —
      // `nullable`, `example` and `format: date-time` are OpenAPI dialect and
      // strict mode rejects them as unknown keywords. Turning strictness off is
      // what lets the real document be validated rather than a cleaned-up copy
      // of it, which would be validating the wrong thing.
      const ajv = new Ajv({ strict: false, allErrors: true });
      addFormats(ajv);
      // Every component schema is registered so `$ref` resolves.
      ajv.addSchema({ $id: 'openapi', components: doc.components }, 'openapi');

      validate = (path, method, status, body) => {
        const responses = (
          doc.paths[path]?.[method as 'get'] as {
            responses?: Record<
              string,
              { content?: Record<string, { schema?: object }> }
            >;
          }
        )?.responses;
        const schema =
          responses?.[String(status)]?.content?.['application/json']?.schema;

        if (!schema) return [`no documented ${status} for ${method} ${path}`];

        const check = ajv.compile({
          ...schema,
          components: doc.components,
        });

        return check(body)
          ? []
          : (check.errors ?? []).map(
              (error) => `${error.instancePath} ${error.message}`,
            );
      };
    });

    it('4. **a paginated list body matches its documented envelope**', async () => {
      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: [wireTicket()],
          meta: {
            totalItems: 1,
            itemCount: 1,
            itemsPerPage: 10,
            totalPages: 1,
            currentPage: 1,
          },
        }),
      );

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      })
        .get(`${API}/tickets`)
        .expect(200);

      expect(validate('/api/v1/tickets', 'get', 200, response.body)).toEqual(
        [],
      );
    });

    it('and a single-resource body matches its documented envelope', async () => {
      fx.stubs.ticket.getTicket.mockReturnValue(of(wireTicket()));

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      })
        .get(`${API}/tickets/${TICKET_ID}`)
        .expect(200);

      expect(
        validate('/api/v1/tickets/{id}', 'get', 200, response.body),
      ).toEqual([]);
    });

    it('and an ERROR body matches its documented error envelope', async () => {
      // The half nobody documents and everybody receives. `ApiFilterErrors`
      // claims a shape for 401; this checks the filter actually produces it.
      const response = await request(fx.app.getHttpServer())
        .get(`${API}/tickets`)
        .expect(401);

      expect(validate('/api/v1/tickets', 'get', 401, response.body)).toEqual(
        [],
      );
    });

    it('5. **the generated document is valid OpenAPI 3**', () => {
      // One structural pass over the whole spec. Catches a malformed
      // hand-written schema — the `oneOf` written as an object, the `$ref`
      // beside sibling keys — which Swagger UI renders as an empty box rather
      // than as an error.
      expect(doc.openapi).toMatch(/^3\./);
      expect(doc.info?.title).toBe('SynapseDesk API');

      for (const [path, item] of Object.entries(doc.paths)) {
        expect(path.startsWith('/')).toBe(true);

        for (const method of [
          'get',
          'post',
          'put',
          'patch',
          'delete',
        ] as const) {
          const operation = item[method];
          if (!operation) continue;

          // An operation with no responses is not a valid operation object.
          expect(Object.keys(operation.responses ?? {}).length).toBeGreaterThan(
            0,
          );
          // Every response must carry a description — OpenAPI requires it, and
          // a generator that hits one without will refuse the whole document.
          for (const response of Object.values(operation.responses ?? {})) {
            expect(
              (response as { description?: string }).description,
            ).toBeTruthy();
          }
        }
      }
    });
  });

  // ------------------------------------------------------------------ §4

  describe('§4 exposure', () => {
    it('**is gated on `SWAGGER_ENABLED`, not on an inline NODE_ENV check**', () => {
      // 24-doc §4. `NODE_ENV !== 'production'` written at a call site is the
      // condition that gets inverted during a refactor with nobody noticing,
      // because the failure direction is MORE exposure — and more exposure
      // looks exactly like everything working.
      // Comments are stripped FIRST: the docblock explains the rule by naming
      // the thing it forbids, so a naive grep fails on the file's own
      // documentation.
      const code = readFileSync(
        join(__dirname, '../../src/common/config/swagger.config.ts'),
        'utf8',
      )
        // `.` with the `s` flag rather than `[\s\S]`: the class was only ever a
        // way to say "any character INCLUDING newlines", which dotAll says
        // directly and without escapes.
        .replace(/\/\*.*?\*\//gs, '')
        // Measured linear: `m` makes `$` a line end, so `.*` cannot scan
        // across lines and there is nothing to backtrack through.
        .replace(/\/\/.*$/gm, ''); // NOSONAR

      expect(code).toContain("configService.get<boolean>('SWAGGER_ENABLED')");
      expect(code).not.toMatch(/NODE_ENV\s*[!=]==?\s*['"]production/);
    });

    it('**defaults to OFF**, so an unconsidered environment is closed', () => {
      // The direction that matters. A default of `true` would publish the API's
      // whole shape from any deployment whose env file predates this feature.
      const { value, error } = envValidationSchema.validate(
        { ...process.env, SWAGGER_ENABLED: undefined },
        { allowUnknown: true },
      );

      expect(error).toBeUndefined();
      expect(value.SWAGGER_ENABLED).toBe(false);
    });

    it('**`/docs-json` actually SERVES the document**', async () => {
      // The three assertions above are static; this one proves the wiring. A
      // config-gated setup that reads correctly and mounts nothing would pass
      // every static check and serve a 404 to the client generator that is the
      // whole point of `/docs-json`.
      const response = await request(fx.app.getHttpServer())
        .get(`${API}/docs-json`)
        .expect(200);

      expect(response.body.openapi).toMatch(/^3\./);
      // Typed rather than suppressed. `response.body` is `any` from supertest,
      // and `Object.keys` is the call that quietly accepts a string or a number
      // and returns something meaningless instead of failing.
      const paths = (response.body as { paths: Record<string, unknown> }).paths;
      expect(Object.keys(paths).length).toBeGreaterThan(100);

      // **The staleness contract reaches the client.** A contract
      // nobody can read is not published, and the assertions elsewhere in this
      // file read a document this test builds itself; this one reads what the
      // server actually returns.
      const served = response.body as {
        info: { description?: string };
        paths: Record<string, Record<string, Record<string, unknown>>>;
      };

      expect(served.info.description).toContain('## Caching and staleness');
      expect(served.paths['/api/v1/documents'].get['x-cache']).toEqual({
        scope: 'documents',
        ttlSeconds: 60,
        varyBy: 'caller',
      });
    });

    it('mounts `/docs` and `/docs-json` under the SAME prefix', () => {
      // Both halves in one place, so a proxy rule written for one covers the
      // other. `/docs-json` is the more valuable half — it generates client SDKs
      // and it is what this suite reads — and a deployment that blocked `/docs`
      // while leaving `/docs-json` open would be publishing the same
      // information in a more machine-readable form.
      const source = readFileSync(
        join(__dirname, '../../src/common/config/swagger.config.ts'),
        'utf8',
      );

      expect(source).toContain('`${globalPrefix}/docs`');
      expect(source).toContain('jsonDocumentUrl: `${globalPrefix}/docs-json`');
    });
  });
});
