export * from './generated/synapsedesk/auth/common';
export * from './generated/synapsedesk/auth/auth';
export * from './generated/synapsedesk/auth/user';
export * from './generated/synapsedesk/auth/two_factor';
export * from './generated/synapsedesk/auth/otp';
export * from './generated/synapsedesk/auth/invitation';
export * from './generated/synapsedesk/auth/department';
export * from './generated/synapsedesk/auth/session';
export * from './generated/synapsedesk/auth/role';
export * from './generated/synapsedesk/auth/organization';
export * from './generated/synapsedesk/auth/platform';

export * from './generated/synapsedesk/ticket/common';
export * from './generated/synapsedesk/ticket/ticket';
export * from './generated/synapsedesk/ticket/assignment';
export * from './generated/synapsedesk/ticket/message';
export * from './generated/synapsedesk/ticket/ai';
export * from './generated/synapsedesk/ticket/feedback';
export * from './generated/synapsedesk/ticket/audit';

export * from './generated/synapsedesk/storage/storage';

export * from './generated/synapsedesk/ingestion/document';
export * from './generated/synapsedesk/ingestion/ledger';
export * from './generated/synapsedesk/rag/rag';

export * from './constants';
export * from './metadata';
export * from './mappers';
export * from './pagination';

/**
 * The protobuf package every generated module above belongs to. Passed as the
 * `package` option to both ClientsModule.registerAsync (gateway) and
 * createMicroservice (auth-service); the two must agree or `getService()`
 * returns undefined at boot.
 *
 * Namespaced with `synapsedesk` because the protobuf namespace is flat and
 * GLOBAL — a bare `auth` would collide with any third-party proto that also
 * claims it. The directory layout must mirror the package, which `buf lint`'s
 * PACKAGE_DIRECTORY_MATCH enforces.
 *
 * Deliberately NOT versioned (`synapsedesk.auth.v1`), which is why
 * PACKAGE_VERSION_SUFFIX is excepted in buf.yaml: this package is internal to
 * the monorepo, both peers ship from one repo, and there is no scenario where
 * two incompatible versions need to run side by side. The consequence is that
 * `buf breaking` is the only thing standing between an edit here and a
 * wire-incompatible deploy — keep it in CI.
 *
 * Declared here rather than re-exported from a generated module: `exportCommonSymbols=false`
 * in buf.gen.yaml suppresses ts-proto's own copy, because `export *` silently
 * DROPS any name that two modules both export — with six generated modules all
 * emitting it, the symbol would vanish from this barrel entirely.
 */
export const AUTH_PACKAGE_NAME = 'synapsedesk.auth';

/**
 * Domain B's protobuf package, declared here for the same reason as
 * AUTH_PACKAGE_NAME above: `exportCommonSymbols=false` suppresses ts-proto's
 * own copy, because `export *` silently DROPS any name two modules both export
 * — and with seven generated modules all emitting it, the symbol would vanish
 * from this barrel entirely.
 *
 * Both peers must pass the identical string to `createMicroservice` and
 * `ClientsModule.register`, or `getService()` returns undefined at boot.
 */
export const TICKET_PACKAGE_NAME = 'synapsedesk.ticket';

export const STORAGE_PACKAGE_NAME = 'synapsedesk.storage';

export const INGESTION_PACKAGE_NAME = 'synapsedesk.ingestion';

/**
 * Domain C's Python peer.
 *
 * The one package name that must match a string in ANOTHER LANGUAGE — Python's
 * generated stubs derive their service path from the same `package` line, so a
 * mismatch is not a compile error on either side. It is an UNIMPLEMENTED at
 * runtime, from a server that is running and healthy.
 */
export const RAG_PACKAGE_NAME = 'synapsedesk.rag';
