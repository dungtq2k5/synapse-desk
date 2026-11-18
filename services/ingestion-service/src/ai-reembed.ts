/**
 * @file `npm run ai:reembed -- --model <gemini|ollama>`: builds or updates one
 * embedding model's Qdrant collection from `document_chunks`, then points the
 * model's alias at it. `--drop <gemini|ollama>` deletes a model's collection
 * and alias once nothing uses it.
 *
 * Idempotent: after a run, the target holds exactly the live chunks (rows with
 * a point id and `is_staged = false`), each under the point id its row already
 * carries, with the scope its row holds now. The switch from model A to B:
 *
 *   1. **Pre-fill, everything running:** `ai:reembed -- --model B`. The
 *      services keep serving from A; the long part (or a quota stop) happens
 *      here, never during downtime.
 *   2. **Stop rag-service and ingestion-service**, with time for a job in
 *      flight to finish: `docker compose stop -t 120 rag-service
 *      ingestion-service` (Ctrl-C and wait, in development). A job still
 *      running at 120 s is killed and retried after the start.
 *   3. **Once both have EXITED** (no process left, their gRPC ports free: a
 *      surviving rag-service keeps answering beside a new one through
 *      `SO_REUSEPORT`, and a surviving ingestion-service keeps writing),
 *      catch up: `ai:reembed -- --model B` again, seconds.
 *   4. **Flip `AI_EMBEDDING_PROVIDER` to B** in both services and start them.
 *
 * Both stop, not just ingestion: rag-service records its ledger rows through
 * ingestion-service, so kept up alone it would charge the quota counter and
 * lose the row, and reconciliation would correct the counter down.
 *
 * **Never against the active collection while the services run:** a chunk
 * ingested during the run would have its point deleted. {@link refuseActive}
 * refuses `--model` equal to this environment's `AI_EMBEDDING_PROVIDER`;
 * `--services-stopped` overrides it for a deliberate repair.
 *
 * A staged row is a run in progress: its point is neither embedded nor
 * deleted here. If the switch interrupted it, its points are in A's
 * collection; the resumed run sees that and embeds it again into B.
 *
 * **Not charged to tenants.** Re-embedding is the operator's choice, not a
 * tenant's use, so no ledger row is written: chunks are logged per tenant and
 * tokens per run, and batches of 32 mix tenants freely.
 *
 * A rate limit is waited out, logged, up to the pipeline's cap. A provider
 * asking for a longer wait than {@link LONGEST_WAIT_MS} (a daily quota) stops
 * the run, saying when to run it again: nothing is lost, the next run skips
 * the points already there.
 */

import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  AiProvider,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  MODELS_BY_PROVIDER,
  OLLAMA_MODEL_DIGESTS,
  QDRANT_COLLECTION,
  QDRANT_MODEL_METADATA_KEY,
  QDRANT_PAYLOAD_FIELDS,
  QDRANT_UPSERT_BATCH,
  QdrantChunkPayload,
  collectionAlias,
} from '@synapsedesk/contracts';
import { envValidationSchema } from './common/configs/env.validation';
import { parseArgs, refuseActive } from './ai-reembed.args';
import {
  EmbeddingClient,
  RateLimited,
} from './modules/embeddings/embedding.contract';
import { GeminiEmbeddingClient } from './modules/embeddings/gemini-embedding.client';
import {
  checkOllama,
  OllamaEmbeddingClient,
} from './modules/embeddings/ollama-embedding.client';
import { EMBEDDING_RATE_LIMIT_WAITS } from './modules/ingestion/ingestion.processor';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';

/** Rows read from Postgres per page. */
const PAGE_SIZE = 512;

/** The longest rate-limit wait sat out; past it the run stops instead. */
export const LONGEST_WAIT_MS = 5 * 60_000;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
    PrismaModule,
  ],
})
class ReembedModule {}

type LiveChunk = {
  id: string;
  vectorPointId: string;
  contentText: string;
  documentId: string;
  organizationId: string;
  departmentIds: string[];
  isOrganizationWide: boolean;
  isDeleted: boolean;
};

class Reembed {
  private readonly logger = new Logger('ai-reembed');

  constructor(
    private readonly prisma: PrismaService,
    private readonly qdrant: QdrantClient,
  ) {}

  /** The collection an alias points at, or undefined. */
  async aliasTarget(alias: string): Promise<string | undefined> {
    const { aliases } = await this.qdrant.getAliases();
    return aliases.find((entry) => entry.alias_name === alias)?.collection_name;
  }

  async drop(provider: AiProvider, configured: AiProvider): Promise<void> {
    if (provider === configured) {
      throw new Error(
        `AI_EMBEDDING_PROVIDER is ${configured}: its collection is in use. ` +
          'Switch first, then drop the one you left.',
      );
    }
    const model = MODELS_BY_PROVIDER[provider].embeddingModel;
    const alias = collectionAlias(model);
    const target = await this.aliasTarget(alias);
    if (target === undefined) {
      this.logger.log(`${model} has no collection; nothing to drop.`);
      return;
    }
    // Deleting a collection deletes the aliases that point at it.
    await this.qdrant.deleteCollection(target);
    this.logger.log(`Dropped ${target} and its alias ${alias} (${model}).`);
  }

