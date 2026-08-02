import { join } from 'node:path';

/**
 * Nest DI token for the auth-service gRPC client.
 *
 * Deliberately a Symbol, and deliberately NOT the same value as
 * `AUTH_SERVICE_NAME` (generated from the proto). They are different concepts:
 *   - AUTH_SERVICE_NAME -> the `service` name declared inside auth.proto
 *   - AUTH_GRPC_CLIENT  -> the token Nest uses to inject the ClientGrpc proxy
 * Conflating them is how you end up with a provider registered under one
 * string and injected under another.
 */
export const AUTH_GRPC_CLIENT = Symbol('AUTH_GRPC_CLIENT');

/**
 * Root of the proto tree — the `-I` include path. Every `import` inside a
 * .proto is resolved relative to THIS directory, which is why they read
 * `import "synapsedesk/auth/v1/common.proto"` rather than `import "common.proto"`.
 *
 * Resolved from __dirname so it holds regardless of the caller's cwd (dev,
 * docker, or a built dist/). scripts/copy-protos.mjs mirrors this tree into
 * each app's dist during build, because tsc emits only JavaScript and the gRPC
 * loader reads the .proto files at startup.
 */
export const PROTO_ROOT = join(__dirname, 'proto');

/**
 * The service-bearing .proto files of the `synapsedesk.auth.v1` package.
 *
 * Only files whose SERVICES a peer calls need listing. Messages arrive
 * transitively: `auth.proto` imports `common.proto`, so loading `auth.proto`
 * alone already resolves `UserResponse` and round-trips it correctly — the
 * import statement does that work, not this array. (`common.proto` declares no
 * service, so it is deliberately absent.)
 *
 * All five are listed anyway so both peers load one identical definition: the
 * gateway consumes every service, and a single shared constant means a new
 * service is a one-line change here rather than a per-app decision that drifts.
 */
export const AUTH_PROTO_PATHS = [
  'auth.proto',
  'user.proto',
  'two_factor.proto',
  'otp.proto',
  'invitation.proto',
  'department.proto',
  'session.proto',
  'role.proto',
  'organization.proto',
  'platform.proto',
].map((file) => join(PROTO_ROOT, 'synapsedesk', 'auth', file));

/**
 * @grpc/proto-loader options, pinned so the runtime shape matches the types
 * ts-proto generates. Nest forwards `options.loader` straight to
 * protoLoader.loadSync, and its defaults do NOT line up with ts-proto:
 *   - keepCase:false  -> camelCase fields, matching the generated interfaces
 *   - longs:Number    -> int64 as number, matching ts-proto's default mapping
 *   - enums:Number    -> numeric enums, matching the generated enum members
 *   - defaults:true   -> proto3 zero-values populated instead of undefined
 * Both the client and the server must use these, or they disagree on the wire.
 *
 * `includeDirs` is what makes `import "synapsedesk/auth/v1/common.proto"`
 * resolvable: those paths are relative to the include root, not to the
 * importing file, so without it the loader throws at startup.
 */
export const GRPC_LOADER_OPTIONS = {
  keepCase: false,
  longs: Number,
  enums: Number,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_ROOT],
};

/**
 * Channel options shared by every gRPC peer in the system.
 * Both ends must use these — mismatched limits fail only on large payloads.
 */
/**
 * Client-side deadline for a unary call. A gRPC call with no deadline hangs
 * forever if the peer stops responding, so this is not optional tuning — it is
 * the difference between a 504 and a leaked request.
 *
 * Shared so every client agrees; override per call only for genuinely
 * long-running RPCs (report generation, bulk import).
 */
export const GRPC_DEADLINE_MS = 5_000;

export const GRPC_CHANNEL_OPTIONS = {
  maxReceiveMessageLength: 10 * 1024 * 1024,
  maxSendMessageLength: 10 * 1024 * 1024,
  keepaliveTime: 30_000,
  keepaliveTimeout: 10_000,
} as const;
