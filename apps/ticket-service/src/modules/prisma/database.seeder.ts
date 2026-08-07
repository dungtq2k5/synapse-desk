import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from './prisma.service';

/**
 * Bootstrap DDL for ticket-service.
 *
 * Unlike auth-service's seeder, this one seeds no ROWS — Domain B has no
 * reference data, no system actor and no catalogue. What it does is apply the
 * two constraints `schema.prisma` cannot express, and that is exactly why it
 * still has to exist and still has to run before the first request.
 *
 * Both are idempotent (`IF NOT EXISTS`), so running on every boot is safe and
 * running twice concurrently across replicas is safe. No advisory lock is
 * needed here for the same reason: `CREATE ... IF NOT EXISTS` has no read-then-
 * write race to lose, whereas auth-service's row seeding did.
 */
@Injectable()
export class DatabaseSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.configService.getOrThrow<boolean>('SEED_ON_BOOTSTRAP')) {
      this.logger.log('SEED_ON_BOOTSTRAP is false — skipping schema seed');
      return;
    }

    try {
      await this.seed();
    } catch (error) {
      // Serving traffic without these constraints is worse than not serving:
      // two concurrent reassigns would both succeed and the ticket would have
      // two live assignees with no way to tell which is real.
      this.logger.error(`Schema seed failed: ${formatErrorMsg(error)}`);
      throw error;
    }
  }

  async seed(): Promise<void> {
    const startedAt = Date.now();

    await this.applyPartialIndexes();
    await this.applyCheckConstraints();

    this.logger.log(`Schema seed completed in ${Date.now() - startedAt}ms`);
  }

  /**
   * The partial unique index `schema.prisma` cannot declare.
   *
   * Prisma has no syntax for `WHERE`, so `@@unique([ticketId])` would forbid a
   * ticket from having more than ONE assignment ever — destroying the history
   * the table exists for. Partial on `is_current = true` is what allows a full
   * audit trail alongside exactly one live row.
   *
   * This is not belt-and-braces over the service's own transaction. The service
   * closes the old row and opens the new one in one transaction, which is
   * correct in isolation — but two concurrent transactions both read "no
   * current assignment" and both insert. Only the index makes one of them lose.
   */
  private async applyPartialIndexes(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ticket_assignments_current_key"
        ON "ticket_assignments" ("ticket_id") WHERE "is_current" = true;
    `);

    // The analytics rollup's uniqueness guard — 19-doc §2.2.
    //
    // A PAIR, because `department_id` is NULLable and Postgres treats NULLs as
    // DISTINCT in a unique index: a plain `@@unique([organizationId, day,
    // departmentId])` would happily accept ten tenant-wide rows for the same
    // day, and the endpoints would sum them. The pair says what is actually
    // meant — one row per (tenant, day, department), and one per (tenant, day)
    // for tickets with no department.
    //
    // The job deletes and re-inserts rather than upserting, so this is not the
    // mechanism it relies on. It is the guard that turns a future bug into a
    // constraint violation instead of a silently doubled number.
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ticket_daily_stats_dept_key"
        ON "ticket_daily_stats" ("organization_id", "day", "department_id")
        WHERE "department_id" IS NOT NULL;
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ticket_daily_stats_org_key"
        ON "ticket_daily_stats" ("organization_id", "day")
        WHERE "department_id" IS NULL;
    `);
  }

  /**
   * Value constraints Prisma cannot express either.
   *
   * The service validates `rating` too, and that check is the one that produces
   * a good error message. This one exists because the service is not the only
   * way rows arrive — a migration, a backfill or a psql session all bypass it,
   * and a rating of 7 silently poisons every quality metric computed from this
   * table.
   *
   * `DO $$` rather than `ADD CONSTRAINT IF NOT EXISTS`: Postgres has no
   * `IF NOT EXISTS` for constraints, so re-running would fail on the second
   * boot without the catalogue check.
   */
  private async applyCheckConstraints(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ai_response_feedbacks_rating_check'
        ) THEN
          ALTER TABLE "ai_response_feedbacks"
            ADD CONSTRAINT "ai_response_feedbacks_rating_check"
            CHECK ("rating" IN (1, -1));
        END IF;
      END $$;
    `);
  }
}
