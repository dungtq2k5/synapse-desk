import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { INGESTION_QUEUE, SCOPE_FANOUT_QUEUE } from '@synapsedesk/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { AiLedgerModule } from '../ai-ledger/ai-ledger.module';
import { QdrantModule } from '../qdrant/qdrant.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { DocumentParserService } from './document-parser.service';
import { DocumentChunkerService } from './document-chunker.service';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionQueueService } from './ingestion-queue.service';
import { IngestionWorker } from './ingestion.worker';
import { DocumentUploadedConsumer } from './document-uploaded.consumer';
import { ScopeWriterService } from './scope-writer.service';
import { ScopeFanoutProcessor } from './scope-fanout.processor';
import { ScopeFanoutQueueService } from './scope-fanout-queue.service';
import { ScopeChangedConsumer } from './scope-changed.consumer';

/**
 * The pipeline: parse, chunk, embed, upsert.
 *
 * `BullModule.forRootAsync` lives here rather than in `AppModule` because this
 * is the only module that queues anything. Registering it globally would put a
 * Redis connection in every process that imports the app — including the test
 * bootstraps that never touch a queue.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('REDIS_URL'),
          // The SAME index the quota counter uses. One service, one logical
          // Redis database: splitting them would mean a test flush that
          // cleared the queue but left counters behind, which is a state
          // nothing in production ever reaches.
          db: configService.get<number>('REDIS_DB') ?? 0,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: INGESTION_QUEUE },
      // A SEPARATE queue, not a second job name: a re-scope is short and
      // security-relevant, and sharing a queue would put it behind a
      // 200-page PDF parse.
      { name: SCOPE_FANOUT_QUEUE },
    ),
    PrismaModule,
    StorageClientModule,
    AiLedgerModule,
    QdrantModule,
    EmbeddingsModule,
  ],
  controllers: [DocumentUploadedConsumer, ScopeChangedConsumer],
  providers: [
    DocumentParserService,
    DocumentChunkerService,
    IngestionProcessor,
    IngestionQueueService,
    IngestionWorker,
    ScopeWriterService,
    ScopeFanoutProcessor,
    ScopeFanoutQueueService,
  ],
  exports: [
    IngestionQueueService,
    IngestionProcessor,
    ScopeWriterService,
    ScopeFanoutQueueService,
  ],
})
export class IngestionModule {}
