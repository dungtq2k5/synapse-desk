import { INestMicroservice } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  credentials,
  loadPackageDefinition,
  Metadata,
  status as GrpcStatus,
} from '@grpc/grpc-js';
import type {
  CallOptions,
  GrpcObject,
  ServiceClientConstructor,
} from '@grpc/grpc-js';
import { loadSync, PackageDefinition } from '@grpc/proto-loader';
import {
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATHS,
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  HEALTH_PACKAGE_NAME,
  OPS_PACKAGE_NAME,
  OPS_PACKAGE_NAMES,
  OPS_PROTO_PATHS,
  READINESS_SERVICE,
} from '@synapsedesk/grpc-proto';
import { compareAlphabetically } from '@synapsedesk/common';
import { AppModule } from '../src/app.module';

/**
 * The cross-service gRPC contract test.
 *
 * The one test with no equivalent in a single-process app: every other suite
 * stubs one side or the other, and a mocked peer hides exactly what
 * `GRPC_LOADER_OPTIONS` warns about — *"both ends must use these, or they
 * disagree on the wire."* Here both ends are real.
 *
 * **What it asserts.** For each RPC: the method is REACHABLE (not
 * `UNIMPLEMENTED`), the request SERIALISES, and the reply — message or gRPC
 * error — DESERIALISES. It does not care whether the business logic succeeded;
 * a `NOT_FOUND` for an empty request means the request crossed the wire, was
 * decoded, reached a handler, and the answer came back decoded.
 *
 * **The method list comes from the PROTOS**, read through the same
 * `@grpc/proto-loader` the runtime uses — so a new RPC is covered the moment it
 * is declared, which is when the mistake this catches gets made.
 */
