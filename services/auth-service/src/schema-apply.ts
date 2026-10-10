/**
 * @file The schema-object step, as a process rather than a boot hook.
 *
 * **Where the objects Prisma cannot express get created.** They ran
 * on every application boot until ADR 0043's init container existed to run them
 * instead; this is that step's entrypoint, and it has exactly two callers:
 *
 *   - the `migrate` init container, after `prisma migrate deploy` — production;
 *   - `npm run db:push`, right after the push — development.
 *
 * **Two callers, and the second one is not optional.** Moving this off the boot
 * path means nothing applies these objects to a developer's database any more,
 * and `assertSchemaExists()` would not catch it: that check counts TABLES, and
 * `db push` creates every table while creating none of the partial indexes or
 * CHECK constraints. A developer would get a database that boots, serves, and
 * silently permits the duplicate signup ADR 0020's partial index exists to
 * refuse. Chaining this onto `db:push` is what keeps the two environments
 * saying the same thing.
 *
 * **Why the boot hook was the wrong place**, measured: `CREATE INDEX` takes a
 * `ShareLock` on its table even when `IF NOT EXISTS` makes it a no-op, and that
 * lock QUEUES behind any open write transaction — 7.08 s behind an 8-second
 * writer — while every later writer stalls behind it. On the boot path that
 * wait sits in front of readiness, so a pod is slow to start *because of*
 * production write traffic and makes that traffic slower while it waits. In an
 * init container the same wait happens before the pod is in the endpoint list.
 *
 * The application context is created rather than a `PrismaClient` constructed
 * by hand, so the DDL runs through the same `DatabaseSeeder` the fixtures and
 * the boot hook use. ADR 0039: that block is the complete list, and a second
 * spelling of it here would be a second list.
 */

import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { envValidationSchema } from './common/configs/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { DatabaseSeeder } from './modules/prisma/database.seeder';

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
class SchemaApplyModule {}

async function main(): Promise<void> {
  const logger = new Logger('schema-apply');

  // Creating the context fires `DatabaseSeeder.onApplicationBootstrap`, which
  // ASSERTS the schema is there. That is deliberate rather than tolerated: in
  // the init container it runs immediately after `migrate deploy` and is the
  // cheapest possible check that the migration did what it said.
  const context = await NestFactory.createApplicationContext(SchemaApplyModule);

  try {
    await context.get(DatabaseSeeder).applySchemaObjects();
    logger.log('Schema objects applied');
  } finally {
    await context.close();
  }
}

// A non-zero exit is the whole contract: an init container that fails keeps its
// pod out of the endpoint list, and `db:push` chains this with `&&`.
main().catch((error: unknown) => {
  new Logger('schema-apply').error(
    `Failed to apply schema objects: ${(error as Error).message}`,
    (error as Error).stack,
  );
  process.exit(1);
});
