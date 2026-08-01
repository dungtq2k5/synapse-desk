export * from './generated/synapsedesk/auth/common';
export * from './generated/synapsedesk/auth/auth';
export * from './generated/synapsedesk/auth/user';
export * from './generated/synapsedesk/auth/two_factor';
export * from './generated/synapsedesk/auth/otp';
export * from './generated/synapsedesk/auth/invitation';

export * from './constants';
export * from './metadata';
export * from './mappers';

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