  async run(model: string, embedder: EmbeddingClient): Promise<void> {
    const startedAt = Date.now();
    const alias = collectionAlias(model);
    const existing = await this.aliasTarget(alias);
    const collection = existing ?? (await this.newCollection(model, alias));

    // Every point id a row claims, staged or not: nothing here may delete a
    // point that a row, even a staged one, still names.
    // ponytail: the ids are held in memory; page the deletion pass by id range
    // if a deployment outgrows a few million chunks.
    const claimed = new Set(
      (
        await this.prisma.unscoped('cross-tenant job').documentChunk.findMany({
          where: { vectorPointId: { not: null } },
          select: { vectorPointId: true },
        })
      ).map((row) => row.vectorPointId as string),
    );

    const perTenant = new Map<string, number>();
    let tokens = 0;
    let embedded = 0;
    let rescoped = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = (await this.prisma
        .unscoped('cross-tenant job')
        .documentChunk.findMany({
          where: { isStaged: false, vectorPointId: { not: null } },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            vectorPointId: true,
            contentText: true,
            documentId: true,
            organizationId: true,
            departmentIds: true,
            isOrganizationWide: true,
            isDeleted: true,
          },
        })) as LiveChunk[];
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;

      const present = new Set(
        (
          await this.qdrant.retrieve(collection, {
            ids: page.map((chunk) => chunk.vectorPointId),
            with_payload: false,
            with_vector: false,
          })
        ).map((point) => String(point.id)),
      );

      // Points already there keep their vector and take the row's scope now.
      const kept = page.filter((chunk) => present.has(chunk.vectorPointId));
      if (kept.length > 0) {
        await this.qdrant.batchUpdate(collection, {
          wait: true,
          operations: kept.map((chunk) => ({
            set_payload: {
              payload: payloadOf(chunk),
              points: [chunk.vectorPointId],
            },
          })),
        });
        rescoped += kept.length;
      }

      // The missing ones, 32 a call whatever their tenant.
      const missing = page.filter((chunk) => !present.has(chunk.vectorPointId));
      for (
        let start = 0;
        start < missing.length;
        start += EMBEDDING_BATCH_SIZE
      ) {
        const batch = missing.slice(start, start + EMBEDDING_BATCH_SIZE);
        const result = await this.embedWaiting(
          embedder,
          batch.map((chunk) => chunk.contentText),
          model,
        );
        const points = batch.map((chunk, index) => ({
          id: chunk.vectorPointId,
          vector: result.vectors[index],
          payload: payloadOf(chunk),
        }));
        for (let at = 0; at < points.length; at += QDRANT_UPSERT_BATCH) {
          await this.qdrant.upsert(collection, {
            wait: true,
            points: points.slice(at, at + QDRANT_UPSERT_BATCH),
          });
        }
        for (const chunk of batch) {
          perTenant.set(
            chunk.organizationId,
            (perTenant.get(chunk.organizationId) ?? 0) + 1,
          );
        }
        tokens += result.promptTokens;
        embedded += batch.length;
      }
    }

    const removed = await this.deleteUnclaimed(collection, claimed);

    if (existing === undefined) {
      await this.qdrant.updateCollectionAliases({
        actions: [
          { create_alias: { collection_name: collection, alias_name: alias } },
        ],
      });
    }

    for (const [tenant, chunks] of perTenant) {
      this.logger.log(`tenant ${tenant}: ${chunks} chunks embedded`);
    }
    const { count } = await this.qdrant.count(collection, { exact: true });
    this.logger.log(
      `${model}: ${collection} holds ${count} points — ${embedded} embedded, ` +
        `${rescoped} rescoped, ${removed} removed, ${tokens} tokens (not charged), ` +
        `in ${((Date.now() - startedAt) / 1000).toFixed(1)} s.` +
        (existing === undefined ? ` Alias ${alias} created.` : ''),
    );
  }

  /**
   * A new, empty collection for `model`: its own name, so the alias moves only
   * at the end of a complete build. Gemini's pre-alias collection is adopted
   * instead, as the services' boot does.
   */
  private async newCollection(model: string, alias: string): Promise<string> {
    if (
      model === EMBEDDING_MODEL &&
      (await this.qdrant.collectionExists(QDRANT_COLLECTION)).exists
    ) {
      await this.qdrant.updateCollection(QDRANT_COLLECTION, {
        metadata: { [QDRANT_MODEL_METADATA_KEY]: model },
      });
      return QDRANT_COLLECTION;
    }

    const name = `${alias}_${Math.floor(Date.now() / 1000)}`;
    await this.qdrant.createCollection(name, {
      vectors: { size: EMBEDDING_DIMENSION, distance: 'Cosine' },
      metadata: { [QDRANT_MODEL_METADATA_KEY]: model },
    });
    const indexes: Array<[string, 'keyword' | 'bool']> = [
      [QDRANT_PAYLOAD_FIELDS.organizationId, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isDeleted, 'bool'],
      [QDRANT_PAYLOAD_FIELDS.departmentIds, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isOrganizationWide, 'bool'],
      [QDRANT_PAYLOAD_FIELDS.documentId, 'keyword'],
      [QDRANT_PAYLOAD_FIELDS.isStaged, 'bool'],
    ];
    for (const [field, schema] of indexes) {
      await this.qdrant.createPayloadIndex(name, {
        field_name: field,
        field_schema: schema,
        wait: true,
      });
    }
    this.logger.log(`Created ${name} for ${model}.`);
    return name;
  }

  /**
   * Embeds a batch, waiting out a rate limit (a full queue, or a request past
   * its deadline) up to the pipeline's cap, each wait logged. A wait longer
   * than {@link LONGEST_WAIT_MS} stops the run instead.
   */
  private async embedWaiting(
    embedder: EmbeddingClient,
    texts: string[],
    model: string,
  ) {
    for (let waits = 0; ; waits += 1) {
      try {
        return await embedder.embedBatch(texts, model);
      } catch (error) {
        if (!(error instanceof RateLimited)) throw error;
        if (error.waitMs > LONGEST_WAIT_MS) {
          const until = new Date(Date.now() + error.waitMs).toISOString();
          throw new Error(
            `${model}'s provider asks for a ${Math.ceil(error.waitMs / 60_000)}-minute ` +
              `wait (a daily quota?). Stopped; run it again after ${until}: it ` +
              'skips the points already there.',
            { cause: error },
          );
        }
        if (waits >= EMBEDDING_RATE_LIMIT_WAITS) throw error;
        this.logger.warn(
          `Rate limited; waiting ${error.waitMs} ms (${waits + 1}/${EMBEDDING_RATE_LIMIT_WAITS})`,
        );
        await new Promise((resolve) => setTimeout(resolve, error.waitMs));
      }
    }
  }

  /** Deletes the points no row names any more: a chunk gone, or replaced. */
  private async deleteUnclaimed(
    collection: string,
    claimed: Set<string>,
  ): Promise<number> {
    let removed = 0;
    let offset: string | number | undefined;
    do {
      const page = await this.qdrant.scroll(collection, {
        limit: 1000,
        offset,
        with_payload: false,
        with_vector: false,
      });
      const stale = page.points
        .map((point) => point.id)
        .filter((id) => !claimed.has(String(id)));
      if (stale.length > 0) {
        await this.qdrant.delete(collection, { wait: true, points: stale });
        removed += stale.length;
      }
      offset = (page.next_page_offset ?? undefined) as
        string | number | undefined;
    } while (offset !== undefined);
    return removed;
  }
}

