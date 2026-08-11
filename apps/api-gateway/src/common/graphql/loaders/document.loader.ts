import type { ClientGrpc } from '@nestjs/microservices';
import {
  DOCUMENT_SERVICE_NAME,
  packRequestContext,
  type DocumentResponse,
  type DocumentServiceClient,
} from '@synapsedesk/grpc-proto';
import { BATCH_ID_LIMIT, type RequestContext } from '@synapsedesk/common';
import { firstValueFrom } from 'rxjs';
import { alignToKeys, createLoader } from './loaders.factory';

/**
 * The documents loader — 26-doc §3.1, 27-doc §3.
 *
 * **`ListDocumentsByIds` was built and called by nothing.** 27-doc §3 records it
 * among three idle RPCs; the analytics edges — `DocumentUsage.document` and
 * `KnowledgeGapFlag.document` — are its first consumer, and they are the reason
 * those two reads earned a GraphQL query at all. A batch RPC with no caller is
 * a maintained promise nobody depends on, which is worse than either having it
 * or not: it drifts, and the drift surfaces on the day something finally calls
 * it.
 *
 * Tenant scope comes from the caller CONTEXT inside the RPC, not from anything
 * passed here — 27-doc §1, property 1. Analytics rows carry raw document ids
 * out of a rollup table, so this is the boundary that stops one from resolving
 * across tenants.
 */
export function createDocumentLoader(
  client: ClientGrpc,
  context: () => RequestContext,
) {
  const documents = client.getService<DocumentServiceClient>(
    DOCUMENT_SERVICE_NAME,
  );

  return createLoader<string, DocumentResponse>(
    async (ids) => {
      const response = await firstValueFrom(
        documents.listDocumentsByIds(
          { documentIds: [...ids] },
          packRequestContext(context()),
        ),
      );

      return alignToKeys(ids, response.items, (document) => document.id);
    },
    { maxBatchSize: BATCH_ID_LIMIT },
  );
}
