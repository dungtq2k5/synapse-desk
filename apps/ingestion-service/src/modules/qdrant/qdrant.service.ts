import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  QDRANT_COLLECTION,
  QDRANT_PAYLOAD_FIELDS,
  QdrantChunkPayload,
  QdrantScopePayload,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
} from '@synapsedesk/common';

/** What one chunk looks like as a Qdrant point. */
export type ChunkPoint = {
  vectorPointId: string;
  vector: number[];
  chunkId: string;
  documentId: string;
  organizationId: string;
  departmentIds: string[];
  isOrganizationWide: boolean;
  isDeleted: boolean;
};

/**
 * The WRITE side of Qdrant. `rag-service` owns the read side.
 *
 * Two implementations of one collection, and the split is not arbitrary: the
 * worker that produces points is here, in the service that owns the Postgres
 * rows they mirror, while the queries that consume them are in the service that
 * owns retrieval. What they share is the collection name, the four payload
 * field names and the dimension — all in `@synapsedesk/common`, so the two
 * halves cannot disagree about what a point looks like.
 *
 * **Everything this writes is a precondition for a filter it does not apply.**
 * `tenant_scope()` in `rag-service` is worthless if a point arrives with no
 * `organization_id`: the filter excludes nothing it cannot see, so a payload
 * omission is a cross-tenant disclosure with no failing query anywhere.
 */
