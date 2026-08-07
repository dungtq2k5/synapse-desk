import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JobHealthService } from './job-health.service';
import { JobRunRecorder } from './job-run.recorder';

/**
 * The heartbeat — 20-doc §4.1.
 *
 * **Its own module, deliberately, and it depends on nothing but Prisma.**
 * `SchedulerModule` WRITES these rows and the analytics gRPC controller READS
 * them, and those two live on opposite sides of an import that already exists —
 * so putting the heartbeat in either one makes a cycle:
 *
 *     AnalyticsModule -> SchedulerModule -> AnalyticsModule
 *
 * A `forwardRef` would compile and would still be a cycle. A leaf module both
 * sides import is the shape that is actually acyclic (19-doc found the same
 * thing with `AiGenerationRollupJob`, and the rule is the same one: the module
 * that owns a table owns its writer, and a table two modules share belongs to
 * neither of them).
 */
@Module({
  imports: [PrismaModule],
  providers: [JobHealthService, JobRunRecorder],
  exports: [JobHealthService, JobRunRecorder],
})
export class JobRunsModule {}
