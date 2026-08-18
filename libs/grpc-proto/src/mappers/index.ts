/**
 * Conversions between Prisma rows, domain values and the gRPC wire.
 *
 * - `timestamp` — `google.protobuf.Timestamp` and required-field helpers
 * - `enum-bridge` — the factory every domain <-> proto enum pair is built with
 * - `enums` — those pairs
 * - `pagination` — page requests, page meta and their bounds
 *
 * Import from `@synapsedesk/grpc-proto`; this barrel is re-exported there.
 */

export * from './timestamp';
export * from './enum-bridge';
export * from './enums';
export * from './pagination';
