import { Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_DIMENSION } from '@synapsedesk/contracts';
import { createHash } from 'node:crypto';
import { EmbeddingClient, EmbeddingResult } from './embedding.contract';

/** A word, as rag-service's offline mode reads one (`\w+`, Unicode). */
const WORD = /[\p{L}\p{N}_]+/gu;

/**
 * A text's offline vector: each lower-cased word hashed (sha256, the first
 * four bytes, big-endian) into one dimension, a small constant in the first
 * so a text with no words still has a direction, then normalized.
 *
 * **The same function as rag-service's `offline_vector`**, so documents
 * embedded here and questions embedded there meet in one space; the spec
 * holds the two to Python's own numbers.
 *
 * @example offlineVector('annual leave').length // 768
 */
export function offlineVector(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  for (const word of text.toLowerCase().match(WORD) ?? []) {
    const digest = createHash('sha256').update(word).digest();
    vector[digest.readUInt32BE(0) % EMBEDDING_DIMENSION] += 1;
  }
  vector[0] += 1e-3;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

/**
 * The model-free embedding client, for the end-to-end stack only.
 *
 * Switched on by `INGESTION_OFFLINE_MODEL`, refused under `NODE_ENV=production`
 * (`env.validation.ts`). No key, no network: uploads index the same way on
 * every machine, and rag-service's offline mode finds them.
 */
@Injectable()
export class OfflineEmbeddingClient implements EmbeddingClient {
  constructor() {
    new Logger(OfflineEmbeddingClient.name).warn(
      'INGESTION_OFFLINE_MODEL is set: embedding with the model-free client',
    );
  }

  embedBatch(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({
      vectors: texts.map(offlineVector),
      promptTokens: texts.reduce(
        (sum, text) => sum + Math.max(1, Math.floor(text.length / 4)),
        0,
      ),
    });
  }
}
