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
 * Absolute path to auth.proto, resolved relative to this file so it works
 * regardless of the caller's cwd (dev, docker, or a built dist/).
 * The matching `.proto` asset copy is configured in each app's nest-cli.json.
 */
export const AUTH_PROTO_PATH = join(__dirname, 'proto', 'auth.proto');

/**
 * @grpc/proto-loader options, pinned so the runtime shape matches the types
 * ts-proto generates. Nest forwards `options.loader` straight to
 * protoLoader.loadSync, and its defaults do NOT line up with ts-proto:
 *   - keepCase:false  -> camelCase fields, matching the generated interfaces
 *   - longs:Number    -> int64 as number, matching ts-proto's default mapping
 *   - enums:Number    -> numeric enums, matching the generated enum members
 *   - defaults:true   -> proto3 zero-values populated instead of undefined
 * Both the client and the server must use these, or they disagree on the wire.
 */
export const GRPC_LOADER_OPTIONS = {
  keepCase: false,
  longs: Number,
  enums: Number,
  defaults: true,
  oneofs: true,
};