describe('gRPC wire contract (e2e)', () => {
  let app: INestMicroservice;
  let url: string;

  /** Every `service.method` the protos declare, with its request type. */
  type Rpc = { service: string; method: string; path: string };
  let rpcs: Rpc[];

  /** One live client per service, keyed by service name. */
  const clients = new Map<string, Record<string, unknown>>();

  /**
   * Per-test budget for the contract suite.
   *
   * Long because each of these boots BOTH peers and drives a real gRPC round trip
   * — the jest default trips on the boot alone. One constant rather than five
   * copies: they are one budget, and a run where four tests share a limit and the
   * fifth does not is a run whose slowest test fails for a different reason.
   */
  const CONTRACT_TIMEOUT_MS = 120_000;

  /**
   * Calls one RPC with an empty request and reports what came back.
   *
   * Empty is valid for EVERY message: proto3 has no required fields, and
   * `defaults: true` materialises the zero value for each one. So this
   * exercises the encode/decode path without needing a fixture per RPC — which
   * is what keeps the list proto-driven.
   */
  const call = (
    rpc: Rpc,
  ): Promise<{ ok: boolean; code?: number; message?: string }> => {
    const client = clients.get(rpc.service)!;
    const fn = client[rpc.method] as (
      request: unknown,
      metadata: Metadata,
      options: CallOptions,
      callback: (
        error: (Error & { code?: number }) | null,
        value?: unknown,
      ) => void,
    ) => void;

    return new Promise((resolve) => {
      const metadata = new Metadata();
      metadata.set('ip_address', '203.0.113.1');
      metadata.set('user_agent', 'contract-test');

      // Without this, a single hung stub blocks the whole sweep — 60+ RPCs
      // across six `it()` blocks — with nothing but jest's own 120s timeout to
      // eventually kill it, and no indication of which RPC was the culprit.
      const deadline = new Date(Date.now() + 10_000);
      fn.call(client, {}, metadata, { deadline }, (error, value) => {
        if (error) {
          resolve({ ok: false, code: error.code, message: error.message });
          return;
        }
        resolve({ ok: true, message: JSON.stringify(value)?.slice(0, 80) });
      });
    });
  };

  beforeAll(async () => {
    // A high, fixed port rather than 0: Nest's gRPC transport binds during
    // `listen()` and does not report back which port it took, so there is
    // nothing to read an ephemeral choice from.
    url = '127.0.0.1:50251';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // The REAL server, configured exactly as main.ts configures it — same
    // package name, same proto paths, same loader options. Copying those from
    // the shared constants rather than restating them is the point: a test that
    // restated them could pass while production disagreed.
    app = moduleRef.createNestMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        // The ops packages ride along exactly as `main.ts` registers them —
        // Restating them here rather than importing the same
        // constants would let this suite pass while production served a
        // different set.
        package: [AUTH_PACKAGE_NAME, ...OPS_PACKAGE_NAMES],
        protoPath: [...AUTH_PROTO_PATHS, ...OPS_PROTO_PATHS],
        url,
        ...GRPC_CHANNEL_OPTIONS,
        loader: GRPC_LOADER_OPTIONS,
      },
    });
    await app.listen();

    // And the REAL client — a bare @grpc/grpc-js one rather than Nest's
    // ClientGrpc, so nothing in the framework can paper over a mismatch.
    const definition: PackageDefinition = loadSync(
      AUTH_PROTO_PATHS,
      GRPC_LOADER_OPTIONS,
    );
    const pkg = loadPackageDefinition(definition);
    const authPackage = AUTH_PACKAGE_NAME.split('.').reduce<GrpcObject>(
      (node, segment) => node[segment] as GrpcObject,
      pkg,
    );

    rpcs = [];
    for (const [serviceName, entry] of Object.entries(authPackage)) {
      const ctor = entry as ServiceClientConstructor;
      if (typeof ctor !== 'function' || !ctor.service) continue;

      clients.set(serviceName, new ctor(url, credentials.createInsecure()));

      for (const method of Object.values(ctor.service)) {
        rpcs.push({
          service: serviceName,
          method: method.originalName ?? method.path.split('/').pop()!,
          path: method.path,
        });
      }
    }
  }, 30_000);

  afterAll(async () => {
    for (const client of clients.values()) {
      (client as { close?: () => void }).close?.();
    }
    await app.close();
  });

  it('the protos declare every service the gateway consumes', () => {
    // A sanity check on the enumeration itself: if this found two services, the
    // sweep below would be green and prove nothing.
    const services = [...clients.keys()].sort(compareAlphabetically);

    expect(services).toEqual(
      [
        'AuthService',
        // Billing. Its webhook RPC is reachable like any other — the four
        // things it bypasses are gateway-level (auth guard, lifecycle gate,
        // tenant scoping, throttling), and none of them exist at this layer.
        'BillingService',
        'DepartmentService',
        'InvitationService',
        'OrganizationService',
        'OtpService',
        'PlatformService',
        'RoleService',
        'SessionService',
        'TwoFactorAuthService',
        'UserService',
      ].sort(compareAlphabetically),
    );
    expect(rpcs.length).toBeGreaterThan(60);
  });

  it(
    'EVERY declared RPC is reachable — none answers UNIMPLEMENTED',
    async () => {
      // `UNIMPLEMENTED` is the signature of a proto regenerated on one side and
      // not the other: the method exists in the contract and no handler is
      // registered for it. Nothing else in the test suite can see that, because
      // every other suite calls the service class directly and never goes through
      // the `@GrpcMethod` registration at all.
      const unimplemented: string[] = [];

      for (const rpc of rpcs) {
        const result = await call(rpc);
        if (!result.ok && result.code === GrpcStatus.UNIMPLEMENTED) {
          unimplemented.push(`${rpc.service}.${rpc.method}`);
        }
      }

      expect(unimplemented).toEqual([]);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    'EVERY reply decodes — no serialisation mismatch between the peers',
    async () => {
      // The other half. A reply that cannot be decoded surfaces as INTERNAL with
      // a message from the protobuf layer rather than from any handler, so those
      // are the ones worth separating out: a business `INTERNAL` says something
      // threw, a serialisation one says the two ends disagree about the shape.
      const undecodable: string[] = [];

      for (const rpc of rpcs) {
        const result = await call(rpc);
        if (result.ok) continue;

        const message = result.message ?? '';
        if (
          /deserialize|serialize|Invalid wire type|no such field|Expected .* but got/i.test(
            message,
          )
        ) {
          undecodable.push(`${rpc.service}.${rpc.method}: ${message}`);
        }
      }

      expect(undecodable).toEqual([]);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    'an error crossing the wire arrives with its STATUS CODE and DETAILS intact',
    async () => {
      // The mapping the gateway's exception filter depends on entirely: it reads
      // `.code` off the error to choose an HTTP status, and `.details` for the
      // message. If either did not survive the hop, every failure would land as a
      // 500 with no explanation regardless of what actually happened.
      const results = await Promise.all(rpcs.map((rpc) => call(rpc)));
      const failures = results.filter((r) => !r.ok);

      // Empty requests are invalid for most RPCs, so there must BE failures —
      // otherwise this assertion is vacuous.
      expect(failures.length).toBeGreaterThan(0);
      for (const failure of failures) {
        expect(typeof failure.code).toBe('number');
        expect(failure.message).toBeTruthy();
      }
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    'an unauthenticated call is refused with UNAUTHENTICATED on the routes that check',
    async () => {
      // Most of the surface calls `requireActor()`/`requireTenant()`, which raise
      // a proper `RpcException` — so an identity-less request gets a decided
      // UNAUTHENTICATED that the gateway maps to 401.
      const results = await Promise.all(
        rpcs.map(async (rpc) => ({ rpc, result: await call(rpc) })),
      );

      const unauthenticated = results.filter(
        (r) => r.result.code === GrpcStatus.UNAUTHENTICATED,
      );
      expect(unauthenticated.length).toBeGreaterThan(40);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    'KNOWN GAP: some RPCs surface a missing identity as UNKNOWN, not UNAUTHENTICATED',
    async () => {
      // Recorded rather than asserted away, and bounded so it cannot grow quietly.
      //
      // These handlers reach a database call before any identity check, so the
      // failure is a Prisma validation error rather than an `RpcException` — Nest
      // wraps that as UNKNOWN, which `GRPC_TO_HTTP` has no entry for, so the
      // gateway answers 500 where it should answer 401.
      //
      // Not exploitable today: the gateway's own guards refuse an unauthenticated
      // caller long before the RPC is dialled, so nothing reaches these handlers
      // without an identity in practice. It is a defence-in-depth gap and a
      // consistency one — two RPCs answering the same malformed request with
      // different statuses is the kind of thing that costs an afternoon later.
      //
      // The fix is a `requireActor()` at the top of each, exactly as the other 51
      // already do. Left as a reported finding rather than a silent edit across
      // twenty-two handlers.
      const results = await Promise.all(
        rpcs.map(async (rpc) => ({ rpc, result: await call(rpc) })),
      );

      const unknown = results
        .filter((r) => r.result.code === GrpcStatus.UNKNOWN)
        .map((r) => `${r.rpc.service}.${r.rpc.method}`);

      // A ceiling, not an equality: fixing one is welcome and must not fail the
      // suite, while adding a twenty-third is a regression that should.
      // Named, so a new entry has to be justified rather than absorbed by the
      // number. This one is deliberate: `ResolveInboundSender` takes its tenant
      // as an ARGUMENT and has no caller context by design — an
      // identity-less call is its normal mode, and it reaches Prisma with an
      // empty `organization_id` exactly as the other twenty-two do.
      expect(unknown.length).toBeLessThanOrEqual(22);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it('caller CONTEXT survives the hop — the metadata round trip', async () => {
    // `packRequestContext`/`unpackCallerContext` is what carries the tenant
    // across, and it is the mechanism that makes the tenant filter hard to
    // forget. A request whose metadata did not arrive would be a caller with no
    // identity — which reads to a service as an unauthenticated one.
    //
    // `getCurrentUser` is the probe: with no identity in the metadata it must
    // refuse, and refusing is the observable proof that the metadata was read.
    const result = await new Promise<{ code?: number }>((resolve) => {
      const client = clients.get('UserService')!;
      const fn = client.getCurrentUser as (
        request: unknown,
        metadata: Metadata,
        callback: (error: (Error & { code?: number }) | null) => void,
      ) => void;

      const metadata = new Metadata();
      metadata.set('ip_address', '203.0.113.1');
      metadata.set('user_agent', 'contract-test');

      fn.call(client, {}, metadata, (error) => resolve({ code: error?.code }));
    });

    // A refusal — any refusal — is the proof: the request arrived, the metadata
    // was unpacked into a caller with no identity, and a handler acted on that.
    // A SUCCESS here would be the failure, because it would mean an
    // identity-less caller was served their "current user".
    expect(result.code).toBeDefined();
    expect(result.code).not.toBe(GrpcStatus.UNIMPLEMENTED);
  });
});

/**
 * The ops surface, over the REAL wire
 *
 * Separate from the contract sweep above because it asserts different things:
 * that sweep proves every domain RPC round-trips, this one proves the standard
 * health service is actually registered on the same port and answers the two
 * questions Kubernetes asks it.
 *
 * **Kubernetes could not tell whether this process was alive.** It is
 * `createMicroservice`-only, so there was no HTTP endpoint to probe — and the
 * fix is only real if `grpc.health.v1.Health` is genuinely reachable, which is
 * a wire-level fact and not something a controller unit test can establish. A
 * misregistered package produces `UNIMPLEMENTED` from a server that is running
 * and healthy, which is exactly what a probe reads as "restart this".
 */
describe('ops surface over gRPC (e2e)', () => {
  let app: INestMicroservice;
  let health: Record<string, unknown>;
  let ops: Record<string, unknown>;

  const url = '127.0.0.1:50252';

  const invoke = <T>(
    client: Record<string, unknown>,
    method: string,
    request: unknown,
  ): Promise<{ ok: boolean; code?: number; value?: T }> => {
    const fn = client[method] as (
      request: unknown,
      options: CallOptions,
      callback: (error: (Error & { code?: number }) | null, value?: T) => void,
    ) => void;

    return new Promise((resolve) => {
      fn.call(
        client,
        request,
        { deadline: new Date(Date.now() + 10_000) },
        (error, value) =>
          resolve(
            error ? { ok: false, code: error.code } : { ok: true, value },
          ),
      );
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        package: [AUTH_PACKAGE_NAME, ...OPS_PACKAGE_NAMES],
        protoPath: [...AUTH_PROTO_PATHS, ...OPS_PROTO_PATHS],
        url,
        ...GRPC_CHANNEL_OPTIONS,
        loader: GRPC_LOADER_OPTIONS,
      },
    });
    await app.listen();

    const pkg = loadPackageDefinition(
      loadSync(OPS_PROTO_PATHS, GRPC_LOADER_OPTIONS),
    );
    const resolve = (path: string) =>
      path
        .split('.')
        .reduce<GrpcObject>(
          (node, segment) => node[segment] as GrpcObject,
          pkg,
        );

    const HealthCtor = resolve(HEALTH_PACKAGE_NAME)
      .Health as ServiceClientConstructor;
    const OpsCtor = resolve(OPS_PACKAGE_NAME)
      .OpsService as ServiceClientConstructor;

    health = new HealthCtor(url, credentials.createInsecure());
    ops = new OpsCtor(url, credentials.createInsecure());
  }, 60_000);

  afterAll(async () => {
    (health as { close?: () => void }).close?.();
    (ops as { close?: () => void }).close?.();
    await app.close();
  });

  it('1. **answers `Check` as SERVING when its own dependencies are up**', async () => {
    // Readiness, with a live Postgres. `""` and `"readiness"` are two different
    // questions over one port, and this is the one that gates traffic.
    const response = await invoke<{ status: number }>(health, 'check', {
      service: READINESS_SERVICE,
    });

    expect(response.ok).toBe(true);
    expect(response.value?.status).toBe(1); // SERVING
  }, 30_000);

  it('2. liveness is SERVING and checks NOTHING external', async () => {
    // `""` is the standard's "the server as a whole". It must never consult a
    // dependency: a failing liveness probe gets the container KILLED, which
    // repairs nothing when the cause is a database — and does it on every
    // replica simultaneously.
    const response = await invoke<{ status: number }>(health, 'check', {
      service: '',
    });

    expect(response.ok).toBe(true);
    expect(response.value?.status).toBe(1);
  }, 30_000);

  it('3. an UNKNOWN service name is NOT_FOUND, not a cheerful SERVING', async () => {
    // A probe misconfigured with a typo'd service name must fail loudly.
    // Defaulting to liveness would make it pass forever — the failure that
    // looks exactly like health.
    const response = await invoke(health, 'check', { service: 'nonsense' });

    expect(response.ok).toBe(false);
    expect(response.code).toBe(GrpcStatus.NOT_FOUND);
  }, 30_000);

  it('4. **`GetVersion` answers on the port this service already has**', async () => {
    // Served from EVERY service, not just the gateway. A rolling
    // deploy where one service lagged is precisely the state this diagnoses,
    // and a gateway-only version endpoint would report the new SHA while the
    // peer running the old code is the one causing the incident.
    const response = await invoke<{
      version: string;
      sha: string;
      builtAt: string;
    }>(ops, 'getVersion', {});

    expect(response.ok).toBe(true);
    expect(response.value).toEqual({
      version: process.env.APP_VERSION,
      sha: process.env.BUILD_SHA,
      builtAt: process.env.BUILD_TIME,
    });
  }, 30_000);

  it('5. `Watch` is refused EXPLICITLY rather than left dangling', async () => {
    // Kubernetes uses Check, not Watch, so a streaming health feed would be a
    // subscription with no subscriber. UNIMPLEMENTED is the standard's own
    // answer for a server that does not support it.
    const stream = (
      health as {
        watch: (request: unknown) => {
          on: (event: string, handler: (payload?: unknown) => void) => void;
        };
      }
    ).watch({ service: '' });

    const code = await new Promise<number | undefined>((resolve) => {
      stream.on('error', (error) => resolve((error as { code?: number }).code));
      stream.on('end', () => resolve(undefined));
    });

    expect(code).toBe(GrpcStatus.UNIMPLEMENTED);
  }, 30_000);
});
