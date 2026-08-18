import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from './prisma.service';

/**
 * Bootstrap DDL for notification-service.
 *
 * Seeds no ROWS. Domain E has no reference data: a preference row is created
 * when a user changes something, and its absence is a permissive default.
 *
 * It applies the four PARTIAL indexes `schema.prisma` cannot express, one of
 * which is not an optimisation: `notifications_event_key` is the NATS
 * redelivery guard the in-app consumer relies on. It is PARTIAL
 * (`WHERE event_id IS NOT NULL`) rather than a plain `@@unique` because most
 * rows have no event id, which keeps the index small and the intent readable.
 *
 * The other three are read-path indexes; the notes below name the query each
 * one serves, because an index whose query nobody can name is the first one
 * somebody drops.
 *
 * All idempotent (`IF NOT EXISTS`), so boot and concurrent replicas are safe.
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

    await this.seed();
  }

  async seed(): Promise<void> {
    await this.assertSchemaExists();

    try {
      await this.applyIndexes();
      this.logger.log('notification-service schema seed complete');
    } catch (error) {
      this.logger.error(`Schema seed failed: ${formatErrorMsg(error)}`);
      throw error;
    }
  }

  /**
   * Fail with an ACTIONABLE message when the database has no schema at all.
   *
   * Without this the first statement of the seed is a raw `CREATE INDEX... ON
   * notifications`, so an unpushed database reports `relation "notifications" does not
   * exist` from inside a helper — a symptom that reads like a seeder bug and
   * takes a stack trace to trace back to the real cause, which is simply that
   * nothing ever pushed the schema here.
   *
   * The e2e suites cannot hit it and neither can a long-running environment, so
   * the only people who ever see it are on a fresh clone or a fresh Docker
   * volume — exactly the audience least able to interpret it. Ported from
   * auth-service, which already had this guard and was therefore the ONE
   * service that said what to do when a `docker compose down -v` wiped the
   * volumes.
   */
  private async assertSchemaExists(): Promise<void> {
    const [{ present }] = await this.prisma.$queryRaw<[{ present: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'notifications'
      ) AS present
    `;

    if (!present) {
      throw new Error(
        'The database has no schema — nothing has been pushed to it yet. ' +
          'Run `npm run db:push` (dev) or `npm run db:test:push` (test) and start again.',
      );
    }
  }

  private async applyIndexes(): Promise<void> {
    // The feed query: `GET /notifications`, newest first, archived excluded.
    // Partial rather than plain, because the default feed NEVER reads archived
    // rows and they accumulate forever — an index that carried them would grow
    // without bound in service of a query nobody runs.
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "notifications_feed_idx"
        ON "notifications" ("recipient_id", "created_at" DESC)
        WHERE "archived_at" IS NULL;
    `);

    // The badge count, which is polled far more often than the feed is read.
    // A client asks for it on every page and on every socket event; without
    // this it degrades into a scan of every notification the user ever
    // received, and nothing surfaces that except latency.
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
        ON "notifications" ("recipient_id")
        WHERE "read_at" IS NULL AND "archived_at" IS NULL;
    `);

    // NATS redelivery idempotency — the one that is not an optimisation.
    //
    // `in-app-notification.service.ts` catches the duplicate-key violation and
    // treats it as SUCCESS, so this index is the mechanism rather than a
    // safety net. Without it a redelivered quota alert is a second
    // notification, and the quota alert is exactly the producer that retries.
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "notifications_event_key"
        ON "notifications" ("recipient_id", "event_id")
        WHERE "event_id" IS NOT NULL;
    `);

    // Group collapse: "is there already an UNREAD row for this thread?".
    //
    // Scoped to unread deliberately. Once the user has read
    // "3 new replies", the next reply is new information and starts a fresh
    // row — an index covering read rows would serve a lookup that must not
    // find anything.
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "notifications_group_idx"
        ON "notifications" ("recipient_id", "group_key")
        WHERE "read_at" IS NULL AND "group_key" IS NOT NULL;
    `);
  }
}
