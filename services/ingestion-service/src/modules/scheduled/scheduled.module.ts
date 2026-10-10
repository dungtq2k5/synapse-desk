import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiLedgerModule } from '../ai-ledger/ai-ledger.module';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { ChunkUsageProjection } from './chunk-usage.projection';
import { DiscardedDraftSweep } from './discarded-draft.sweep';
import { QuotaReconciliationJob } from './quota-reconciliation.job';
import { DocumentFlagWriter } from './document-flag-writer';

/**
 * The four jobs that each close a metric reporting a wrong number without them.
 *
 * **No `@Cron` decorators here, deliberately.** Every job is a plain method
 * taking its window as an argument, which is what makes them testable at all: a
 * projection triggered by a schedule can only be tested by waiting, and a test
 * that waits is a test that gets deleted. The scheduler that calls them is a
 * thin layer above; the ORDER it calls them in is the part that matters —
 * projection before retention, always.
 *
 * `AiGenerationRollupJob` shares that constraint and deliberately
 * does NOT live here: it writes `ai_generation_daily_stats`, and the module
 * that owns a table should own its writer. Putting it beside its siblings
 * instead would have made `AiLedgerModule` and this module import each other.
 */
@Module({
  imports: [PrismaModule, AiLedgerModule, AuthClientModule],
  providers: [
    ChunkUsageProjection,
    DiscardedDraftSweep,
    QuotaReconciliationJob,
    DocumentFlagWriter,
  ],
  exports: [
    ChunkUsageProjection,
    DiscardedDraftSweep,
    QuotaReconciliationJob,
    DocumentFlagWriter,
  ],
})
export class ScheduledModule {}
