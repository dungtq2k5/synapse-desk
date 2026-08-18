import type { ClientGrpc } from '@nestjs/microservices';
import {
  DOCUMENT_SERVICE_NAME,
  packRequestContext,
  type DocumentServiceClient,
} from '@synapsedesk/grpc-proto';
import { BATCH_ID_LIMIT, type RequestContext } from '@synapsedesk/common';
import { firstValueFrom } from 'rxjs';
import { alignToKeys, createLoader } from './loaders.factory';
import { toDocumentResponseGqlDto } from '../../../modules/documents/document.mapper';
import type { DocumentResponseGqlDto } from '../../../modules/documents/dto/graphql/document-response.gql-dto';

/**
 * The documents loader
 *
 * **`ListDocumentsByIds` was built and called by nothing** — one of three idle
 * batch RPCs. The analytics edges — `DocumentUsage.document` and
 * `KnowledgeGapFlag.document` — are its first consumer, and they are the reason
 * those two reads earned a GraphQL query at all. A batch RPC with no caller is
 * a maintained promise nobody depends on, which is worse than either having it
 * or not: it drifts, and the drift surfaces on the day something finally calls
 * it.
 *
 * Tenant scope comes from the caller CONTEXT inside the RPC, not from anything
 * passed here. Analytics rows carry raw document ids
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

  return createLoader<string, DocumentResponseGqlDto>(
    async (ids) => {
      const response = await firstValueFrom(
        documents.listDocumentsByIds(
          { documentIds: [...ids] },
          packRequestContext(context()),
        ),
      );

      return alignToKeys(
        ids,
        response.items.map((document) => toDocumentResponseGqlDto(document)),
        (document) => document.id,
      );
    },
    { maxBatchSize: BATCH_ID_LIMIT },
  );
}
