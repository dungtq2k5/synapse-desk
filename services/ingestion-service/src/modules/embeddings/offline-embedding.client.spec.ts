import { EMBEDDING_DIMENSION } from '@synapsedesk/contracts';
import {
  OfflineEmbeddingClient,
  offlineVector,
} from './offline-embedding.client';

describe('the offline embedding client (unit)', () => {
  it('is rag-service’s offline vector, to Python’s own numbers', () => {
    // From `rag_service.offline.offline_vector` on the same text: the
    // dimensions it lands in and their weights.
    const vector = offlineVector(
      'Annual leave resets on 1 January — Ålesund_2026!',
    );
    const nonZero = vector.flatMap((value, index) =>
      value ? [[index, Number(value.toFixed(12))]] : [],
    );

    expect(vector).toHaveLength(EMBEDDING_DIMENSION);
    expect(nonZero).toEqual([
      [0, 0.000377964446],
      [120, 0.377964446012],
      [144, 0.377964446012],
      [154, 0.377964446012],
      [406, 0.377964446012],
      [454, 0.377964446012],
      [627, 0.377964446012],
      [645, 0.377964446012],
    ]);
  });

  it('answers one vector per text, in order', async () => {
    const result = await new OfflineEmbeddingClient().embedBatch([
      'annual leave',
      'printer jam',
      'annual leave',
    ]);

    expect(result.vectors).toHaveLength(3);
    expect(result.vectors[0]).toEqual(result.vectors[2]);
    expect(result.vectors[0]).not.toEqual(result.vectors[1]);
    expect(result.promptTokens).toBeGreaterThan(0);
  });
});
