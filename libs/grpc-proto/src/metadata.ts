import { Metadata } from '@grpc/grpc-js';
import {
  GRPC_CONTEXT_METADATA,
  type CallerContext,
  type PermissionCode,
  type RequestContext,
  type RequestOrigin,
} from '@synapsedesk/common';

/**
 * Re-exported, not redefined.
 *
 * `CallerContext` and `hasIdentity` moved to `libs/common` so `tenantScope()`
 * could join them there without `common` importing `grpc-proto` — which would
 * be a package cycle, since grpc-proto already imports common. Re-exporting
 * keeps every `from '@synapsedesk/grpc-proto'` call site working: the context
 * still reads as a gRPC-boundary concept at the places that unpack it from
 * metadata, which is where it is most legible.
 *
 * `hasIdentity` is re-exported via `export … from` directly — it is never
 * called in this file, only handed onward. `CallerContext` still needs its own
 * `import` above as well, because it IS used locally (see `unpackCallerContext`
 * below); `export … from` does not create a local binding, only an `import`
 * does. The two coexist without conflict — one is a value import for local
 * use, the other a pure re-export.
 */
export { hasIdentity } from '@synapsedesk/common';
export type { CallerContext };

/**
 * The single round trip for caller context across a service hop.
 *
 * Both halves live here on purpose. Metadata is stringly-typed, so a key that
 * only one side knows about does not fail — it silently reads back as an empty
 * string and the audit row is quietly wrong, or the tenant filter is quietly
 * absent. Keeping pack and unpack adjacent, both driven by
 * `GRPC_CONTEXT_METADATA`, is what stops the two ends drifting.
 */

/**
 * Packs whatever the caller has.
 *
 * Accepts the union so `BaseGrpcClient.call()` needs no second code path: an
 * authenticated controller already passes its full `RequestContext`, and it
 * starts carrying identity across the hop with no change at the call site. An
 * unauthenticated one passes a bare origin and the auth keys are simply absent.
 *
 * This is what makes the tenant filter hard to forget. The alternative — an
 * `organization_id` field on every request message — puts the burden on whoever
 * adds the next RPC, and forgetting it there is a cross-tenant read.
 */
export function packRequestContext(
  origin: RequestOrigin | RequestContext,
): Metadata {
  const metadata = new Metadata();
  metadata.set(GRPC_CONTEXT_METADATA.ip, origin.ip);
  metadata.set(GRPC_CONTEXT_METADATA.userAgent, origin.userAgent);

  if (!isRequestContext(origin)) return metadata;

  metadata.set(GRPC_CONTEXT_METADATA.userId, origin.sub);
  // Omitted rather than set to '' when null: a Super Admin genuinely has no
  // tenant, and '' would unpack as a tenant whose id is the empty string.
  if (origin.organizationId) {
    metadata.set(GRPC_CONTEXT_METADATA.organizationId, origin.organizationId);
  }
  metadata.set(GRPC_CONTEXT_METADATA.isSuperAdmin, String(origin.isSuperAdmin));
  metadata.set(
    GRPC_CONTEXT_METADATA.departmentIds,
    JSON.stringify(origin.departmentIds),
  );
  metadata.set(
    GRPC_CONTEXT_METADATA.permissionCodes,
    JSON.stringify(origin.permissionCodes),
  );
  metadata.set(
    GRPC_CONTEXT_METADATA.isEmailVerified,
    String(origin.isEmailVerified),
  );

  return metadata;
}

/** @deprecated Prefer `packRequestContext`, which is a superset. Kept so
 * unauthenticated call sites read as what they are. */
export const packRequestOrigin = packRequestContext;

export function unpackRequestOrigin(metadata?: Metadata): RequestOrigin {
  return {
    ip: readOne(metadata, GRPC_CONTEXT_METADATA.ip),
    userAgent: readOne(metadata, GRPC_CONTEXT_METADATA.userAgent),
  };
}

/**
 * Rebuilds the caller context the gateway packed.
 *
 * Never throws for a missing identity — `sub` comes back null and the caller
 * decides whether that is legal for the RPC in question.
 */
export function unpackCallerContext(metadata?: Metadata): CallerContext {
  return {
    ...unpackRequestOrigin(metadata),
    sub: readOne(metadata, GRPC_CONTEXT_METADATA.userId) || null,
    organizationId:
      readOne(metadata, GRPC_CONTEXT_METADATA.organizationId) || null,
    isSuperAdmin:
      readOne(metadata, GRPC_CONTEXT_METADATA.isSuperAdmin) === 'true',
    departmentIds: readJson<string[]>(
      metadata,
      GRPC_CONTEXT_METADATA.departmentIds,
      [],
    ),
    permissionCodes: readJson<PermissionCode[]>(
      metadata,
      GRPC_CONTEXT_METADATA.permissionCodes,
      [],
    ),
    isEmailVerified:
      readOne(metadata, GRPC_CONTEXT_METADATA.isEmailVerified) === 'true',
  };
}

export function readOne(metadata: Metadata | undefined, key: string): string {
  return (metadata?.get(key)[0] as string | undefined) ?? '';
}

/**
 * Malformed JSON yields the fallback rather than throwing.
 *
 * These values are produced by our own gateway, so bad JSON means a bug on our
 * side, not hostile input — but an exception here would surface as an opaque
 * INTERNAL on an unrelated RPC. An empty permission list fails closed, which is
 * the safe direction.
 */
function readJson<T>(
  metadata: Metadata | undefined,
  key: string,
  fallback: T,
): T {
  const raw = readOne(metadata, key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isRequestContext(
  value: RequestOrigin | RequestContext,
): value is RequestContext {
  return 'sub' in value;
}
