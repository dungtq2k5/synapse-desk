import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deletes short-lived records that are past their usefulness.
 *
 * Three tables grow without bound today, and `device_sessions` is the worst of
 * them: a spent rotation row is retained on purpose so a replayed refresh token
 * is DETECTABLE rather than merely unknown (RDM) — which means one row per
 * refresh, per user, forever. At a 15-minute access-token TTL that is ~96 rows
 * per user per day.
 *
 * Deleting only what has EXPIRED is what keeps replay detection intact: an
 * expired token is rejected on its expiry alone, so the row proves nothing
 * afterwards. Deleting on `rotatedAt` instead would throw away exactly the
 * evidence the retention exists for.
 *
 * `otps` and `password_reset_tokens` have the same unbounded-growth problem and
 * the same fix, so they are swept here rather than in three separate jobs.
 */
@Injectable()
export class ExpiredRecordsPruner {
  private readonly logger = new Logger(ExpiredRecordsPruner.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * **A plain method, with no `@Cron`**
   *
   * It carried `@Cron(EVERY_DAY_AT_3AM)` once. `@nestjs/schedule` runs
   * in-process, so three pods pruned three times, and under a rolling deploy
   * zero or four. Every statement is idempotent (`expiresAt < now`) so the cost
   * was duplicated write load rather than wrong data — genuinely low severity,
   * and not why it changed.
   *
   * It changed because **two mechanisms for one concern is how a third
   * appears**: whoever adds the next scheduled job copies whichever they find
   * first. `SchedulerProcessor` now calls this on a BullMQ repeat consumed by
   * exactly one worker, like every other scheduled job in the system.
   *
   * **Errors are no longer swallowed here.** The old body caught everything and
   * logged, which made a permanently broken sweep indistinguishable from a
   * working one. The scheduler records the failure on the heartbeat and BullMQ
   * retries — strictly more than a log line nobody reads.
   *
   * Returns the row count, so the caller can log something meaningful and a
   * test can assert on it without parsing output.
   */
  async prune(): Promise<number> {
    const now = new Date();

    const [sessions, otps, resetTokens] = await Promise.all([
      this.prisma.deviceSession.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.prisma.otp.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ]);

    const total = sessions.count + otps.count + resetTokens.count;

    if (total > 0) {
      this.logger.log(
        `Pruned ${sessions.count} session(s), ${otps.count} OTP(s), ` +
          `${resetTokens.count} reset token(s)`,
      );
    }

    return total;
  }
}
