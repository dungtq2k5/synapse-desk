import { Module } from '@nestjs/common';
import {
  JOB_RUN_STORE,
  JobHealthService,
  JobRunRecorder,
  JobRunStore,
} from '@synapsedesk/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The heartbeat — 20-doc §4.1, deduplicated by §4.5.
 *
 * **The behaviour lives once, in `libs/common`; the TABLE stays here.** Three
 * `job_runs` tables holding different rows is not duplication of facts —
 * auth's holds auth's jobs, ingestion's holds ingestion's, and no single fact
 * is stored twice. What was genuinely duplicated was 306 byte-identical lines
 * of code across three services, which is what moved.
 *
 * This module is now the binding and nothing else: it hands the shared classes
 * this service's own `prisma.jobRun`, so the heartbeat is written in the same
 * failure domain as the work it describes. A heartbeat written anywhere else
 * can succeed while this database is unreachable — reporting healthy for a job
 * writing nothing, which is the original bug with extra infrastructure.
 *
 * It also depends on nothing but Prisma, deliberately: `SchedulerModule` writes
 * these rows and a gRPC controller reads them, and those sit on opposite sides
 * of an import that already exists. A leaf module both import is the shape that
 * is actually acyclic — a `forwardRef` would compile and still be a cycle.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: JOB_RUN_STORE,
      useFactory: (prisma: PrismaService): JobRunStore => prisma.jobRun,
      inject: [PrismaService],
    },
    {
      provide: JobRunRecorder,
      useFactory: (store: JobRunStore) => new JobRunRecorder(store),
      inject: [JOB_RUN_STORE],
    },
    {
      provide: JobHealthService,
      useFactory: (store: JobRunStore) => new JobHealthService(store),
      inject: [JOB_RUN_STORE],
    },
  ],
  exports: [JobRunRecorder, JobHealthService],
})
export class JobRunsModule {}
