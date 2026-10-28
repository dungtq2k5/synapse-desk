import { DocumentStatus } from '@synapsedesk/contracts';
import { Prisma } from '../generated/prisma/client';

/**
 * A `documents` filter matching a document with no live version: no chunk row
 * that a completed run made live.
 *
 * A document WITH one keeps answering from it while a reindex, replace or
 * retry runs, and after one fails, so its status stays `INDEXED` and the job
 * carries the run's state. Only a first ingestion moves the document through
 * `PENDING`, `PROCESSING` and `FAILED`.
 */
export const WITHOUT_LIVE_VERSION = {
  chunks: { none: { isStaged: false } },
} satisfies Prisma.DocumentWhereInput;

/**
 * Sets a document's status unless it has a live version.
 *
 * One statement, so the check and the write see the same rows.
 *
 * @param client the transaction to run in, or the client
 * @param documentId the document
 * @param status the status a document without a live version takes
 *
 * @example
 * await setStatusUnlessLive(tx, document.id, DocumentStatus.PENDING);
 */
export async function setStatusUnlessLive(
  client: Prisma.TransactionClient,
  documentId: string,
  status: DocumentStatus,
): Promise<void> {
  await client.document.updateMany({
    where: { id: documentId, ...WITHOUT_LIVE_VERSION },
    data: { status },
  });
}