@Injectable()
export class QdrantService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QdrantService.name);

  private readonly client: QdrantClient;

  constructor(private readonly configService: ConfigService) {
    this.client = new QdrantClient({
      url: this.configService.getOrThrow<string>('QDRANT_URL'),
      checkCompatibility: false,
    });
  }

  /**
   * Creates the collection and its payload indexes if they are missing.
   *
   * Idempotent, and run on every boot by BOTH services — the same discipline
   * the Postgres seeders use. Two services racing to create one collection is
   * fine for exactly the reason `CREATE ... IF NOT EXISTS` is: there is no
   * read-then-write window to lose.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.ensureCollection();
  }

  async ensureCollection(): Promise<void> {
    const exists = await this.client.collectionExists(QDRANT_COLLECTION);

    if (!exists.exists) {
      await this.client.createCollection(QDRANT_COLLECTION, {
        // Cosine, and it must MATCH `rag-service`'s
        // `qm.Distance.COSINE` — the writer creating a collection with one
        // metric and the reader querying it with another is not an error
        // anywhere, it just ranks wrongly and quietly.
        //
        // Cosine rather than Dot or Euclid because text embeddings encode
        // similarity as ANGLE; magnitude carries no meaning, so a longer
        // passage must not out-rank a shorter one for that reason alone.
        // Qdrant normalizes vectors on upsert for this metric, which also makes
        // it correct whether or not the embedding model returns unit vectors —
        // Dot would silently depend on that.
        vectors: { size: EMBEDDING_DIMENSION, distance: 'Cosine' },
      });
      this.logger.log(
        `Created Qdrant collection ${QDRANT_COLLECTION} (${EMBEDDING_MODEL}, ${EMBEDDING_DIMENSION}-dim)`,
      );
    } else {
      await this.assertDimensionMatches();
    }

    await this.ensurePayloadIndexes();
  }

  /**
   * One point per chunk, batched.
   *
   * `wait: true` because the very next thing the worker does is write
   * `vector_point_id` back to Postgres. Without it the write-back can land
   * before the point is searchable, and the ordering the pipeline depends on —
   * upsert, THEN claim the vector exists — would be true only on paper.
   */
  async upsertChunks(points: ChunkPoint[]): Promise<void> {
    if (points.length === 0) return;

    await this.client.upsert(QDRANT_COLLECTION, {
      wait: true,
      points: points.map((point) => {
        // Annotated, so a wrong value type or a missing key is a compile error
        // here rather than a point that writes fine and never matches a filter.
        const payload: QdrantChunkPayload = {
          [QDRANT_PAYLOAD_FIELDS.chunkId]: point.chunkId,
          [QDRANT_PAYLOAD_FIELDS.documentId]: point.documentId,
          [QDRANT_PAYLOAD_FIELDS.organizationId]: point.organizationId,
          [QDRANT_PAYLOAD_FIELDS.departmentIds]: point.departmentIds,
          [QDRANT_PAYLOAD_FIELDS.isOrganizationWide]: point.isOrganizationWide,
          [QDRANT_PAYLOAD_FIELDS.isDeleted]: point.isDeleted,
        };

        return { id: point.vectorPointId, vector: point.vector, payload };
      }),
    });
  }

  /**
   * Re-scopes every point of one document — the Qdrant half of the fan-out.
   *
   * A filtered `setPayload` rather than a read-then-write over point ids, which
   * is why `document_id` is payload-indexed: without that index this is a scan
   * of the whole collection to find a few hundred points, and it runs on every
   * visibility change in the system.
   *
   * Only the fields named here are touched. A full payload overwrite would
   * silently drop `chunk_id`, and nothing would notice until a citation
   * failed to resolve weeks later.
   */
  async setDocumentScope(
    documentId: string,
    scope: {
      departmentIds?: string[];
      isOrganizationWide?: boolean;
      isDeleted?: boolean;
    },
  ): Promise<void> {
    const payload: QdrantScopePayload = {};

    if (scope.departmentIds !== undefined) {
      payload[QDRANT_PAYLOAD_FIELDS.departmentIds] = scope.departmentIds;
    }
    if (scope.isOrganizationWide !== undefined) {
      payload[QDRANT_PAYLOAD_FIELDS.isOrganizationWide] =
        scope.isOrganizationWide;
    }
    if (scope.isDeleted !== undefined) {
      payload[QDRANT_PAYLOAD_FIELDS.isDeleted] = scope.isDeleted;
    }
    if (Object.keys(payload).length === 0) return;

    await this.client.setPayload(QDRANT_COLLECTION, {
      wait: true,
      payload,
      filter: {
        must: [
          {
            key: QDRANT_PAYLOAD_FIELDS.documentId,
            match: { value: documentId },
          },
        ],
      },
    });
  }

  /** The points of one document, for tests and for the fan-out's verification. */
  async countPoints(documentId: string): Promise<number> {
    const result = await this.client.count(QDRANT_COLLECTION, {
      exact: true,
      filter: {
        must: [
          {
            key: QDRANT_PAYLOAD_FIELDS.documentId,
            match: { value: documentId },
          },
        ],
      },
    });

    return result.count;
  }

  /** Reads points back by id — the payload assertions in the pipeline tests. */
  async retrieve(vectorPointIds: string[]) {
    if (vectorPointIds.length === 0) return [];

    return this.client.retrieve(QDRANT_COLLECTION, {
      ids: vectorPointIds,
      with_payload: true,
    });
  }

  /**
   * Removes the points of one document OUTRIGHT.
   *
   * Not used by delete — that flips `is_deleted` so citations in already-sent
   * messages still resolve (RDM §1.4). This exists for RE-INDEXING, where the
   * old vectors are genuinely obsolete rather than historical, and for tests.
   */
  async deleteDocumentPoints(documentId: string): Promise<void> {
    await this.client.delete(QDRANT_COLLECTION, {
      wait: true,
      filter: {
        must: [
          {
            key: QDRANT_PAYLOAD_FIELDS.documentId,
            match: { value: documentId },
          },
        ],
      },
    });
  }

  private async ensurePayloadIndexes(): Promise<void> {
    const specs: Array<[string, 'keyword' | 'bool']> = [
      [QDRANT_PAYLOAD_FIELDS.organizationId, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isDeleted, 'bool'],
      [QDRANT_PAYLOAD_FIELDS.departmentIds, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isOrganizationWide, 'bool'],
      [QDRANT_PAYLOAD_FIELDS.documentId, 'keyword'],
    ];

    for (const [field, schema] of specs) {
      try {
        await this.client.createPayloadIndex(QDRANT_COLLECTION, {
          field_name: field,
          field_schema: schema,
          wait: true,
        });
      } catch (error) {
        // Deliberately broad and deliberately non-fatal: a duplicate index is
        // reported differently across Qdrant versions and is not an error in
        // any of them. Re-raising would make a successful boot depend on which
        // server version happened to be running. A GENUINELY missing index is
        // caught by the test that asserts all five exist, not by this line.
        this.logger.debug(
          `Payload index ${field} already present or unsupported: ${String(error)}`,
        );
      }
    }
  }

  /**
   * Refuses to serve a collection built for a different vector size.
   *
   * The dimension is the only part Qdrant itself enforces, and it does so at
   * insert time with an error that says nothing about why. This turns it into a
   * boot failure naming the actual problem — a full re-embed migration, not a
   * config change (11-doc §1.3).
   */
  private async assertDimensionMatches(): Promise<void> {
    const info = await this.client.getCollection(QDRANT_COLLECTION);
    const vectors = info.config?.params?.vectors;
    const size =
      typeof vectors === 'object' && vectors !== null && 'size' in vectors
        ? (vectors as { size?: number }).size
        : undefined;

    if (size !== undefined && size !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Collection '${QDRANT_COLLECTION}' has ${size}-dimensional vectors but ` +
          `${EMBEDDING_MODEL} produces ${EMBEDDING_DIMENSION}. Changing the embedding ` +
          'model is a full re-embed migration, not a config change.',
      );
    }
  }
}
