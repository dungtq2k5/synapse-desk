import {
  AiModelTier as ProtoAiModelTier,
  DocumentFileType as ProtoDocumentFileType,
  DocumentFlagType as ProtoDocumentFlagType,
  DocumentStatus as ProtoDocumentStatus,
} from '@synapsedesk/grpc-proto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  grpcError,
  timestamp,
  wireMessage,
  wirePage,
  wireUser,
  wireUserProjection,
} from '../fixtures/wire';
import { ConfigService } from '@nestjs/config';
import {
  MAX_EDGE_LIST,
  MAX_QUERY_DEPTH,
} from '../../src/common/config/graphql-limits.config';
import { SCHEMA_PATH } from '../../src/common/config/graphql.config';
import { compareAlphabetically } from '@synapsedesk/common';

/**
 * The GraphQL surface.
 *
 * Everything here is about the transport rather than about any domain type:
 * that the caller resolves identically on both surfaces, that the cost limits
 * run before execution, and that the REST envelope stays off. The entity graph
 * is the resolver layer's.
 */
describe('§25 the GraphQL surface (e2e)', () => {
  let fx: E2eFixture;

  /** The committed SDL, which the drift test above keeps current. */
  const schemaSdl = () => readFileSync(SCHEMA_PATH, 'utf8');

  /**
   * `git`, by absolute path, run with a PATH containing only system directories.
   *
   * `execFileSync` takes no shell, so the ARGUMENTS below cannot be injected —
   * but a bare `'git'` is still resolved through the inherited `PATH`, and any
   * writable directory earlier in it would supply the binary instead. Naming the
   * absolute path settles which program runs; pinning the environment settles it
   * for anything that program then shells out to itself.
   */
  const GIT = '/usr/bin/git';
  const FIXED_PATH_ENV = { ...process.env, PATH: '/usr/bin:/bin' };

  /**
   * A `ConfigService` that answers `production` for `NODE_ENV` and defers
   * everything else to the real one.
   *
   * A wrapper rather than `process.env.NODE_ENV = 'production'`: the env variable
   * is read by Joi at module init, by the throttler, by the logger and by Swagger,
   * and setting it globally would boot a differently-configured app whose failure
   * could be any of them.
   */
  const productionConfig = (real: ConfigService): ConfigService =>
    ({
      get: <T>(key: string, fallback?: T) =>
        key === 'NODE_ENV' ? ('production' as T) : real.get<T>(key, fallback!),
      getOrThrow: <T>(key: string) =>
        key === 'NODE_ENV' ? ('production' as T) : real.getOrThrow<T>(key),
    }) as unknown as ConfigService;

  const gql = (query: string, variables?: Record<string, unknown>) =>
    request(fx.app.getHttpServer()).post('/graphql').send({ query, variables });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  afterAll(() => fx.close());

  describe('§1 the surface answers', () => {
    it('1. `/graphql` answers a trivial query', async () => {
      const response = await gql('{ apiInfo { version sha builtAt } }').expect(
        200,
      );

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.apiInfo).toEqual({
        version: process.env.APP_VERSION,
        sha: process.env.BUILD_SHA,
        builtAt: process.env.BUILD_TIME,
      });
    });

    it('2. **the REST envelope does NOT appear** — 25-doc §3', async () => {
      // `TransformInterceptor` bypasses for GraphQL and `AllHttpExceptionFilter`
      // re-throws so Apollo formats the error. Both were already true before
      // GraphQL existed; this asserts they stay that way, because the envelope
      // breaks nested resolution structurally — `ticket { data { assignee {
      // data { … } } } }` is what wrapping every type produces, and composing a
      // graph rather than a stack of boxes is the entire point.
      const response = await gql('{ apiInfo { version } }').expect(200);

      // `response.body` is `any` from supertest, and `Object.keys` takes `{}` —
      // narrowing it here keeps the unsafe-argument rule satisfied without
      // weakening what the assertion checks.
      const body = response.body as Record<string, unknown>;

      expect(Object.keys(body).sort(compareAlphabetically)).toEqual(['data']);
      expect(response.body).not.toHaveProperty('success');
      expect(response.body).not.toHaveProperty('statusCode');
      expect(response.body).not.toHaveProperty('warning');
    });

    it('3. an error arrives in `errors[]`, not as a REST error body', async () => {
      // **400, not 200**, and that is Apollo's own rule rather than this
      // gateway's: a request that fails VALIDATION never became an operation,
      // so it is a bad request. An execution error — a resolver that throws —
      // is a 200 with `errors[]` alongside partial `data`. The distinction
      // matters here because the REST filter must not reshape either one.
      const response = await gql('{ nope }').expect(400);

      expect(response.body.errors).toHaveLength(1);
      // The envelope is absent on the error path too, which is the half that
      // would break first: `AllHttpExceptionFilter` re-throws for GraphQL, and
      // a filter that formatted this would produce a body Apollo clients cannot
      // read.
      expect(response.body).not.toHaveProperty('success');
      expect(response.body).not.toHaveProperty('statusCode');
    });
  });

  describe('§5 cost limits run BEFORE execution', () => {
    it('1. **a query nested past the depth limit is refused at VALIDATION**', async () => {
      // Validation runs before execution begins, so a
      // refused query never reaches a resolver and never makes a gRPC call —
      // refusing *after* the fan-out is a log line, not a limit.
      const deep = `{ ${'a { '.repeat(MAX_QUERY_DEPTH + 2)}b${' }'.repeat(MAX_QUERY_DEPTH + 2)} }`;

      // 400: a query refused during validation never became an operation.
      const response = await gql(deep).expect(400);

      // Matched on the MESSAGE, not on `extensions.code`: Apollo stamps every
      // validation failure as `GRAPHQL_VALIDATION_FAILED` and overwrites the
      // code a rule set. The custom code survives in `extensions` for a client
      // that looks, but it is not what identifies the error here.
      const messages = response.body.errors.map(
        (error: { message: string }) => error.message,
      );
      expect(messages.some((m: string) => /levels deep/.test(m))).toBe(true);
    });

    it('and NO gRPC call was made for it', () => {
      // The half that makes test 1 mean something. The stubs are shared across
      // this suite, so this asserts on the peer the depth query would have hit.
      expect(fx.stubs.ticket.getTicket).not.toHaveBeenCalled();
    });

    it('2. a query within the limits is allowed', async () => {
      // The guard against a limit tuned so tight the feature is pointless.
      const response = await gql('{ apiInfo { version } }').expect(200);

      expect(response.body.errors).toBeUndefined();
    });
  });

  describe('§1.1 `@CurrentUser` works in a resolver', () => {
    it('**resolves the same caller GraphQL and REST see**', async () => {
      // Conventions §15 gap 6: `@CurrentUser` was HTTP-only, so in a resolver it
      // returned null and surfaced as a misleading 500 about a missing guard.
      // Asserted through the shared helper both transports now use, because the
      // property is that they cannot diverge — not that each happens to work.
      const sub = faker.string.uuid();
      const agent = authenticatedAgent(fx.app, { sub });

      // The REST path resolves the caller through `@CurrentUser`. It must not
      // 500 — a 500 here is precisely the symptom the gap produced on the other
      // transport.
      fx.stubs.user.getCurrentUser.mockReturnValue(
        of({
          user: { ...wireUser(), id: sub },
          permissionCodes: [],
          departmentIds: [],
        }),
      );

      // Anything but a 500 is the point: a 500 here is exactly the symptom the
      // gap produced on the other transport, and the route's own body is the
      // users suite's business.
      const rest = await agent.get(`${API}/users/me`);
      expect(rest.status).toBe(200);

      // And the GraphQL branch exists at all — the one line that was missing.
      // Asserted structurally rather than by calling a guarded resolver,
      // because the resolver work is what adds one; this is the seam being in place.
      const source = readFileSync(
        join(
          __dirname,
          '../../src/common/decorators/current-user.decorator.ts',
        ),
        'utf8',
      );
      expect(source).toContain('requestOf(ctx)');
      expect(source).not.toContain('ctx.switchToHttp()');
    });
  });

  describe('§6 loaders are per-request', () => {
    it('**two requests never share a loader instance**', async () => {
      // A singleton loader caches one tenant's row under a bare uuid
      // and serves it to whoever asks for that id next — a cross-tenant leak
      // whose cause is a performance optimisation.
      //
      // Asserted by capturing the context factory's output across two requests.
      const seen: unknown[] = [];
      const { createLoaders } =
        await import('../../src/common/graphql/loaders/loaders.factory');

      const clients = {
        auth: { getService: () => ({}) } as never,
        ingestion: { getService: () => ({}) } as never,
        cache: { mget: () => [], msetEx: () => undefined } as never,
      };

      seen.push(
        createLoaders({ user: undefined } as never, clients),
        createLoaders({ user: undefined } as never, clients),
      );

      expect(seen[0]).not.toBe(seen[1]);
    });
  });

  describe('§1.2 the committed schema', () => {
    it('**matches the generated one**', () => {
      // `schema.gql` is generated, and committing a
      // generated file looks redundant until the first breaking change: with
      // it, removing a field is a red line in a diff somebody reviews; without
      // it, it is a client failing in staging a week later.
      //
      // **Compared against git's INDEX, not against HEAD.** Comparing to HEAD
      // would fail on the very commit that legitimately changes the schema —
      // the file is regenerated and staged, but HEAD still has the old one. The
      // index is what the author is about to commit, which is the question
      // being asked: *did you regenerate and stage it?*
      //
      // The fixture has already booted the app, which rewrites the file, so a
      // difference here means someone changed a type and did not stage the
      // result.
      const repoRoot = join(__dirname, '../../../..');
      const relative = 'apps/api-gateway/src/schema.gql';

      const tracked = execFileSync(GIT, ['ls-files', '--', relative], {
        encoding: 'utf8',
        cwd: repoRoot,
        env: FIXED_PATH_ENV,
      }).trim();
      // An untracked schema would make the diff below vacuously clean.
      expect(tracked).toBe(relative);

      const diff = execFileSync(GIT, ['diff', '--', relative], {
        encoding: 'utf8',
        cwd: repoRoot,
        env: FIXED_PATH_ENV,
      });

      expect(diff).toBe('');
    });

    it('is sorted WITHIN each type, so a diff is a change not a reshuffle', () => {
      // Per type, not across the file: fields are only ordered relative to
      // their siblings, and concatenating them would compare `ApiInfo.version`
      // against `Query.apiInfo` and fail for no reason.
      const generated = readFileSync(SCHEMA_PATH, 'utf8');

      for (const [, body] of generated.matchAll(
        /^type \w+ \{\n([\s\S]*?)^\}/gm,
      )) {
        // `[(:]` rather than `(?:\(|:)` — a character class for single
        // characters, which the engine matches without an alternation branch.
        const fields = [...body.matchAll(/^ {2}(\w+)[(:]/gm)].map((m) => m[1]);

        expect(fields).toEqual([...fields].sort(compareAlphabetically));
      }
    });

    it('**every object type has at least one field** — 26-doc §2 test 1', () => {
      // The wrong-`PickType` trap, caught across the whole schema at once.
      //
      // `@nestjs/swagger` exports `PickType`, `OmitType` and `PartialType` too,
      // and this codebase imports them from there in eight files. Build a
      // GraphQL type with the Swagger version and the class carries no `@Field`
      // metadata at all: the type appears in the schema with ZERO fields, the
      // build succeeds, and nothing errors until a client asks for a field the
      // type does not have.
      //
      // Swept over the SDL rather than over the imports, so it catches the
      // other ways a type can end up empty as well.
      const empty = [
        ...readFileSync(SCHEMA_PATH, 'utf8').matchAll(
          /^type (\w+) \{\n([\s\S]*?)^\}/gm,
        ),
      ]
        .filter(([, , body]) => !/^ {2}\w+[(:]/m.test(body))
        .map(([, name]) => name);

      expect(empty).toEqual([]);
    });

    it('and the sweep sees the types it is supposed to', () => {
      // Guards the guard: a regex that matches nothing reports "no empty
      // types" just as confidently as a healthy schema does. Pinned to the
      // types the contract specs pair, so the day the SDL's shape changes this
      // fails instead of quietly exempting everything.
      const names = [
        ...readFileSync(SCHEMA_PATH, 'utf8').matchAll(/^type (\w+) \{/gm),
      ].map(([, name]) => name);

      expect(names).toEqual(
        expect.arrayContaining([
          'Ticket',
          'User',
          'Document',
          'Notification',
          'AnalyticsOverview',
          'AgentStat',
          'Query',
        ]),
      );
    });
  });

  describe('§5 introspection', () => {
    it('is ON in non-production, where the tooling lives', async () => {
      const response = await gql('{ __schema { queryType { name } } }').expect(
        200,
      );

      expect(response.body.data.__schema.queryType.name).toBe('Query');
    });

    it('**is OFF when NODE_ENV is production**', async () => {
      // The schema is a map of the API — every type, every field,
      // every argument — handed to anyone who asks.
      //
      // A SECOND app on a production config rather than mutating the shared
      // fixture: `introspection` is read once in the module factory, so
      // flipping the env after boot would change nothing and the test would
      // pass against a server that still had it on.
      const production = await bootstrapE2eTest((builder) =>
        builder
          .overrideProvider(ConfigService)
          .useValue(productionConfig(fx.app.get(ConfigService))),
      );

      try {
        const response = await request(production.app.getHttpServer())
          .post('/graphql')
          .send({ query: '{ __schema { queryType { name } } }' });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body.errors)).toMatch(/introspection/i);
      } finally {
        await production.close();
      }
    }, 60_000);
  });

  /**
   * Root resolvers
   *
   * **A resolver is a transport, not an implementation.** Every test here is
   * really one claim: that the query and its REST twin share a call, guards and
   * all. Asserting the shape alone would pass against a second implementation
   * that happened to agree today.
   */
  describe('§4 root resolvers', () => {
    const ticketId = faker.string.uuid();

    const wireTicket = (overrides: Record<string, unknown> = {}) => ({
      id: ticketId,
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
      ...overrides,
    });

    const agent = () =>
      authenticatedAgent(fx.app, { permissionCodes: ['ticket.read.all'] });

    beforeEach(() => jest.clearAllMocks());

    it('1. **a query and its REST twin return the same entity**', async () => {
      // The claim that they share an implementation, checked by comparing the
      // two responses rather than by inspecting either.
      fx.stubs.ticket.getTicket.mockReturnValue(of(wireTicket()));

      const rest = await agent().get(`${API}/tickets/${ticketId}`).expect(200);
      const graph = await agent()
        .post('/graphql')
        .send({
          query: `{ ticket(id: "${ticketId}") { id ticketNumber title status priority } }`,
        })
        .expect(200);

      expect(graph.body.data.ticket).toEqual({
        id: rest.body.data.id,
        ticketNumber: rest.body.data.ticketNumber,
        title: rest.body.data.title,
        status: rest.body.data.status,
        priority: rest.body.data.priority,
      });

      // The stronger half, and it belongs in THIS test rather than the next
      // one: `clearAllMocks` runs between tests, so a separate assertion would
      // read a counter that had just been reset — passing or failing for
      // reasons unrelated to what it claims to check.
      //
      // Equal output could come from a second implementation that happens to
      // agree today; the same gRPC method being called twice cannot.
      expect(fx.stubs.ticket.getTicket).toHaveBeenCalledTimes(2);
    });

    it('2. **a missing ticket nulls its own field, not the whole query**', async () => {
      // `nullable: true` on a single-entity query is the
      // decision being tested: a non-null field that throws takes its parent's
      // entire `data` with it, so one missing ticket would empty a dashboard.
      fx.stubs.ticket.getTicket.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'no such ticket')),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ ticket(id: "${faker.string.uuid()}") { id } apiInfo { version } }`,
        })
        .expect(200);

      expect(response.body.data.ticket).toBeNull();
      // The sibling survived, which is the whole point.
      expect(response.body.data.apiInfo.version).toBe(process.env.APP_VERSION);
    });

    it("3. **a cross-tenant id is null, never another tenant's row**", async () => {
      // Isolation. ticket-service scopes by the caller's tenant and answers
      // NOT_FOUND for anything outside it — the gateway must not turn that into
      // an error that distinguishes "exists elsewhere" from "does not exist".
      fx.stubs.ticket.getTicket.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'no such ticket')),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ ticket(id: "${faker.string.uuid()}") { id title } }`,
        })
        .expect(200);

      expect(response.body.data.ticket).toBeNull();
      expect(response.body.errors).toBeUndefined();
    });

    it('4. **an unauthenticated caller is refused on BOTH transports**', async () => {
      // Same guards, proven rather than assumed test 3. The guard
      // classes are literally the controller's, so this is checking they were
      // actually applied to the resolver.
      const rest = await request(fx.app.getHttpServer()).get(
        `${API}/tickets/${ticketId}`,
      );
      const graph = await request(fx.app.getHttpServer())
        .post('/graphql')
        .send({ query: `{ ticket(id: "${ticketId}") { id } }` });

      expect(rest.status).toBe(401);
      // GraphQL answers 200 with the error inside — its own convention — but
      // the REFUSAL is the property, not the status code.
      expect(graph.body.data?.ticket ?? null).toBeNull();
      expect(JSON.stringify(graph.body.errors)).toMatch(/Unauthorized/i);
    });

    it('5. **`first: 500` is CLAMPED to 100, not rejected**', async () => {
      // Clamping keeps a client working with less data than
      // it asked for; rejecting makes the cap a breaking change for a client
      // that worked yesterday.
      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: [wireTicket()],
          meta: {
            totalItems: 1,
            itemCount: 1,
            itemsPerPage: 100,
            totalPages: 1,
            currentPage: 1,
          },
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query:
            '{ tickets(first: 500) { items { id } meta { itemsPerPage } } }',
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();

      // The clamp is asserted on the OUTBOUND call, which is where it happens.
      const [[sent]] = fx.stubs.ticket.listTickets.mock.calls;
      expect((sent as { page?: { limit?: number } }).page?.limit).toBe(100);
    });
  });

  /**
   * Field resolvers
   *
   * **Test 1 is the test this whole design exists for**, and test 2 is the one
   * that renders a convincing page with the wrong people on it if it fails.
   */
  describe('§5 field resolvers and batching', () => {
    const agentId = faker.string.uuid();
    const otherAgentId = faker.string.uuid();
    const departmentId = faker.string.uuid();

    const wireTicketWith = (assigneeId: string | undefined, id: string) => ({
      id,
      ticketNumber: 1,
      organizationId: faker.string.uuid(),
      authorId: agentId,
      source: 1,
      status: 2,
      priority: 2,
      title: 'Printer',
      description: 'on fire',
      currentAssigneeId: assigneeId,
      currentDepartmentId: departmentId,
      createdAt: timestamp(),
      updatedAt: timestamp(),
    });

    const agent = () =>
      authenticatedAgent(fx.app, { permissionCodes: ['ticket.read.all'] });

    beforeEach(() => jest.clearAllMocks());

    it('1. **50 tickets with `assignee` produce EXACTLY ONE batch call**', async () => {
      // Counted on the STUB, not inferred from the response
      // shape: an N+1 returns exactly the same JSON as a batch, so the only
      // observable difference is how many times the peer was called.
      //
      // Unbatched this is fifty concurrent calls into auth-service, which is
      // also serving every login in the system calls that an
      // outage rather than a missed optimisation.
      const ids = Array.from({ length: 50 }, () => faker.string.uuid());
      const assignees = ids.map(() => faker.string.uuid());

      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: ids.map((id, index) => wireTicketWith(assignees[index], id)),
          meta: {
            totalItems: 50,
            itemCount: 50,
            itemsPerPage: 50,
            totalPages: 1,
            currentPage: 1,
          },
        }),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({
          items: [],
          summaries: assignees.map((id, index) =>
            wireUserProjection({ userId: id, fullName: `Agent ${index}` }),
          ),
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query:
            '{ tickets(first: 50) { items { id assignee { fullName } } } }',
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.tickets.items).toHaveLength(50);
      expect(fx.stubs.user.listUsersByIds).toHaveBeenCalledTimes(1);
    });

    it('2. **the right user lands on the right ticket, whatever order the RPC answers in**', async () => {
      // The highest-value test in the GraphQL work. Every
      // other failure here is visible; this one produces a page that looks
      // entirely plausible with the wrong names against the wrong tickets.
      //
      // The stub answers REVERSED, which is what a database does: `WHERE id IN
      // ('c','a','b')` comes back a, b, c.
      const first = faker.string.uuid();
      const second = faker.string.uuid();

      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: [
            wireTicketWith(agentId, first),
            wireTicketWith(otherAgentId, second),
          ],
          meta: {
            totalItems: 2,
            itemCount: 2,
            itemsPerPage: 10,
            totalPages: 1,
            currentPage: 1,
          },
        }),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({
          items: [],
          // Deliberately the opposite order from the keys.
          summaries: [
            wireUserProjection({ userId: otherAgentId, fullName: 'Grace' }),
            wireUserProjection({ userId: agentId, fullName: 'Ada' }),
          ],
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: '{ tickets { items { id assignee { fullName } } } }',
        })
        .expect(200);

      // Asserted as PAIRING, not membership. A membership assertion passes for
      // the misattributed case, which is the entire bug.
      const items = response.body.data.tickets.items as Array<{
        id: string;
        assignee: { fullName: string };
      }>;

      expect(items.find((item) => item.id === first)?.assignee.fullName).toBe(
        'Ada',
      );
      expect(items.find((item) => item.id === second)?.assignee.fullName).toBe(
        'Grace',
      );
    });

    it('3. **the same user on twenty tickets is fetched once**', async () => {
      // Per-request dedup, which is most of the win test 2.
      const ids = Array.from({ length: 20 }, () => faker.string.uuid());

      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: ids.map((id) => wireTicketWith(agentId, id)),
          meta: {
            totalItems: 20,
            itemCount: 20,
            itemsPerPage: 20,
            totalPages: 1,
            currentPage: 1,
          },
        }),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({
          items: [],
          summaries: [wireUserProjection({ userId: agentId, fullName: 'Ada' })],
        }),
      );

      await agent()
        .post('/graphql')
        .send({
          query: '{ tickets(first: 20) { items { assignee { fullName } } } }',
        })
        .expect(200);

      expect(fx.stubs.user.listUsersByIds).toHaveBeenCalledTimes(1);
      // ONE id on the wire, not twenty.
      const [[sent]] = fx.stubs.user.listUsersByIds.mock.calls;
      expect((sent as { userIds: string[] }).userIds).toEqual([agentId]);
    });

    it('4. **a null `currentAssigneeId` yields null with NO loader call**', async () => {
      // DataLoader batches a key of `undefined` happily and
      // caches the failure, so one unassigned ticket would poison the batch for
      // every other row on the page.
      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: [wireTicketWith(undefined, faker.string.uuid())],
          meta: {
            totalItems: 1,
            itemCount: 1,
            itemsPerPage: 10,
            totalPages: 1,
            currentPage: 1,
          },
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({ query: '{ tickets { items { assignee { fullName } } } }' })
        .expect(200);

      expect(response.body.data.tickets.items[0].assignee).toBeNull();
      expect(fx.stubs.user.listUsersByIds).not.toHaveBeenCalled();
    });

    it('5. **an unreachable peer nulls its field and leaves the rest intact**', async () => {
      // One unreachable service costs the assignee column,
      // not the dashboard — and that is only safe because every edge is
      // nullable, which is a decision made for availability rather than for
      // modelling.
      fx.stubs.ticket.listTickets.mockReturnValue(
        of({
          items: [wireTicketWith(agentId, faker.string.uuid())],
          meta: {
            totalItems: 1,
            itemCount: 1,
            itemsPerPage: 10,
            totalPages: 1,
            currentPage: 1,
          },
        }),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.UNAVAILABLE, 'auth-service down'),
        ),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: '{ tickets { items { id title assignee { fullName } } } }',
        })
        .expect(200);

      const item = response.body.data.tickets.items[0];

      expect(item.assignee).toBeNull();
      // The siblings survived, which is the entire property.
      expect(item.title).toBe('Printer');
      expect(response.body.errors).toHaveLength(1);
    });

    it('6. **`assignee` exposes no `email`** — the schema, not the resolver', async () => {
      // Asserted against the SCHEMA rather than a
      // response: a field that is not in the schema cannot be reached by any
      // query, which is what makes the narrow type structural rather than
      // procedural.
      const response = await agent()
        .post('/graphql')
        .send({ query: '{ tickets { items { assignee { email } } } }' });

      expect(response.status).toBe(400);
      // Matched against the parsed message rather than the stringified body:
      // `JSON.stringify` escapes the quotes graphql puts around the field name,
      // so a pattern written the way the error reads never matches.
      expect(response.body.errors[0].message).toMatch(
        /Cannot query field "email" on type "UserSummary"/,
      );
    });
  });

  /**
   * The rest of the type graph and the selective mutations
   */
  describe('§3/§6 the wider graph', () => {
    const agentId = faker.string.uuid();
    const ticketId = faker.string.uuid();

    const agent = () =>
      authenticatedAgent(fx.app, {
        permissionCodes: [
          'ticket.read.all',
          'ticket.assign',
          'ticket.update',
          'user.read',
        ],
      });

    beforeEach(() => jest.clearAllMocks());

    it('1. **`Query.user` requires `user.read`; `Ticket.assignee` does not**', async () => {
      // The two paths, and the reason they return different
      // types. A caller with ticket access and no `user.read` can traverse to a
      // name, and cannot ask for the profile behind it.
      fx.stubs.ticket.getTicket.mockReturnValue(
        of({
          id: ticketId,
          ticketNumber: 1,
          organizationId: faker.string.uuid(),
          authorId: agentId,
          source: 1,
          status: 2,
          priority: 2,
          title: 'Printer',
          description: 'on fire',
          currentAssigneeId: agentId,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        }),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({
          items: [],
          summaries: [wireUserProjection({ userId: agentId, fullName: 'Ada' })],
        }),
      );

      const ticketOnly = authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      });

      // The EDGE resolves for a caller with no `user.read`.
      const edge = await ticketOnly
        .post('/graphql')
        .send({
          query: `{ ticket(id: "${ticketId}") { assignee { fullName } } }`,
        })
        .expect(200);

      expect(edge.body.data.ticket.assignee.fullName).toBe('Ada');

      // The ROOT QUERY does not.
      const root = await ticketOnly
        .post('/graphql')
        .send({ query: `{ user(id: "${agentId}") { email } }` })
        .expect(200);

      expect(root.body.data?.user ?? null).toBeNull();
      expect(JSON.stringify(root.body.errors)).toMatch(/permission|Forbidden/i);
    });

    it('2. **`Ticket.messages` and `TicketMessage.sender` share the users batch**', async () => {
      // The sender edge uses the SAME loader as `assignee`, so a thread where
      // one agent wrote every message costs one call — not one per message.
      fx.stubs.ticket.getTicket.mockReturnValue(
        of({
          id: ticketId,
          ticketNumber: 1,
          organizationId: faker.string.uuid(),
          authorId: agentId,
          source: 1,
          status: 2,
          priority: 2,
          title: 'Printer',
          description: 'on fire',
          currentAssigneeId: agentId,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        }),
      );
      fx.stubs.message.listMessages.mockReturnValue(
        of(
          wirePage(
            Array.from({ length: 5 }, () =>
              wireMessage({
                ticketId,
                senderId: agentId,
                content: 'Still smoking.',
              }),
            ),
          ),
        ),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({
          items: [],
          summaries: [wireUserProjection({ userId: agentId, fullName: 'Ada' })],
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{
            ticket(id: "${ticketId}") {
              assignee { fullName }
              messages { content sender { fullName } }
            }
          }`,
        })
        .expect(200);

      const ticket = response.body.data.ticket;

      expect(ticket.messages).toHaveLength(5);
      expect(ticket.messages[0].sender.fullName).toBe('Ada');
      // The assignee and all five senders are one person, fetched ONCE.
      expect(fx.stubs.user.listUsersByIds).toHaveBeenCalledTimes(1);
    });

    it('3. **a mutation returns a PAYLOAD, not the bare entity**', async () => {
      // The payload gives a mutation somewhere to put the `message`
      // the REST envelope carries — GraphQL has no envelope — and somewhere to
      // add `userErrors` later without a breaking change.
      fx.stubs.ticket.escalateTicket.mockReturnValue(
        of({
          id: ticketId,
          ticketNumber: 1,
          organizationId: faker.string.uuid(),
          authorId: agentId,
          source: 1,
          status: 4,
          priority: 2,
          title: 'Printer',
          description: 'on fire',
          createdAt: timestamp(),
          updatedAt: timestamp(),
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `mutation { escalateTicket(id: "${ticketId}") { ticket { id status } message } }`,
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.escalateTicket).toEqual({
        ticket: { id: ticketId, status: 'ESCALATED' },
        message: 'Handed off to an agent',
      });
      // The SAME RPC the REST route calls.
      expect(fx.stubs.ticket.escalateTicket).toHaveBeenCalledTimes(1);
    });

    it('4. **a mutation is refused without its permission**', async () => {
      // Same guards as the controller, on the write path too.
      const noPermission = authenticatedAgent(fx.app, { permissionCodes: [] });

      const response = await noPermission
        .post('/graphql')
        .send({
          query: `mutation { transitionTicketStatus(id: "${ticketId}", status: RESOLVED) { ticket { id } } }`,
        })
        .expect(200);

      expect(response.body.data?.transitionTicketStatus ?? null).toBeNull();
      expect(fx.stubs.ticket.changeTicketStatus).not.toHaveBeenCalled();
    });

    it('5. **analytics is ONE whole shape, with no edges to resolve**', () => {
      // `AnalyticsOverview` is a composed read with its own cache
      // and rollups; decomposing it into resolvable fields would re-run the
      // composition per field.
      // `exec` rather than `String.match`: with no `g` flag the two return
      // the same match, and `exec` is the one that says so — `match` silently
      // changes shape to a bare string array the day someone adds `g`.
      const overview = /type AnalyticsOverview \{([\s\S]*?)\n\}/.exec(
        schemaSdl(),
      );

      expect(overview).not.toBeNull();
      // Every field is a scalar or a value object — nothing that would need a
      // loader, and nothing pointing back at an entity.
      expect(overview![1]).not.toMatch(
        /:\s*(User|Ticket|Document|Department)\b/,
      );
    });
  });

  /**
   * The user queries return the USER, not the envelope it arrives in.
   *
   * **Every one of these was broken and nothing said so.**
   * `UserServiceGrpcClient.get()` and `.list()` answer a
   * `UserSummaryResponseDto` — the user NESTED under `.user`, beside `roleIds`
   * and `departmentIds` — and the resolvers returned that envelope through
   * `as unknown as UserResponseGqlDto`. A double cast is the only construct
   * TypeScript accepts between unrelated shapes, so it silenced the single
   * error that would have caught this, and both queries answered
   * `Cannot return null for non-nullable field User.id` to every caller.
   *
   * There was no test covering `Query.user` or `Query.users` at all, which is
   * why a fully broken query shipped alongside a byte-identical schema: the SDL
   * describes what a resolver PROMISES, never what it returns.
   */
  describe('§4 the user queries return a User, not its envelope', () => {
    const agent = () =>
      authenticatedAgent(fx.app, { permissionCodes: ['user.read'] });

    /** Exactly what `GetUser` puts on the wire: the user, wrapped. */
    const wireEnvelope = (departmentIds: string[] = []) => ({
      user: wireUser(),
      roleIds: [],
      roleNames: [],
      departmentIds,
    });

    beforeEach(() => jest.clearAllMocks());

    it('1. **`Query.user` resolves its non-null fields**', async () => {
      const envelope = wireEnvelope();
      fx.stubs.user.getUser.mockReturnValue(of(envelope));

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ user(id: "${faker.string.uuid()}") { id fullName email } }`,
        })
        .expect(200);

      // Asserted on the VALUES, not merely on the absence of errors: the
      // resolver catches and returns null, so a broken unwrap would otherwise
      // read as "no such user" rather than as a failure.
      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.user).toEqual({
        id: envelope.user.id,
        fullName: envelope.user.fullName,
        email: envelope.user.email,
      });
    });

    it('2. **every row of `Query.users` resolves too**', async () => {
      // One level deeper, and worse: `items` is non-null, so a single bad row
      // took the whole query's `data` to null rather than just its own field.
      const envelope = wireEnvelope();
      fx.stubs.user.listUsers.mockReturnValue(of(wirePage([envelope])));

      const response = await agent()
        .post('/graphql')
        .send({
          query: '{ users { items { id fullName } meta { totalItems } } }',
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.users.items).toEqual([
        { id: envelope.user.id, fullName: envelope.user.fullName },
      ]);
    });

    it('3. **`User.departments` sees the ids the envelope carried**', async () => {
      // The QUIET half of the same bug. `Query.me` returned `current.user`,
      // which is the right half — so it rendered, and `departments` returned an
      // empty list for every caller, because `departmentIds` is a sibling of
      // `user` on the envelope rather than a property of it. Nothing failed;
      // the edge was simply always empty.
      const departmentId = faker.string.uuid();

      fx.stubs.user.getCurrentUser.mockReturnValue(
        of({
          user: wireUser(),
          permissionCodes: [],
          departmentIds: [departmentId],
        }),
      );
      fx.stubs.department.listDepartmentsByIds.mockReturnValue(
        of({
          items: [
            {
              id: departmentId,
              name: 'Support',
              description: 'Front line',
              memberCount: 3,
              createdAt: timestamp(),
              updatedAt: timestamp(),
            },
          ],
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({ query: '{ me { id departments { id name } } }' })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.me.departments).toEqual([
        { id: departmentId, name: 'Support' },
      ]);
    });
  });

  /**
   * List edges: cap or paginate, never both
   */
  describe('§3.2 capped edge lists', () => {
    const userId = faker.string.uuid();

    const agent = () =>
      authenticatedAgent(fx.app, { permissionCodes: ['user.read'] });

    beforeEach(() => jest.clearAllMocks());

    it('3. **250 departments yields a CAPPED list, not a batch-cap error**', async () => {
      // The failure this fix prevents is not truncation — it is a HARD FIELD
      // FAILURE. `ListDepartmentsByIds` caps at 200 ids and answers
      // INVALID_ARGUMENT rather than truncating, so an
      // uncapped 250-key batch does not return fewer departments: it errors,
      // and the whole `departments` field nulls.
      const departmentIds = Array.from({ length: 250 }, () =>
        faker.string.uuid(),
      );

      fx.stubs.user.getUser.mockReturnValue(
        of({
          user: { ...wireUser(), id: userId },
          roleIds: [],
          roleNames: [],
          departmentIds,
        }),
      );
      // The stub answers whatever it is asked for, so a batch that was NOT
      // sliced would arrive here with 250 keys and the assertion below catches
      // it directly.
      fx.stubs.department.listDepartmentsByIds.mockImplementation(
        (request: { departmentIds: string[] }) =>
          of({
            items: request.departmentIds.map((id) => ({
              id,
              name: `Department ${id.slice(0, 4)}`,
              description: undefined,
              isPrimary: false,
              memberCount: 0,
              createdAt: timestamp(),
              updatedAt: timestamp(),
            })),
          }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ user(id: "${userId}") { departments { id } departmentCount } }`,
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();

      const user = response.body.data.user;

      // Capped, and capped at the EDGE limit rather than at the RPC's.
      expect(user.departments).toHaveLength(MAX_EDGE_LIST);
      // 4. **The flat count reports the TRUE total.** Without it a capped list
      // is indistinguishable from a complete one, and the cap becomes exactly
      // the silent truncation the batch RPC refuses to perform.
      expect(user.departmentCount).toBe(250);

      // And the ids were sliced BEFORE the batch — the property that turns a
      // hard failure into a documented ceiling.
      const [[sent]] = fx.stubs.department.listDepartmentsByIds.mock.calls;
      expect(sent.departmentIds).toHaveLength(MAX_EDGE_LIST);
    });

    it('and an ordinary parent is not capped at all', async () => {
      // The guard against a cap so eager it truncates the normal case: these
      // are single-digit lists in practice, which is why they cap rather than
      // paginate.
      const departmentIds = [faker.string.uuid(), faker.string.uuid()];

      fx.stubs.user.getUser.mockReturnValue(
        of({
          user: { ...wireUser(), id: userId },
          roleIds: [],
          roleNames: [],
          departmentIds,
        }),
      );
      fx.stubs.department.listDepartmentsByIds.mockReturnValue(
        of({
          items: departmentIds.map((id) => ({
            id,
            name: 'Support',
            description: undefined,
            isPrimary: false,
            memberCount: 0,
            createdAt: timestamp(),
            updatedAt: timestamp(),
          })),
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ user(id: "${userId}") { departments { name } departmentCount } }`,
        })
        .expect(200);

      expect(response.body.data.user.departments).toHaveLength(2);
      expect(response.body.data.user.departmentCount).toBe(2);
    });
  });
  /**
   * The analytics reads that earned a GraphQL query
   *
   * `agents` is the one that justifies the rule, and these tests pin the reason
   * rather than the wiring: in REST the agent names come from a hydration leg
   * called last and unconditionally; here that leg IS the users loader, so a
   * client that only wants throughput never pays for it.
   */
  describe('§3.1 analytics composes rather than reaching parity', () => {
    const agent = () =>
      authenticatedAgent(fx.app, { permissionCodes: ['analytics.read'] });

    const agentIds = [faker.string.uuid(), faker.string.uuid()];

    /** Two rows of `agent_daily_stats`, as ticket-service puts them on the wire. */
    const seedAgentStats = () => {
      fx.stubs.analytics.getAgentStats.mockReturnValue(
        of({
          items: agentIds.map((agentId, index) => ({
            agentId,
            assigned: 10 + index,
            resolved: 8 + index,
            messagesSent: 30 + index,
            resolutionSeconds: { mean: 3600, count: 8 },
          })),
          dataThrough: '2026-08-09',
        }),
      );
      fx.stubs.ledger.getAiUsage.mockReturnValue(
        of({
          points: [],
          byPurpose: [],
          byModel: [],
          totalCostMicros: 0,
          totalGenerations: 0,
          monthlyBudgetMicros: 0,
          aiModelTier: ProtoAiModelTier.AI_MODEL_TIER_FAST,
          draftAcceptance: { rate: 0.5, numerator: 4, denominator: 8 },
          emptyRetrievalRate: { rate: 0, numerator: 0, denominator: 0 },
          dataThrough: '2026-08-09',
        }),
      );
    };

    it('1. **the numbers alone cost NO call to auth-service**', async () => {
      // The REST endpoint hydrates names whenever the list
      // is non-empty; a GraphQL query that asked for the same thing would be
      // parity, not composition. The `hydrateNames: false` on the resolver is
      // what this asserts, and it is invisible in the response body — the
      // numbers are identical either way.
      seedAgentStats();

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ analyticsAgents(from: "2026-08-01", to: "2026-08-09") {
            items { agentId assigned resolved }
            dataThrough
          } }`,
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.analyticsAgents.items).toHaveLength(2);
      expect(fx.stubs.user.listUsersByIds).not.toHaveBeenCalled();
    });

    it('2. **asking for `agent` resolves it through the users loader, once**', async () => {
      // The other half: the edge works, AND two rows cost one batch rather
      // than two calls. Same RPC the abandoned hydration leg called — the only
      // difference is that this one happens because a client asked.
      seedAgentStats();
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({
          items: [],
          summaries: agentIds.map((userId, index) => ({
            userId,
            fullName: `Agent ${index}`,
            avatarUrl: undefined,
            isLocked: false,
          })),
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ analyticsAgents(from: "2026-08-02", to: "2026-08-09") {
            items { agentId agent { id fullName } }
          } }`,
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(
        response.body.data.analyticsAgents.items.map(
          (item: { agent: { fullName: string } | null }) =>
            item.agent?.fullName ?? null,
        ),
      ).toEqual(['Agent 0', 'Agent 1']);

      // ONE batch for both rows — the whole reason the edge is a loader.
      expect(fx.stubs.user.listUsersByIds).toHaveBeenCalledTimes(1);
    });

    it("3. **`KnowledgeGapFlag.document` is `ListDocumentsByIds`'s first consumer**", async () => {
      // The RPC was built and called by nothing. This edge is
      // the caller, and a batch RPC with no consumer is a maintained promise
      // that drifts until the day something finally uses it.
      const documentId = faker.string.uuid();

      fx.stubs.ledger.getKnowledgeGaps.mockReturnValue(
        of({
          emptyRetrievals: 12,
          answeringGenerations: 40,
          emptyRetrievalRate: { rate: 0.3, numerator: 12, denominator: 40 },
          flags: [
            {
              documentId,
              documentTitle: 'Refund policy (as flagged)',
              // `'STALE'` was never a DocumentFlagType; OUTDATED is the member.
              flagType: ProtoDocumentFlagType.DOCUMENT_FLAG_TYPE_OUTDATED,
              detail: 'No citation in 90 days',
            },
          ],
          dataThrough: '2026-08-09',
        }),
      );
      fx.stubs.document.listDocumentsByIds.mockReturnValue(
        of({
          items: [
            {
              id: documentId,
              organizationId: faker.string.uuid(),
              createdById: faker.string.uuid(),
              // DIFFERENT from the flag's title on purpose: the rollup carries
              // the title it was written with, and the edge is how a client
              // reaches the CURRENT one.
              title: 'Refund policy (renamed)',
              fileUrl: 'documents/org/refund.pdf',
              fileType: ProtoDocumentFileType.DOCUMENT_FILE_TYPE_PDF,
              fileSizeBytes: 1024,
              isOrganizationWide: true,
              status: ProtoDocumentStatus.DOCUMENT_STATUS_INDEXED,
              departmentIds: [],
              chunkCount: 4,
              ocrLanguages: [],
              createdAt: timestamp(),
              updatedAt: timestamp(),
            },
          ],
        }),
      );

      const response = await agent()
        .post('/graphql')
        .send({
          query: `{ analyticsKnowledgeGaps(from: "2026-08-03", to: "2026-08-09") {
            emptyRetrievalRate { rate numerator denominator }
            flags { documentTitle document { id title } }
          } }`,
        })
        .expect(200);

      expect(response.body.errors).toBeUndefined();

      const [flag] = response.body.data.analyticsKnowledgeGaps.flags;

      expect(flag.documentTitle).toBe('Refund policy (as flagged)');
      expect(flag.document).toEqual({
        id: documentId,
        title: 'Refund policy (renamed)',
      });
      expect(fx.stubs.document.listDocumentsByIds).toHaveBeenCalledTimes(1);
    });

    it('4. **the chart series stay OUT of the schema**', () => {
      // The other half of the rule: `deflection`, `volume`, `satisfaction`,
      // `response-times` and `ai-usage` are buckets and numbers with no entity
      // id in any row. A query for one would be a REST call with more syntax
      // and a second cache path — so the absence is the decision, and this is
      // what keeps somebody from "completing the set" later.
      const sdl = schemaSdl();

      for (const field of [
        'analyticsDeflection',
        'analyticsVolume',
        'analyticsSatisfaction',
        'analyticsResponseTimes',
        'analyticsAiUsage',
        'analyticsExport',
      ]) {
        expect(sdl).not.toContain(field);
      }
    });
  });
});
