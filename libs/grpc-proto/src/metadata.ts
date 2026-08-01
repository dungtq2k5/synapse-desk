import { Metadata } from '@grpc/grpc-js';
import { GRPC_CONTEXT_METADATA, type RequestOrigin } from '@synapsedesk/common';

/**
 * The single round trip for observed request provenance across a service hop.
 *
 * Both halves live here on purpose. Metadata is stringly-typed, so a key that
 * only one side knows about does not fail — it silently reads back as an empty
 * string and the audit row is quietly wrong. Keeping pack and unpack adjacent,
 * both driven by `GRPC_CONTEXT_METADATA`, is what stops the two ends drifting.
 */
export function packRequestOrigin(origin: RequestOrigin): Metadata {
  const metadata = new Metadata();
  metadata.set(GRPC_CONTEXT_METADATA.ip, origin.ip);
  metadata.set(GRPC_CONTEXT_METADATA.userAgent, origin.userAgent);

  return metadata;
}

export function unpackRequestOrigin(metadata?: Metadata): RequestOrigin {
  return {
    ip: readOne(metadata, GRPC_CONTEXT_METADATA.ip),
    userAgent: readOne(metadata, GRPC_CONTEXT_METADATA.userAgent),
  };
}

export function readOne(metadata: Metadata | undefined, key: string): string {
  return (metadata?.get(key)[0] as string | undefined) ?? '';
}
