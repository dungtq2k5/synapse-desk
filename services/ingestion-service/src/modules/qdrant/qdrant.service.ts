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
} from '@synapsedesk/contracts';

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

/** How long a collection another service just created may take to load. */
export const READ_ATTEMPTS = 20;
export const READ_DELAY_MS = 500;

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
   * the Postgres seeders use. Both check, then create, so when they boot
   * together one of them loses the race and gets a 409; that counts as finding
   * the collection (see {@link createCollection}).
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.ensureCollection();
  }

  /**
   * Is Qdrant reachable?, ingestion-service's readiness.
   *
   * **Reuses the client this service already holds**, which is the point: a
   * probe every five seconds that constructs a client is a connection leak with
   * a schedule. `collectionExists` is the cheapest call that proves the server
   * is answering — it touches no vectors and returns a boolean.
   *
   * Qdrant is in THIS service's readiness because ingestion genuinely cannot do
   * its job without it: a document that parses and cannot be upserted is a job
   * that will fail, and reporting ready would mean accepting work to lose.
   */
  async isReachable(): Promise<boolean> {
    await this.client.collectionExists(QDRANT_COLLECTION);
    return true;
  }

  async ensureCollection(): Promise<void> {
    const exists = await this.client.collectionExists(QDRANT_COLLECTION);

    if (!exists.exists && (await this.createCollection())) {
      this.logger.log(
        `Created Qdrant collection ${QDRANT_COLLECTION} (${EMBEDDING_MODEL}, ${EMBEDDING_DIMENSION}-dim)`,
      );
    } else {
      await this.assertDimensionMatches();
    }

    await this.ensurePayloadIndexes();
  }

  /**
   * Creates the collection, or answers false when it already exists: rag-service
   * boots alongside and runs the same check-then-create, so the one that loses
   * the race gets Qdrant's 409 and must go on as if it had found it. Any other
   * failure still fails the boot.
   */
  private async createCollection(): Promise<boolean> {
    try {
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
      return true;
    } catch (error) {
      if ((error as { status?: unknown } | null)?.status === 409) return false;
      throw error;
    }
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
          // Every point is written staged: retrieval skips it until the run's
          // swap makes it live (`swapDocumentPoints`).
          [QDRANT_PAYLOAD_FIELDS.isStaged]: true,
        };

        return { id: point.vectorPointId, vector: point.vector, payload };
      }),
    });
  }

  /**
   * One document, one tenant — the filter shared by `setDocumentScope`,
   * `countPoints` and `deleteDocumentPoints`.
   */
  private documentFilter(documentId: string, organizationId: string) {
    return {
      must: [
        {
          key: QDRANT_PAYLOAD_FIELDS.documentId,
          match: { value: documentId },
        },
        // Defence in depth, NOT a second authorization: every caller has
        // already passed a tenant-scoped Postgres load, and `documentId` is an
        // unguessable primary key. Present because a wrong id is survivable on
        // two of these three and not on `setDocumentScope`, which would flip
        // `is_deleted` and overwrite `department_ids` on someone else's points.
        {
          key: QDRANT_PAYLOAD_FIELDS.organizationId,
          match: { value: organizationId },
        },
      ],
    };
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
    organizationId: string,
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
      filter: this.documentFilter(documentId, organizationId),
    });
  }

  /** The points of one document, for tests and for the fan-out's verification. */
  async countPoints(
    documentId: string,
    organizationId: string,
  ): Promise<number> {
    const result = await this.client.count(QDRANT_COLLECTION, {
      exact: true,
      filter: this.documentFilter(documentId, organizationId),
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
  async deleteDocumentPoints(
    documentId: string,
    organizationId: string,
  ): Promise<void> {
    await this.client.delete(QDRANT_COLLECTION, {
      wait: true,
      filter: this.documentFilter(documentId, organizationId),
    });
  }

  /**
   * Removes this document's STAGED points (a stopped run's, or a version that
   * won't go live), except `keep`: the ones a resumed run reuses. Never a live
   * point.
   *
   * `keep` is marked staged again: after a crash between the swap's two
   * halves, those points were already made live while their rows were not,
   * and the next swap would delete them as the old version.
   */
  async purgeStagedPoints(
    documentId: string,
    organizationId: string,
    keep: string[] = [],
  ): Promise<void> {
    const { must } = this.documentFilter(documentId, organizationId);
    if (keep.length === 0) {
      await this.client.delete(QDRANT_COLLECTION, {
        wait: true,
        filter: { must: [...must, this.staged] },
      });
      return;
    }

    await this.client.batchUpdate(QDRANT_COLLECTION, {
      wait: true,
      operations: [
        {
          delete: {
            filter: {
              must: [...must, this.staged],
              must_not: [{ has_id: keep }],
            },
          },
        },
        {
          set_payload: {
            payload: { [QDRANT_PAYLOAD_FIELDS.isStaged]: true },
            filter: { must: [...must, { has_id: keep }] },
          },
        },
      ],
    });
  }

  /**
   * The swap: this document's live points go, its staged ones become live
   * with `scope`, the document's scope as it stands now. A scope change made
   * while a batch was being embedded reached the rows but not that batch's
   * points, which were upserted with the scope read before it.
   *
   * One request, applied in order but not as a transaction: a search between
   * the two operations sees neither version of this document, for as long as
   * one operation takes. Both operations select by filter, so a re-run after a
   * crash between them converges: there is no live point left to delete, and
   * the staged ones flip.
   */
  async swapDocumentPoints(
    documentId: string,
    organizationId: string,
    scope: {
      departmentIds: string[];
      isOrganizationWide: boolean;
      isDeleted: boolean;
    },
  ): Promise<void> {
    const { must } = this.documentFilter(documentId, organizationId);
    await this.client.batchUpdate(QDRANT_COLLECTION, {
      wait: true,
      operations: [
        // Live: not staged, which includes a point written before the field.
        { delete: { filter: { must, must_not: [this.staged] } } },
        {
          set_payload: {
            payload: {
              [QDRANT_PAYLOAD_FIELDS.isStaged]: false,
              [QDRANT_PAYLOAD_FIELDS.departmentIds]: scope.departmentIds,
              [QDRANT_PAYLOAD_FIELDS.isOrganizationWide]:
                scope.isOrganizationWide,
              [QDRANT_PAYLOAD_FIELDS.isDeleted]: scope.isDeleted,
            },
            filter: { must: [...must, this.staged] },
          },
        },
      ],
    });
  }

  /**
   * The nearest live points of OTHER documents in the tenant to one point,
   * at or above `minScore` (cosine), for the `CONFLICTING` check.
   *
   * By point id: Qdrant reads the point's own vector, so nothing is embedded
   * again. Deleted and staged points are left out, like retrieval leaves them.
   */
  async nearestInOtherDocuments(
    vectorPointId: string,
    documentId: string,
    organizationId: string,
    limit: number,
    minScore: number,
  ): Promise<{ chunkId: string; documentId: string; score: number }[]> {
    const result = await this.client.query(QDRANT_COLLECTION, {
      query: vectorPointId,
      limit,
      score_threshold: minScore,
      with_payload: [
        QDRANT_PAYLOAD_FIELDS.chunkId,
        QDRANT_PAYLOAD_FIELDS.documentId,
      ],
      filter: {
        must: [
          {
            key: QDRANT_PAYLOAD_FIELDS.organizationId,
            match: { value: organizationId },
          },
          { key: QDRANT_PAYLOAD_FIELDS.isDeleted, match: { value: false } },
        ],
        must_not: [
          {
            key: QDRANT_PAYLOAD_FIELDS.documentId,
            match: { value: documentId },
          },
          this.staged,
        ],
      },
    });

    return result.points.map((point) => ({
      chunkId: String(point.payload?.[QDRANT_PAYLOAD_FIELDS.chunkId]),
      documentId: String(point.payload?.[QDRANT_PAYLOAD_FIELDS.documentId]),
      score: point.score,
    }));
  }

  /** Matches a point being built: `is_staged` is true. */
  private readonly staged = {
    key: QDRANT_PAYLOAD_FIELDS.isStaged,
    match: { value: true },
  };

  private async ensurePayloadIndexes(): Promise<void> {
    const specs: Array<[string, 'keyword' | 'bool']> = [
      [QDRANT_PAYLOAD_FIELDS.organizationId, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isDeleted, 'bool'],
      [QDRANT_PAYLOAD_FIELDS.departmentIds, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isOrganizationWide, 'bool'],
      [QDRANT_PAYLOAD_FIELDS.documentId, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isStaged, 'bool'],
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
   * The collection's info, once it has loaded. A collection rag-service
   * created a moment ago already exists but answers 500 ("0 of 0 read
   * operations failed") until its shards load, so a 5xx is waited out for up
   * to {@link READ_ATTEMPTS} × {@link READ_DELAY_MS} rather than failing the
   * boot.
   */
  private async readCollection(): ReturnType<QdrantClient['getCollection']> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.client.getCollection(QDRANT_COLLECTION);
      } catch (error) {
        const code = (error as { status?: unknown } | null)?.status;
        if (
          typeof code !== 'number' ||
          code < 500 ||
          attempt >= READ_ATTEMPTS
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, READ_DELAY_MS));
      }
    }
  }

  /**
   * Refuses to serve a collection built for a different vector size.
   *
   * The dimension is the only part Qdrant itself enforces, and it does so at
   * insert time with an error that says nothing about why. This turns it into a
   * boot failure naming the actual problem — a full re-embed migration, not a
   * config change.
   */
  private async assertDimensionMatches(): Promise<void> {
    const info = await this.readCollection();
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
