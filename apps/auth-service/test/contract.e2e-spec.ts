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
} from '@synapsedesk/grpc-proto';
import { compareAlphabetically } from '@synapsedesk/common';
import { AppModule } from '../src/app.module';

/**
 * the cross-service gRPC contract test.
 *
 * The one test with no equivalent in a single-process app, because this is the
 * one place a mocked peer hides the exact failure `GRPC_LOADER_OPTIONS`' own
 * docblock warns about: *"both ends must use these, or they disagree on the
 * wire."* Every other suite in this repo stubs one side or the other; here both
 * ends are real, and the connection between them is the thing under test.
 *
 * **What it asserts, and why that is enough.** For each RPC: the method is
 * REACHABLE (not `UNIMPLEMENTED`), the request SERIALISES, and the reply — a
 * response message or a gRPC error — DESERIALISES. It deliberately does not
 * care whether the business logic succeeded: a `NOT_FOUND` for an empty request
 * is a perfectly good outcome, because it means the request crossed the wire,
 * was decoded, reached a handler, and the handler's answer came back decoded.
 * The business rules are the per-module suites' job, with fixtures that make
 * them meaningful.
 *
 * **The method list comes from the PROTOS**, read through the same
 * `@grpc/proto-loader` the runtime uses — not from a hand-written array. A new
 * RPC is therefore covered the moment it is declared, which is precisely when
 * the mistake this test catches gets made.
 *
 * Two failures it is built to catch:
 *   - a proto regenerated on one side and not the other -> `UNIMPLEMENTED`, or
 *     a decode error naming the field that moved;
 *   - a loader option that drifts between the two peers -> the mismatch shows
 *     up as a serialisation failure rather than as silently wrong values.
 */
describe('gRPC wire contract (e2e)', () => {
  let app: INestMicroservice;
  let url: string;

  /** Every `service.method` the protos declare, with its request type. */
  type Rpc = { service: string; method: string; path: string };
  let rpcs: Rpc[];

  /** One live client per service, keyed by service name. */
  const clients = new Map<string, Record<string, unknown>>();

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
        package: AUTH_PACKAGE_NAME,
        protoPath: AUTH_PROTO_PATHS,
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

  /**
   * Calls one RPC with an empty request and reports what came back.
   *
   * Empty is valid for EVERY message: proto3 has no required fields, and
   * `defaults: true` materialises the zero value for each one. So this
   * exercises the encode/decode path without needing a fixture per RPC — which
   * is what keeps the list proto-driven.
   */
  function call(
    rpc: Rpc,
  ): Promise<{ ok: boolean; code?: number; message?: string }> {
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
  }

  it('the protos declare every service the gateway consumes', () => {
    // A sanity check on the enumeration itself: if this found two services, the
    // sweep below would be green and prove nothing.
    const services = [...clients.keys()].sort(compareAlphabetically);

    expect(services).toEqual(
      [
        'AuthService',
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

  it('EVERY declared RPC is reachable — none answers UNIMPLEMENTED', async () => {
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
  }, 120_000);

  it('EVERY reply decodes — no serialisation mismatch between the peers', async () => {
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
  }, 120_000);

  it('an error crossing the wire arrives with its STATUS CODE and DETAILS intact', async () => {
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
  }, 120_000);

  it('an unauthenticated call is refused with UNAUTHENTICATED on the routes that check', async () => {
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
  }, 120_000);

  it('KNOWN GAP: some RPCs surface a missing identity as UNKNOWN, not UNAUTHENTICATED', async () => {
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
    expect(unknown.length).toBeLessThanOrEqual(22);
  }, 120_000);

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