/** The full payload a live point carries, from its row. */
function payloadOf(chunk: LiveChunk): QdrantChunkPayload {
  return {
    [QDRANT_PAYLOAD_FIELDS.chunkId]: chunk.id,
    [QDRANT_PAYLOAD_FIELDS.documentId]: chunk.documentId,
    [QDRANT_PAYLOAD_FIELDS.organizationId]: chunk.organizationId,
    [QDRANT_PAYLOAD_FIELDS.departmentIds]: chunk.departmentIds,
    [QDRANT_PAYLOAD_FIELDS.isOrganizationWide]: chunk.isOrganizationWide,
    [QDRANT_PAYLOAD_FIELDS.isDeleted]: chunk.isDeleted,
    [QDRANT_PAYLOAD_FIELDS.isStaged]: false,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(ReembedModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const config = context.get(ConfigService);
    const qdrant = new QdrantClient({
      url: config.getOrThrow<string>('QDRANT_URL'),
      checkCompatibility: false,
    });
    const reembed = new Reembed(context.get(PrismaService), qdrant);
    const configured =
      config.get<AiProvider>('AI_EMBEDDING_PROVIDER') ?? 'gemini';

    if (args.drop) {
      await reembed.drop(args.drop, configured);
      return;
    }

    const provider = args.model as AiProvider;
    refuseActive(provider, configured, Boolean(args.servicesStopped));
    const model = MODELS_BY_PROVIDER[provider].embeddingModel;
    let embedder: EmbeddingClient;
    if (provider === 'ollama') {
      const baseUrl = config.get<string>('OLLAMA_BASE_URL');
      if (!baseUrl) {
        throw new Error(
          'OLLAMA_BASE_URL is empty; set it to re-embed with ollama.',
        );
      }
      await checkOllama(baseUrl, model, OLLAMA_MODEL_DIGESTS);
      embedder = new OllamaEmbeddingClient(
        baseUrl,
        Number(config.get('OLLAMA_NUM_CTX') ?? 8192),
        Number(config.get('OLLAMA_EMBED_TIMEOUT_MS') ?? 120_000),
      );
    } else {
      if (!config.get<string>('GEMINI_API_KEY')) {
        throw new Error(
          'GEMINI_API_KEY is empty; set it to re-embed with gemini.',
        );
      }
      embedder = new GeminiEmbeddingClient(config);
    }

    await reembed.run(model, embedder);
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    new Logger('ai-reembed').error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
