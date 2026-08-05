import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiLedgerModule } from '../ai-ledger/ai-ledger.module';
import { ChunkUsageProjection } from './chunk-usage.projection';
import { DiscardedDraftSweep } from './discarded-draft.sweep';
import { QuotaReconciliationJob } from './quota-reconciliation.job';
import { DocumentFlagService } from './document-flag.service';

/**
 * The four jobs that each close a metric reporting a wrong number without them.
 *
 * **No `@Cron` decorators here, deliberately.** Every job is a plain method
 * taking its window as an argument, which is what makes them testable at all: a
 * projection triggered by a schedule can only be tested by waiting, and a test
 * that waits is a test that gets deleted. The scheduler that calls them is a
 * thin layer above; the ORDER it calls them in is the part that matters —
 * projection before retention, always (§4.1).
 */
@Module({
  imports: [PrismaModule, AiLedgerModule],
  providers: [
    ChunkUsageProjection,
    DiscardedDraftSweep,
    QuotaReconciliationJob,
    DocumentFlagService,
  ],
  exports: [
    ChunkUsageProjection,
    DiscardedDraftSweep,
    QuotaReconciliationJob,
    DocumentFlagService,
  ],
})
export class ScheduledModule {}
