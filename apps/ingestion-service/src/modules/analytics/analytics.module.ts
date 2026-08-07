import { Module } from '@nestjs/common';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { AiAnalyticsService } from './ai-analytics.service';
import { AiGenerationRollupJob } from './ai-generation-rollup.job';

/**
 * Domain C's read projection — 19-doc §3.2.
 *
 * No controller of its own: the three RPCs live on `AiLedgerGrpcController`,
 * because they read the ledger's projection and a second gRPC service for three
 * reads would be a second entry in every client's service map for a boundary
 * that does not exist.
 *
 * `AuthClientModule` is here for two reads: the BUDGET the spend is measured
 * against — a cost with no ceiling beside it is a number nobody can act on —
 * and each tenant's TIMEZONE, which decides which day a figure lands on.
 *
 * **The rollup job lives here rather than in `ScheduledModule` with its
 * siblings**, because the module owning a table should own its writer. The
 * alternative had `AiLedgerModule` and `ScheduledModule` importing each other,
 * and a `forwardRef` to hide a cycle is a cycle.
 */
@Module({
  imports: [AuthClientModule],
  providers: [AiAnalyticsService, AiGenerationRollupJob],
  exports: [AiAnalyticsService, AiGenerationRollupJob],
})
export class AiAnalyticsModule {}
